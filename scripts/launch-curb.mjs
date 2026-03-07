#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const APP_DIR = path.join(ROOT_DIR, "app");
const RUNTIME_DIR = path.join(ROOT_DIR, ".curb-runtime");
const LAUNCH_INFO_PATH = path.join(RUNTIME_DIR, "launch-info.json");
const SERVER_LOG_PATH = path.join(RUNTIME_DIR, "server.log");
const INSTALL_STAMP_PATH = path.join(APP_DIR, "node_modules", ".curb-lock-hash");
const NEXT_BUILD_DIR = path.join(APP_DIR, ".next");
const DEFAULT_PORT = 3000;
const MAX_PORT = 3010;
const LOOPBACK_HOST = "127.0.0.1";
const SERVER_START_TIMEOUT_MS = 90_000;
const SERVER_MODE = "webpack-dev";
const IS_WINDOWS = process.platform === "win32";

let activeChild = null;
let activeLogStream = null;
let shuttingDown = false;
let cleanupRegistered = false;

function log(message) {
  process.stdout.write(`[curb] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[curb] ${message}\n`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNpmCommand() {
  return IS_WINDOWS ? "npm.cmd" : "npm";
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function readLaunchInfo() {
  try {
    return JSON.parse(fs.readFileSync(LAUNCH_INFO_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeLaunchInfo(info) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(
    LAUNCH_INFO_PATH,
    JSON.stringify(
      {
        ...info,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function clearLaunchInfo() {
  fs.rmSync(LAUNCH_INFO_PATH, { force: true });
}

function clearLaunchInfoIfOwned(expectedPid) {
  const launchInfo = readLaunchInfo();
  if (!launchInfo) return;
  if (expectedPid && launchInfo.pid !== expectedPid) return;
  if (launchInfo.launcherPid && launchInfo.launcherPid !== process.pid) return;
  clearLaunchInfo();
}

function pidExists(pid) {
  if (!pid || typeof pid !== "number") return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!pidExists(pid)) {
      return true;
    }

    await sleep(250);
  }

  return !pidExists(pid);
}

async function stopProcess(pid) {
  if (!pidExists(pid)) return;

  if (IS_WINDOWS) {
    try {
      await runUtilityCommand("taskkill", ["/PID", String(pid), "/T"]);
    } catch {
      // Fall through to the forced termination path below.
    }

    if (await waitForProcessExit(pid, 5_000)) {
      return;
    }

    try {
      await runUtilityCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      // The process may already be gone.
    }

    await waitForProcessExit(pid, 2_500);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  if (await waitForProcessExit(pid, 10_000)) {
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may already be gone.
    }
  }

  await waitForProcessExit(pid, 2_500);
}

function closeActiveLogStream() {
  if (!activeLogStream) return;
  activeLogStream.end();
  activeLogStream = null;
}

async function cleanupManagedChild() {
  const child = activeChild;
  activeChild = null;

  if (child?.pid) {
    await stopProcess(child.pid);
    clearLaunchInfoIfOwned(child.pid);
  }

  closeActiveLogStream();
}

async function shutdown(exitCode = 0, reason = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;

  if (activeChild?.pid) {
    log(`Stopping Curb (${reason})...`);
  }

  await cleanupManagedChild();
  process.exit(exitCode);
}

function registerCleanupHandlers() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const signalHandler = (signal) => {
    void shutdown(0, signal);
  };

  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  process.on("SIGHUP", signalHandler);
  process.on("uncaughtException", (error) => {
    console.error(error);
    void shutdown(1, "uncaughtException");
  });
  process.on("unhandledRejection", (error) => {
    console.error(error);
    void shutdown(1, "unhandledRejection");
  });
}

function resetBuildOutput() {
  fs.rmSync(NEXT_BUILD_DIR, { recursive: true, force: true });
}

function readLogTail(maxBytes = 4000) {
  try {
    const buffer = fs.readFileSync(SERVER_LOG_PATH);
    return buffer.slice(-maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: APP_DIR,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}

async function runUtilityCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: "ignore",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}

async function ensureDependencies() {
  const lockFilePath = path.join(APP_DIR, "package-lock.json");
  const lockHash = fs.existsSync(lockFilePath) ? sha256(lockFilePath) : null;
  const hasNodeModules = fs.existsSync(path.join(APP_DIR, "node_modules"));
  const installedHash = fs.existsSync(INSTALL_STAMP_PATH)
    ? fs.readFileSync(INSTALL_STAMP_PATH, "utf8").trim()
    : "";

  if (hasNodeModules && lockHash && installedHash === lockHash) {
    log("Dependencies already installed.");
    return;
  }

  log("Installing app dependencies...");

  if (fs.existsSync(lockFilePath)) {
    await runCommand(getNpmCommand(), ["ci"]);
  } else {
    await runCommand(getNpmCommand(), ["install"]);
  }

  if (lockHash) {
    fs.mkdirSync(path.dirname(INSTALL_STAMP_PATH), { recursive: true });
    fs.writeFileSync(INSTALL_STAMP_PATH, `${lockHash}\n`);
  }
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.listen(port, LOOPBACK_HOST, () => {
      server.close(() => resolve(true));
    });
  });
}

async function fetchJson(url, init) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function isHealthy(port) {
  const data = await fetchJson(`http://${LOOPBACK_HOST}:${port}/api/health`);
  return Boolean(data && data.app === "curb" && data.ok);
}

async function waitForHealthy(port, timeoutMs, child = null) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(port)) {
      return true;
    }

    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      return false;
    }

    await sleep(1000);
  }

  return false;
}

async function findRunningServer() {
  const launchInfo = readLaunchInfo();

  if (launchInfo?.port && launchInfo?.pid && pidExists(launchInfo.pid)) {
    const ready = await waitForHealthy(launchInfo.port, 10_000);
    if (ready) {
      return {
        mode: launchInfo.mode ?? null,
        pid: launchInfo.pid,
        port: launchInfo.port,
        managed: true,
        launcherPid:
          typeof launchInfo.launcherPid === "number"
            ? launchInfo.launcherPid
            : null,
      };
    }
  }

  if (launchInfo) {
    clearLaunchInfo();
  }

  for (let port = DEFAULT_PORT; port <= MAX_PORT; port += 1) {
    if (await isHealthy(port)) {
      return {
        mode: null,
        pid: null,
        port,
        managed: false,
        launcherPid: null,
      };
    }
  }

  return null;
}

async function choosePort() {
  const runningServer = await findRunningServer();
  if (runningServer) {
    if (runningServer.managed) {
      const launcherActive =
        runningServer.launcherPid !== null && pidExists(runningServer.launcherPid);

      if (!launcherActive || runningServer.mode !== SERVER_MODE) {
        log("Stopping stale managed Curb instance...");
        await stopProcess(runningServer.pid);
        clearLaunchInfo();
        resetBuildOutput();
        return { port: runningServer.port, running: false, supervisedElsewhere: false };
      }

      return {
        port: runningServer.port,
        running: true,
        supervisedElsewhere: true,
      };
    }

    return {
      port: runningServer.port,
      running: true,
      supervisedElsewhere: false,
    };
  }

  for (let port = DEFAULT_PORT; port <= MAX_PORT; port += 1) {
    if (await isPortAvailable(port)) {
      return { port, running: false, supervisedElsewhere: false };
    }
  }

  throw new Error(
    `No free local port found between ${DEFAULT_PORT} and ${MAX_PORT}.`
  );
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (IS_WINDOWS) {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function pipeServerOutput(stream, destination) {
  if (!stream) return;

  stream.on("data", (chunk) => {
    destination.write(chunk);
    activeLogStream?.write(chunk);
  });
}

function startServer(port) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  resetBuildOutput();

  activeLogStream = fs.createWriteStream(SERVER_LOG_PATH, { flags: "w" });

  const child = spawn(
    getNpmCommand(),
    ["run", "dev", "--", "--port", String(port), "--hostname", LOOPBACK_HOST],
    {
      cwd: APP_DIR,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: !IS_WINDOWS,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  pipeServerOutput(child.stdout, process.stdout);
  pipeServerOutput(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    clearLaunchInfoIfOwned(child.pid);
    closeActiveLogStream();
    activeChild = null;

    if (!shuttingDown) {
      const detail = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      log(`Curb stopped (${detail}).`);
      process.exit(code ?? 1);
    }
  });

  activeChild = child;
  writeLaunchInfo({
    mode: SERVER_MODE,
    pid: child.pid,
    port,
    launcherPid: process.pid,
  });

  return child;
}

function isLocalPreviewUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/sites\/?$/i.test(url);
}

async function syncLocalPreviewBaseUrl(port) {
  const settings = await fetchJson(`http://${LOOPBACK_HOST}:${port}/api/settings`);
  if (!settings?.defaults) return;

  const expectedUrl = `http://${LOOPBACK_HOST}:${port}/sites`;
  const currentUrl = String(settings.defaults.siteBaseUrl ?? "").trim();

  if (currentUrl && !isLocalPreviewUrl(currentUrl)) {
    return;
  }

  if (currentUrl === expectedUrl) {
    return;
  }

  await fetch(`http://${LOOPBACK_HOST}:${port}/api/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      section: "defaults",
      data: {
        ...settings.defaults,
        siteBaseUrl: expectedUrl,
      },
    }),
  });
}

async function main() {
  registerCleanupHandlers();

  log("Preparing Curb...");
  await ensureDependencies();

  const { port, running, supervisedElsewhere } = await choosePort();
  const appUrl = `http://${LOOPBACK_HOST}:${port}`;

  if (!running) {
    log(`Starting Curb on port ${port}...`);
    const child = startServer(port);

    const ready = await waitForHealthy(port, SERVER_START_TIMEOUT_MS, child);
    if (!ready) {
      const tail = readLogTail();
      await cleanupManagedChild();
      throw new Error(
        `The server did not become ready within ${SERVER_START_TIMEOUT_MS / 1000}s.\n\n${tail}`
      );
    }

    await syncLocalPreviewBaseUrl(port);
    log(`Opening ${appUrl}`);
    openBrowser(appUrl);
    log("Curb is running. Press Ctrl+C to stop it.");
    await new Promise((resolve) => child.once("exit", resolve));
    return;
  }

  await syncLocalPreviewBaseUrl(port);
  log(`Opening ${appUrl}`);
  openBrowser(appUrl);

  if (supervisedElsewhere) {
    log("Curb is already running under another launcher. Leaving that instance running.");
  } else {
    log("Curb is already running. Leaving that instance running.");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
