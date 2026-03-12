import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import slugify from "slugify";
import { Vercel } from "@vercel/sdk";
import { logActivity } from "./activity-log";
import {
  selectCloudflareCustomerAccount,
  selectCloudflarePreviewAccount,
  type CloudflareAccountPoolEntry,
} from "./cloudflare-account-pool";
import {
  getConfig,
  type Config,
  type DeploymentProvider,
} from "./config";
import { getDb } from "./db";
import { isLegacyManagedArtifactPath } from "./legacy-site-artifacts";
import { initializeDatabase } from "./schema";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
const SITES_DIR = path.join(WORKSPACE_ROOT, "sites");
const INTERNAL_SITE_FILES = new Set(["__source_snapshot.json"]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".txt",
  ".xml",
]);
const STATIC_PROJECT_SETTINGS = {
  buildCommand: null,
  devCommand: null,
  framework: null,
  installCommand: null,
  outputDirectory: null,
  rootDirectory: null,
} as const;
const DEPLOYMENT_POLL_INTERVAL_MS = 1500;
const DEPLOYMENT_POLL_TIMEOUT_MS = 120000;
const CLOUDFLARE_WRANGLER_PRODUCTION_BRANCH = "main";

type DeploymentKind = "preview" | "customer";

type RawBusinessRow = {
  id: number;
  name: string;
  slug: string;
  customer_domain: string | null;
  customer_domain_verified: number | null;
  customer_domain_verification_json: string | null;
  customer_project_provider: string | null;
  customer_project_metadata_json: string | null;
  vercel_customer_project_id: string | null;
  vercel_customer_project_name: string | null;
};

type RawGeneratedSiteRow = {
  id: number;
  version: number;
  slug: string;
  site_path: string;
};

type SiteContext = {
  business: RawBusinessRow;
  generatedSite: RawGeneratedSiteRow;
  siteDir: string;
};

export type VerificationRecord = {
  type: string;
  domain: string;
  value: string;
  reason: string;
};

type DeploymentMetadata = Record<string, unknown>;

type CustomerProjectState = {
  customerDomain: string | null;
  customerDomainVerification: VerificationRecord[];
  customerDomainVerified: boolean;
  customerProjectId: string | null;
  customerProjectMetadata: DeploymentMetadata | null;
  customerProjectName: string | null;
  customerProjectProvider: DeploymentProvider | null;
};

type DeploymentFiles = Array<{
  file: string;
  data: string;
  encoding: "base64" | "utf-8";
}>;

type CoreDeploymentResult = {
  aliasHost?: string | null;
  aliasUrl?: string | null;
  deploymentId: string;
  deploymentUrl: string;
  metadata?: DeploymentMetadata | null;
  projectCreated?: boolean;
  projectId: string;
  projectName?: string | null;
  readyState?: string | null;
};

export interface SiteDeploymentRecord {
  id: number;
  businessId: number;
  generatedSiteId: number;
  deploymentKind: DeploymentKind;
  deploymentProvider: DeploymentProvider;
  projectId: string;
  projectName: string | null;
  deploymentId: string;
  deploymentUrl: string;
  aliasUrl: string | null;
  aliasHost: string | null;
  target: string;
  readyState: string | null;
  active: boolean;
  errorMessage: string | null;
  metadata: DeploymentMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPreviewLink {
  provider: DeploymentProvider | null;
  source: "alias" | "deployment" | "local";
  url: string;
}

export interface DeployPreviewResult {
  provider: DeploymentProvider;
  aliasUrl: string | null;
  deploymentId: string;
  deploymentUrl: string;
  generatedSiteId: number;
  projectId: string;
  projectName: string | null;
  readyState: string | null;
  version: number;
}

export interface DeployCustomerResult extends DeployPreviewResult {
  customerDomain: string | null;
  customerDomainVerified: boolean;
  customerDomainVerification: VerificationRecord[];
  projectCreated: boolean;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeDeploymentProvider(
  value: string | null | undefined
): DeploymentProvider {
  if (value === "cloudflare-pages" || value === "ssh-static") {
    return value;
  }

  return "vercel";
}

function deploymentProviderLabel(provider: DeploymentProvider): string {
  if (provider === "cloudflare-pages") {
    return "Cloudflare Pages";
  }

  if (provider === "ssh-static") {
    return "Shared Server";
  }

  return "Vercel";
}

function normalizeHostname(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const withoutWildcard = raw.replace(/^\*\./, "").replace(/^\./, "");

  try {
    const parsed = withoutWildcard.includes("://")
      ? new URL(withoutWildcard)
      : new URL(`https://${withoutWildcard}`);
    return parsed.hostname.replace(/\.$/, "");
  } catch {
    return withoutWildcard.replace(/\/+$/, "").replace(/\.$/, "");
  }
}

function buildDnsLabel(value: string, fallback: string): string {
  const normalized =
    slugify(value, { lower: true, strict: true, trim: true }) ||
    slugify(fallback, { lower: true, strict: true, trim: true }) ||
    "site";

  if (normalized.length <= 63) {
    return normalized;
  }

  const hash = crypto
    .createHash("sha1")
    .update(normalized)
    .digest("hex")
    .slice(0, 8);
  const prefix = normalized.slice(0, Math.max(1, 63 - hash.length - 1));
  return `${prefix}-${hash}`;
}

function buildPreviewAliasHost(slug: string, config: Config): string | null {
  const rootDomain = normalizeHostname(config.vercelPreviewRootDomain);
  if (!rootDomain) {
    return null;
  }

  return `${buildDnsLabel(slug, "preview")}.${rootDomain}`;
}

function buildCustomerProjectName(slug: string, businessId: number): string {
  const base = buildDnsLabel(slug, `customer-${businessId}`);
  const prefix = `curb-${base}`;
  if (prefix.length <= 100) {
    return prefix;
  }

  const hash = crypto
    .createHash("sha1")
    .update(prefix)
    .digest("hex")
    .slice(0, 8);
  const trimmed = prefix.slice(0, Math.max(1, 100 - hash.length - 1));
  return `${trimmed}-${hash}`;
}

function buildDeploymentName(kind: DeploymentKind, slug: string): string {
  return buildDnsLabel(`curb-${kind}-${slug}`, `${kind}-site`);
}

function serializeVerification(
  verification: VerificationRecord[]
): string | null {
  return verification.length > 0 ? JSON.stringify(verification) : null;
}

function parseVerification(
  value: string | null | undefined
): VerificationRecord[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const source = entry as Record<string, unknown>;
        const type = String(source.type ?? "").trim();
        const domain = String(source.domain ?? "").trim();
        const dataValue = String(source.value ?? "").trim();
        const reason = String(source.reason ?? "").trim();

        if (!type || !domain || !dataValue) {
          return null;
        }

        return {
          type,
          domain,
          value: dataValue,
          reason,
        } satisfies VerificationRecord;
      })
      .filter((entry): entry is VerificationRecord => entry !== null);
  } catch {
    return [];
  }
}

function serializeMetadata(
  metadata: DeploymentMetadata | null | undefined
): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

function parseMetadata(
  value: string | null | undefined
): DeploymentMetadata | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as DeploymentMetadata)
      : null;
  } catch {
    return null;
  }
}

function toAbsoluteSiteDir(sitePath: string, slug: string): string {
  const trimmed = String(sitePath ?? "").trim();
  if (!trimmed) {
    return path.join(SITES_DIR, slug);
  }

  return path.resolve(WORKSPACE_ROOT, trimmed);
}

function walkSiteFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSiteFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function collectDeploymentFiles(siteDir: string): DeploymentFiles {
  if (!fs.existsSync(siteDir)) {
    throw new Error(`Generated site directory not found at ${siteDir}`);
  }

  return walkSiteFiles(siteDir)
    .filter((fullPath) => !INTERNAL_SITE_FILES.has(path.basename(fullPath)))
    .sort((left, right) => left.localeCompare(right))
    .map((fullPath) => {
      const relativePath = path
        .relative(siteDir, fullPath)
        .split(path.sep)
        .join("/");
      if (isLegacyManagedArtifactPath(relativePath)) {
        return null;
      }
      const extension = path.extname(fullPath).toLowerCase();
      const encoding = TEXT_FILE_EXTENSIONS.has(extension) ? "utf-8" : "base64";

      return {
        file: relativePath,
        data:
          encoding === "utf-8"
            ? fs.readFileSync(fullPath, "utf8")
            : fs.readFileSync(fullPath).toString("base64"),
        encoding,
      };
    })
    .filter((entry): entry is DeploymentFiles[number] => entry !== null);
}

function writeDeploymentFiles(directory: string, files: DeploymentFiles): void {
  for (const entry of files) {
    const targetPath = path.join(directory, entry.file);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (entry.encoding === "utf-8") {
      fs.writeFileSync(targetPath, entry.data, "utf8");
    } else {
      fs.writeFileSync(targetPath, Buffer.from(entry.data, "base64"));
    }
  }
}

async function withStagedDirectory<T>(
  files: DeploymentFiles,
  callback: (directory: string) => Promise<T>
): Promise<T> {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "curb-deploy-"));

  try {
    writeDeploymentFiles(stagingRoot, files);
    return await callback(stagingRoot);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function formatUrl(hostOrUrl: string | null | undefined): string | null {
  const raw = String(hostOrUrl ?? "").trim();
  if (!raw) {
    return null;
  }

  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function applyTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>
): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_match, key: string) => {
    const value = values[key];
    return value == null ? "" : String(value);
  });
}

async function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
        ...(options?.env ?? {}),
      },
      shell:
        process.platform === "win32" &&
        (command.endsWith(".cmd") || command.endsWith(".bat")),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          [stderr.trim(), stdout.trim()]
            .filter(Boolean)
            .join("\n")
            .trim() || `${command} exited with code ${code}`
        )
      );
    });
  });
}

function resolveWranglerBinary(): string {
  const wranglerBinary = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler"
  );

  if (!fs.existsSync(wranglerBinary)) {
    throw new Error(
      "Wrangler is not installed. Run `npm install` in the app directory first."
    );
  }

  return wranglerBinary;
}

function cloudflareAuthEnv(
  account: CloudflareAccountPoolEntry
): Record<string, string | undefined> {
  return {
    CLOUDFLARE_API_TOKEN: account.apiToken.trim(),
    CLOUDFLARE_ACCOUNT_ID: account.accountId.trim(),
  };
}

async function runWrangler(
  account: CloudflareAccountPoolEntry,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return runCommand(resolveWranglerBinary(), args, {
    cwd: process.cwd(),
    env: cloudflareAuthEnv(account),
  });
}

async function callCloudflareApi<T>(
  account: CloudflareAccountPoolEntry,
  pathname: string,
  init?: RequestInit
): Promise<T> {
  const accountId = account.accountId.trim();
  const token = account.apiToken.trim();
  if (!accountId || !token) {
    throw new Error(
      "Add a Cloudflare API token and Account ID in Settings before deploying sites."
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${pathname}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        success?: boolean;
        errors?: Array<{ message?: string }>;
        result?: T;
      }
    | null;

  if (!response.ok || !payload?.success) {
    const errorMessage =
      payload?.errors
        ?.map((entry) => String(entry.message ?? "").trim())
        .filter(Boolean)
        .join(", ") || `Cloudflare API request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload.result as T;
}

function buildCloudflarePagesUrl(
  projectName: string,
  branch: string,
  productionBranch: string
): string {
  return branch === productionBranch
    ? `https://${projectName}.pages.dev`
    : `https://${branch}.${projectName}.pages.dev`;
}

function normalizeCloudflareVerification(
  value: unknown
): VerificationRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const source = entry as Record<string, unknown>;
      const type = String(source.type ?? source.method ?? "DNS").trim();
      const domain = String(
        source.domain ?? source.name ?? source.hostname ?? ""
      ).trim();
      const dataValue = String(source.value ?? source.content ?? "").trim();
      const reason = String(source.reason ?? source.status ?? "").trim();

      if (!domain || !dataValue) {
        return null;
      }

      return {
        type,
        domain,
        value: dataValue,
        reason,
      } satisfies VerificationRecord;
    })
    .filter((entry): entry is VerificationRecord => entry !== null);
}

function normalizeCloudflareDomainState(
  result: unknown
): { verified: boolean; verification: VerificationRecord[] } {
  if (!result || typeof result !== "object") {
    return { verified: false, verification: [] };
  }

  const source = result as Record<string, unknown>;
  const status = String(source.status ?? source.state ?? "").trim().toLowerCase();
  const verificationData = normalizeCloudflareVerification(
    source.verification_data
  );
  const validationData = normalizeCloudflareVerification(source.validation_data);
  const verification =
    verificationData.length > 0 ? verificationData : validationData;

  return {
    verified: status === "active" || status === "verified",
    verification: verification.length > 0 ? verification : [],
  };
}

function buildSshRemoteBasePath(
  config: Config,
  kind: DeploymentKind,
  slug: string
): string {
  const basePath = config.sshRemoteBasePath.trim().replace(/\/+$/, "");
  if (!basePath) {
    throw new Error(
      "Add a shared-server remote base path in Settings before deploying sites."
    );
  }

  return path.posix.join(basePath, kind, slug);
}

function buildSshUrl(
  template: string,
  values: Record<string, string | number | null | undefined>
): string {
  const resolved = applyTemplate(template, values).trim();
  const url = formatUrl(resolved);
  if (!url) {
    throw new Error("The shared-server URL template resolved to an empty URL.");
  }

  return url;
}

function prepareSshCredentialFiles(config: Config): {
  cleanup: () => void;
  keyFilePath: string | null;
  knownHostsPath: string | null;
} {
  const cleanupPaths: string[] = [];

  const key = config.sshPrivateKey.trim();
  let keyFilePath: string | null = null;
  if (key) {
    keyFilePath = path.join(
      os.tmpdir(),
      `curb-ssh-key-${crypto.randomBytes(8).toString("hex")}`
    );
    fs.writeFileSync(keyFilePath, `${key}\n`, { mode: 0o600 });
    cleanupPaths.push(keyFilePath);
  }

  const knownHosts = config.sshKnownHosts.trim();
  let knownHostsPath: string | null = null;
  if (knownHosts) {
    knownHostsPath = path.join(
      os.tmpdir(),
      `curb-known-hosts-${crypto.randomBytes(8).toString("hex")}`
    );
    fs.writeFileSync(knownHostsPath, `${knownHosts}\n`, { mode: 0o600 });
    cleanupPaths.push(knownHostsPath);
  }

  return {
    keyFilePath,
    knownHostsPath,
    cleanup: () => {
      for (const filePath of cleanupPaths) {
        fs.rmSync(filePath, { force: true });
      }
    },
  };
}

function buildSshBaseArgs(
  config: Config,
  keyFilePath: string | null,
  knownHostsPath: string | null,
  mode: "ssh" | "scp"
): string[] {
  const args: string[] = [];
  const port = Number.isFinite(config.sshPort) && config.sshPort > 0
    ? String(config.sshPort)
    : "22";

  args.push(mode === "ssh" ? "-p" : "-P", port);
  args.push("-o", "BatchMode=yes");

  if (keyFilePath) {
    args.push("-i", keyFilePath);
  }

  if (knownHostsPath) {
    args.push("-o", `UserKnownHostsFile=${knownHostsPath}`);
    args.push("-o", "StrictHostKeyChecking=yes");
  } else {
    args.push("-o", "StrictHostKeyChecking=accept-new");
  }

  return args;
}

async function runSshCommand(
  config: Config,
  remoteCommand: string,
  auth: { keyFilePath: string | null; knownHostsPath: string | null }
): Promise<void> {
  const host = config.sshHost.trim();
  const user = config.sshUser.trim();
  if (!host || !user) {
    throw new Error(
      "Add a shared-server host and username in Settings before deploying sites."
    );
  }

  await runCommand("ssh", [
    ...buildSshBaseArgs(config, auth.keyFilePath, auth.knownHostsPath, "ssh"),
    `${user}@${host}`,
    remoteCommand,
  ]);
}

async function copyDirectoryToRemote(
  config: Config,
  localDirectory: string,
  remoteDirectory: string,
  auth: { keyFilePath: string | null; knownHostsPath: string | null }
): Promise<void> {
  const host = config.sshHost.trim();
  const user = config.sshUser.trim();
  if (!host || !user) {
    throw new Error(
      "Add a shared-server host and username in Settings before deploying sites."
    );
  }

  await runCommand("scp", [
    ...buildSshBaseArgs(config, auth.keyFilePath, auth.knownHostsPath, "scp"),
    "-r",
    path.join(localDirectory, "."),
    `${user}@${host}:${remoteDirectory}/`,
  ]);
}

function latestGeneratedSiteForBusiness(businessId: number): SiteContext {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare(
      `SELECT
        id,
        name,
        slug,
        customer_domain,
        customer_domain_verified,
        customer_domain_verification_json,
        customer_project_provider,
        customer_project_metadata_json,
        vercel_customer_project_id,
        vercel_customer_project_name
      FROM businesses
      WHERE id = ?`
    )
    .get(businessId) as RawBusinessRow | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const generatedSite = db
    .prepare(
      `SELECT
        id,
        version,
        slug,
        site_path
      FROM generated_sites
      WHERE business_id = ?
      ORDER BY version DESC, id DESC
      LIMIT 1`
    )
    .get(businessId) as RawGeneratedSiteRow | undefined;

  if (!generatedSite) {
    throw new Error(`No generated site found for ${business.name}.`);
  }

  return {
    business,
    generatedSite,
    siteDir: toAbsoluteSiteDir(generatedSite.site_path, generatedSite.slug),
  };
}

function setBusinessCustomerProject(
  businessId: number,
  input: {
    provider: DeploymentProvider;
    projectId: string;
    projectName: string;
    metadata?: DeploymentMetadata | null;
  }
): void {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE businesses
     SET customer_project_provider = ?,
         customer_project_metadata_json = ?,
         vercel_customer_project_id = ?,
         vercel_customer_project_name = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.provider,
    serializeMetadata(input.metadata ?? null),
    input.projectId,
    input.projectName,
    businessId
  );
}

function setBusinessCustomerDomain(
  businessId: number,
  domain: string | null,
  verified: boolean,
  verification: VerificationRecord[]
): void {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE businesses
     SET customer_domain = ?,
         customer_domain_verified = ?,
         customer_domain_verification_json = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(domain, verified ? 1 : 0, serializeVerification(verification), businessId);
}

function insertSiteDeployment(input: {
  aliasHost?: string | null;
  aliasUrl?: string | null;
  businessId: number;
  deploymentId: string;
  deploymentKind: DeploymentKind;
  deploymentProvider: DeploymentProvider;
  deploymentUrl: string;
  errorMessage?: string | null;
  generatedSiteId: number;
  metadata?: DeploymentMetadata | null;
  projectId: string;
  projectName?: string | null;
  readyState?: string | null;
  target: string;
}): number {
  initializeDatabase();
  const db = getDb();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE site_deployments
       SET active = 0,
           updated_at = datetime('now')
       WHERE business_id = ?
         AND deployment_kind = ?`
    ).run(input.businessId, input.deploymentKind);

    const result = db
      .prepare(
        `INSERT INTO site_deployments (
          business_id,
          generated_site_id,
          deployment_kind,
          deployment_provider,
          vercel_project_id,
          vercel_project_name,
          vercel_deployment_id,
          vercel_deployment_url,
          alias_url,
          alias_host,
          target,
          ready_state,
          metadata_json,
          active,
          error_message,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
      )
      .run(
        input.businessId,
        input.generatedSiteId,
        input.deploymentKind,
        input.deploymentProvider,
        input.projectId,
        input.projectName ?? null,
        input.deploymentId,
        input.deploymentUrl,
        input.aliasUrl ?? null,
        input.aliasHost ?? null,
        input.target,
        input.readyState ?? null,
        serializeMetadata(input.metadata ?? null),
        input.errorMessage ?? null
      );

    return Number(result.lastInsertRowid);
  });

  return tx();
}

export function listSiteDeploymentsForBusiness(
  businessId: number
): SiteDeploymentRecord[] {
  initializeDatabase();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM site_deployments
       WHERE business_id = ?
       ORDER BY active DESC, created_at DESC, id DESC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: Number(row.id),
    businessId: Number(row.business_id),
    generatedSiteId: Number(row.generated_site_id),
    deploymentKind:
      row.deployment_kind === "customer" ? "customer" : "preview",
    deploymentProvider: normalizeDeploymentProvider(
      typeof row.deployment_provider === "string"
        ? row.deployment_provider
        : "vercel"
    ),
    projectId: String(row.vercel_project_id ?? ""),
    projectName:
      typeof row.vercel_project_name === "string"
        ? row.vercel_project_name
        : null,
    deploymentId: String(row.vercel_deployment_id ?? ""),
    deploymentUrl: String(row.vercel_deployment_url ?? ""),
    aliasUrl: typeof row.alias_url === "string" ? row.alias_url : null,
    aliasHost: typeof row.alias_host === "string" ? row.alias_host : null,
    target: String(row.target ?? ""),
    readyState:
      typeof row.ready_state === "string" ? row.ready_state : null,
    active: Number(row.active ?? 0) === 1,
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : null,
    metadata:
      typeof row.metadata_json === "string" ? parseMetadata(row.metadata_json) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

function latestReadyDeployment(
  businessId: number,
  kind: DeploymentKind
): SiteDeploymentRecord | null {
  return (
    listSiteDeploymentsForBusiness(businessId).find(
      (deployment) =>
        deployment.deploymentKind === kind &&
        deployment.readyState === "READY" &&
        !deployment.errorMessage
    ) ?? null
  );
}

export function getPublicPreviewLinkForBusiness(
  businessId: number,
  slug: string
): PublicPreviewLink {
  const latestPreview = latestReadyDeployment(businessId, "preview");
  if (latestPreview?.aliasUrl) {
    return {
      provider: latestPreview.deploymentProvider,
      source: "alias",
      url: latestPreview.aliasUrl,
    };
  }

  if (latestPreview?.deploymentUrl) {
    return {
      provider: latestPreview.deploymentProvider,
      source: "deployment",
      url: latestPreview.deploymentUrl,
    };
  }

  const config = getConfig();
  return {
    provider: null,
    source: "local",
    url: `${config.siteBaseUrl.replace(/\/+$/, "")}/${slug}`,
  };
}

function isVercelPreviewDeploymentConfigured(config: Config): boolean {
  return (
    config.vercelToken.trim().length > 0 &&
    config.vercelPreviewProjectId.trim().length > 0
  );
}

function isCloudflarePreviewDeploymentConfigured(config: Config): boolean {
  const account = selectCloudflarePreviewAccount(config);
  return Boolean(account && account.previewProjectName.trim());
}

function isSshPreviewDeploymentConfigured(config: Config): boolean {
  return (
    config.sshHost.trim().length > 0 &&
    config.sshUser.trim().length > 0 &&
    config.sshRemoteBasePath.trim().length > 0 &&
    config.sshPreviewUrlTemplate.trim().length > 0
  );
}

export function isPreviewDeploymentConfigured(config = getConfig()): boolean {
  switch (config.previewDeploymentProvider) {
    case "cloudflare-pages":
      return isCloudflarePreviewDeploymentConfigured(config);
    case "ssh-static":
      return isSshPreviewDeploymentConfigured(config);
    default:
      return isVercelPreviewDeploymentConfigured(config);
  }
}

function getTeamScope(config: Config): { teamId?: string } {
  const teamId = config.vercelTeamId.trim();
  return teamId ? { teamId } : {};
}

function createVercelClient(config: Config): Vercel {
  const token = config.vercelToken.trim();
  if (!token) {
    throw new Error("Add a Vercel token in Settings before deploying sites.");
  }

  return new Vercel({
    bearerToken: token,
    timeoutMs: 120000,
  });
}

async function waitForVercelDeploymentReady(
  client: Vercel,
  deploymentId: string,
  config: Config
): Promise<{ readyState: string | null; url: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEPLOYMENT_POLL_TIMEOUT_MS) {
    const deployment = await client.deployments.getDeployment({
      idOrUrl: deploymentId,
      ...getTeamScope(config),
    });

    const readyState = String(deployment.readyState ?? "");
    if (readyState === "READY") {
      const url = formatUrl(deployment.url) ?? formatUrl(deploymentId);
      if (!url) {
        throw new Error("Deployment finished without a public URL.");
      }

      return { readyState, url };
    }

    if (readyState === "ERROR" || readyState === "CANCELED") {
      throw new Error(
        `Vercel deployment ${deploymentId} ended with state ${readyState}.`
      );
    }

    await sleep(DEPLOYMENT_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for the Vercel deployment to finish.");
}

async function ensureVercelCustomerProject(
  client: Vercel,
  config: Config,
  context: SiteContext,
  customerState: CustomerProjectState
): Promise<{ created: boolean; projectId: string; projectName: string }> {
  const existingProjectId =
    customerState.customerProjectProvider === "vercel"
      ? customerState.customerProjectId?.trim()
      : null;
  const existingProjectName =
    customerState.customerProjectProvider === "vercel"
      ? customerState.customerProjectName?.trim() || null
      : null;

  if (existingProjectId) {
    return {
      created: false,
      projectId: existingProjectId,
      projectName:
        existingProjectName ??
        buildCustomerProjectName(context.business.slug, context.business.id),
    };
  }

  const projectName = buildCustomerProjectName(
    context.business.slug,
    context.business.id
  );
  const createdProject = await client.projects.createProject({
    ...getTeamScope(config),
    requestBody: {
      name: projectName,
      publicSource: false,
    },
  });

  setBusinessCustomerProject(context.business.id, {
    provider: "vercel",
    projectId: createdProject.id,
    projectName: createdProject.name,
  });

  return {
    created: true,
    projectId: createdProject.id,
    projectName: createdProject.name,
  };
}

async function ensureVercelProjectDomain(
  client: Vercel,
  config: Config,
  projectId: string,
  domain: string
): Promise<{ verified: boolean; verification: VerificationRecord[] }> {
  let domainInfo:
    | {
        verified: boolean;
        verification?: Array<{
          type: string;
          domain: string;
          value: string;
          reason: string;
        }>;
      }
    | null = null;

  try {
    domainInfo = await client.projects.addProjectDomain({
      idOrName: projectId,
      ...getTeamScope(config),
      requestBody: { name: domain },
    });
  } catch (error) {
    try {
      domainInfo = await client.projects.getProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
    } catch {
      throw error;
    }
  }

  if (!domainInfo) {
    return { verified: false, verification: [] };
  }

  if (!domainInfo.verified) {
    try {
      await client.projects.verifyProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
      domainInfo = await client.projects.getProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
    } catch {
      // Keep the existing verification payload so the UI can surface DNS instructions.
    }
  }

  return {
    verified: Boolean(domainInfo.verified),
    verification: Array.isArray(domainInfo.verification)
      ? domainInfo.verification.map((entry) => ({
          type: String(entry.type ?? ""),
          domain: String(entry.domain ?? ""),
          value: String(entry.value ?? ""),
          reason: String(entry.reason ?? ""),
        }))
      : [],
  };
}

async function createVercelDeployment(
  client: Vercel,
  config: Config,
  input: {
    files: DeploymentFiles;
    meta: Record<string, string>;
    name: string;
    projectId: string;
    target: string;
  }
): Promise<{ deploymentId: string; readyState: string | null; url: string }> {
  const created = await client.deployments.createDeployment({
    ...getTeamScope(config),
    forceNew: "1",
    skipAutoDetectionConfirmation: "1",
    requestBody: {
      files: input.files,
      meta: input.meta,
      name: input.name,
      project: input.projectId,
      projectSettings: STATIC_PROJECT_SETTINGS,
      target: input.target,
    },
  });

  const deploymentId = String(created.id ?? "").trim();
  if (!deploymentId) {
    throw new Error("Vercel did not return a deployment id.");
  }

  const ready = await waitForVercelDeploymentReady(client, deploymentId, config);
  return {
    deploymentId,
    readyState: ready.readyState,
    url: ready.url,
  };
}

async function deployPreviewWithVercel(
  businessId: number,
  context: SiteContext,
  config: Config,
  options?: { initiatedBy?: "automatic" | "manual" }
): Promise<CoreDeploymentResult> {
  if (!isVercelPreviewDeploymentConfigured(config)) {
    throw new Error(
      "Add a Vercel token and Preview Project ID in Settings before deploying previews."
    );
  }

  const client = createVercelClient(config);
  const files = collectDeploymentFiles(context.siteDir);
  const aliasHost = buildPreviewAliasHost(context.generatedSite.slug, config);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message:
      options?.initiatedBy === "automatic"
        ? `Auto-deploying preview for ${context.business.name} to Vercel`
        : `Deploying preview for ${context.business.name} to Vercel`,
  });

  const deployment = await createVercelDeployment(client, config, {
    files,
    meta: {
      curbBusinessId: String(context.business.id),
      curbDeploymentKind: "preview",
      curbSiteVersion: String(context.generatedSite.version),
      curbSlug: context.generatedSite.slug,
    },
    name: buildDeploymentName("preview", context.generatedSite.slug),
    projectId: config.vercelPreviewProjectId.trim(),
    target: "preview",
  });

  let aliasUrl: string | null = null;
  if (aliasHost) {
    try {
      const assigned = await client.aliases.assignAlias({
        id: deployment.deploymentId,
        ...getTeamScope(config),
        requestBody: {
          alias: aliasHost,
        },
      });
      aliasUrl = formatUrl(assigned.alias);
    } catch (error) {
      logActivity({
        kind: "deployment",
        stage: "warning",
        businessId,
        businessName: context.business.name,
        message: `Preview deployed for ${context.business.name}, but alias assignment failed: ${toErrorMessage(
          error,
          "Unknown alias error."
        )}`,
      });
    }
  }

  return {
    aliasHost,
    aliasUrl,
    deploymentId: deployment.deploymentId,
    deploymentUrl: deployment.url,
    projectId: config.vercelPreviewProjectId.trim(),
    projectName: null,
    readyState: deployment.readyState,
  };
}

async function deployCustomerWithVercel(
  businessId: number,
  context: SiteContext,
  customerState: CustomerProjectState,
  config: Config,
  options?: { customerDomain?: string | null }
): Promise<
  CoreDeploymentResult & {
    customerDomain: string | null;
    customerDomainVerification: VerificationRecord[];
    customerDomainVerified: boolean;
  }
> {
  const client = createVercelClient(config);
  const files = collectDeploymentFiles(context.siteDir);
  const requestedDomain =
    normalizeHostname(options?.customerDomain) ??
    normalizeHostname(context.business.customer_domain);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message: `Deploying a dedicated customer project for ${context.business.name} on Vercel`,
  });

  const project = await ensureVercelCustomerProject(
    client,
    config,
    context,
    customerState
  );

  let customerDomainVerified = false;
  let customerDomainVerification: VerificationRecord[] = [];

  if (requestedDomain) {
    const domainResult = await ensureVercelProjectDomain(
      client,
      config,
      project.projectId,
      requestedDomain
    );
    customerDomainVerified = domainResult.verified;
    customerDomainVerification = domainResult.verification;
    setBusinessCustomerDomain(
      context.business.id,
      requestedDomain,
      customerDomainVerified,
      customerDomainVerification
    );
  }

  const deployment = await createVercelDeployment(client, config, {
    files,
    meta: {
      curbBusinessId: String(context.business.id),
      curbDeploymentKind: "customer",
      curbSiteVersion: String(context.generatedSite.version),
      curbSlug: context.generatedSite.slug,
    },
    name: buildDeploymentName("customer", context.generatedSite.slug),
    projectId: project.projectId,
    target: "production",
  });

  let aliasUrl: string | null = null;
  if (requestedDomain && customerDomainVerified) {
    const alias = await client.aliases.assignAlias({
      id: deployment.deploymentId,
      ...getTeamScope(config),
      requestBody: {
        alias: requestedDomain,
      },
    });
    aliasUrl = formatUrl(alias.alias);
  }

  return {
    aliasHost: requestedDomain,
    aliasUrl,
    customerDomain: requestedDomain,
    customerDomainVerification,
    customerDomainVerified,
    deploymentId: deployment.deploymentId,
    deploymentUrl: deployment.url,
    projectCreated: project.created,
    projectId: project.projectId,
    projectName: project.projectName,
    readyState: deployment.readyState,
  };
}

async function ensureCloudflareProject(
  account: CloudflareAccountPoolEntry,
  projectName: string,
  productionBranch: string
): Promise<{ created: boolean; projectId: string; projectName: string }> {
  try {
    await runWrangler(account, [
      "pages",
      "project",
      "create",
      projectName,
      "--production-branch",
      productionBranch,
    ]);
    return {
      created: true,
      projectId: projectName,
      projectName,
    };
  } catch (error) {
    const message = toErrorMessage(error, "Cloudflare project creation failed.");
    if (!/already exists/i.test(message)) {
      throw error;
    }

    return {
      created: false,
      projectId: projectName,
      projectName,
    };
  }
}

async function getCloudflareDeploymentInfo(
  account: CloudflareAccountPoolEntry,
  input: {
    branch: string;
    environment: "preview" | "production";
    projectName: string;
    productionBranch: string;
  }
): Promise<{ deploymentId: string; deploymentUrl: string }> {
  try {
    const { stdout } = await runWrangler(account, [
      "pages",
      "deployment",
      "list",
      "--project-name",
      input.projectName,
      "--environment",
      input.environment,
      "--json",
    ]);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const match =
      parsed.find((entry) => {
        const trigger = entry.deployment_trigger as Record<string, unknown> | undefined;
        const metadata =
          trigger?.metadata as Record<string, unknown> | undefined;
        const branch = String(
          metadata?.branch ?? entry.branch ?? entry.deployment_trigger ?? ""
        ).trim();
        return branch === input.branch;
      }) ?? parsed[0];

    const id = String(match?.id ?? "").trim();
    const url =
      formatUrl(
        String(
          match?.url ??
            (Array.isArray(match?.aliases) ? match.aliases[0] : "") ??
            ""
        )
      ) ??
      buildCloudflarePagesUrl(
        input.projectName,
        input.branch,
        input.productionBranch
      );

    return {
      deploymentId:
        id ||
        `cloudflare:${input.projectName}:${input.branch}:${Date.now().toString(36)}`,
      deploymentUrl: url,
    };
  } catch {
    return {
      deploymentId: `cloudflare:${input.projectName}:${input.branch}:${Date.now().toString(36)}`,
      deploymentUrl: buildCloudflarePagesUrl(
        input.projectName,
        input.branch,
        input.productionBranch
      ),
    };
  }
}

async function deployCloudflareDirectory(
  account: CloudflareAccountPoolEntry,
  input: {
    branch: string;
    directory: string;
    environment: "preview" | "production";
    projectName: string;
    productionBranch: string;
  }
): Promise<{ deploymentId: string; deploymentUrl: string; readyState: "READY" }> {
  const deployOutput = await runWrangler(account, [
    "pages",
    "deploy",
    input.directory,
    "--project-name",
    input.projectName,
    "--branch",
    input.branch,
    "--commit-dirty",
    "true",
    "--commit-message",
    `Curb ${input.environment} deploy ${new Date().toISOString()}`,
  ]);

  const urlMatch = `${deployOutput.stdout}\n${deployOutput.stderr}`.match(
    /https:\/\/[^\s]+\.pages\.dev/gi
  );
  const deploymentInfo = await getCloudflareDeploymentInfo(account, input);

  return {
    deploymentId: deploymentInfo.deploymentId,
    deploymentUrl:
      formatUrl(urlMatch?.[0]) ?? deploymentInfo.deploymentUrl,
    readyState: "READY",
  };
}

async function ensureCloudflareCustomerDomain(
  account: CloudflareAccountPoolEntry,
  projectName: string,
  domain: string
): Promise<{ verified: boolean; verification: VerificationRecord[] }> {
  const encodedProjectName = encodeURIComponent(projectName);

  try {
    const created = await callCloudflareApi<Record<string, unknown>>(
      account,
      `/pages/projects/${encodedProjectName}/domains`,
      {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      }
    );
    return normalizeCloudflareDomainState(created);
  } catch (error) {
    const message = toErrorMessage(error, "Cloudflare domain setup failed.");
    if (!/already exists/i.test(message)) {
      throw error;
    }
  }

  const domains = await callCloudflareApi<Array<Record<string, unknown>>>(
    account,
    `/pages/projects/${encodedProjectName}/domains`,
    { method: "GET" }
  );
  const match =
    domains.find((entry) => String(entry.name ?? "").trim() === domain) ?? null;

  return normalizeCloudflareDomainState(match);
}

async function deployPreviewWithCloudflare(
  businessId: number,
  context: SiteContext,
  config: Config,
  options?: { initiatedBy?: "automatic" | "manual" }
): Promise<CoreDeploymentResult> {
  const account = selectCloudflarePreviewAccount(config);
  if (!account || !account.previewProjectName.trim()) {
    throw new Error(
      "Add a Cloudflare preview account, API token, Account ID, and Preview Project Name in Settings before deploying previews."
    );
  }

  const projectName = account.previewProjectName.trim();
  const branch = buildDnsLabel(context.generatedSite.slug, "preview");
  const files = collectDeploymentFiles(context.siteDir);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message:
      options?.initiatedBy === "automatic"
        ? `Auto-deploying preview for ${context.business.name} to Cloudflare Pages`
        : `Deploying preview for ${context.business.name} to Cloudflare Pages`,
  });

  await ensureCloudflareProject(
    account,
    projectName,
    CLOUDFLARE_WRANGLER_PRODUCTION_BRANCH
  );

  return withStagedDirectory(files, async (directory) => {
    const deployment = await deployCloudflareDirectory(account, {
      branch,
      directory,
      environment: "preview",
      projectName,
      productionBranch: CLOUDFLARE_WRANGLER_PRODUCTION_BRANCH,
    });

    return {
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.deploymentUrl,
      metadata: {
        cloudflareAccountId: account.accountId,
        cloudflareAccountLabel: account.label,
        branch,
        productionBranch: CLOUDFLARE_WRANGLER_PRODUCTION_BRANCH,
      },
      projectId: projectName,
      projectName,
      readyState: deployment.readyState,
    };
  });
}

async function deployCustomerWithCloudflare(
  businessId: number,
  context: SiteContext,
  customerState: CustomerProjectState,
  config: Config,
  options?: { customerDomain?: string | null }
): Promise<
  CoreDeploymentResult & {
    customerDomain: string | null;
    customerDomainVerification: VerificationRecord[];
    customerDomainVerified: boolean;
  }
> {
  const requestedDomain =
    normalizeHostname(options?.customerDomain) ??
    normalizeHostname(context.business.customer_domain);
  const existingProjectMetadata =
    customerState.customerProjectProvider === "cloudflare-pages" &&
    customerState.customerProjectMetadata &&
    typeof customerState.customerProjectMetadata === "object"
      ? (customerState.customerProjectMetadata as Record<string, unknown>)
      : null;
  const account = selectCloudflareCustomerAccount(
    config,
    businessId,
    typeof existingProjectMetadata?.cloudflareAccountId === "string"
      ? existingProjectMetadata.cloudflareAccountId
      : null,
    typeof existingProjectMetadata?.cloudflareAccountLabel === "string"
      ? existingProjectMetadata.cloudflareAccountLabel
      : null
  );
  if (!account) {
    throw new Error(
      "Add at least one Cloudflare customer deployment account in Settings before deploying customer sites."
    );
  }
  const files = collectDeploymentFiles(context.siteDir);
  const productionBranch =
    account.customerProductionBranch.trim() ||
    config.cloudflareCustomerProductionBranch.trim() ||
    "production";
  const projectName =
    customerState.customerProjectProvider === "cloudflare-pages" &&
    customerState.customerProjectId?.trim()
      ? customerState.customerProjectId.trim()
      : buildCustomerProjectName(context.business.slug, context.business.id);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message: `Deploying a dedicated customer project for ${context.business.name} on Cloudflare Pages`,
  });

  const project = await ensureCloudflareProject(
    account,
    projectName,
    productionBranch
  );
  const projectMetadata = {
    cloudflareAccountId: account.accountId,
    cloudflareAccountLabel: account.label,
    productionBranch,
  } satisfies DeploymentMetadata;
  setBusinessCustomerProject(context.business.id, {
    provider: "cloudflare-pages",
    projectId: project.projectId,
    projectName: project.projectName,
    metadata: projectMetadata,
  });

  let customerDomainVerified = false;
  let customerDomainVerification: VerificationRecord[] = [];
  if (requestedDomain) {
    const domainResult = await ensureCloudflareCustomerDomain(
      account,
      projectName,
      requestedDomain
    );
    customerDomainVerified = domainResult.verified;
    customerDomainVerification = domainResult.verification;
    setBusinessCustomerDomain(
      context.business.id,
      requestedDomain,
      customerDomainVerified,
      customerDomainVerification
    );
  }

  return withStagedDirectory(files, async (directory) => {
    const deployment = await deployCloudflareDirectory(account, {
      branch: productionBranch,
      directory,
      environment: "production",
      projectName,
      productionBranch,
    });

    return {
      aliasHost: requestedDomain,
      aliasUrl: requestedDomain && customerDomainVerified
        ? formatUrl(requestedDomain)
        : null,
      customerDomain: requestedDomain,
      customerDomainVerification,
      customerDomainVerified,
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.deploymentUrl,
      metadata: projectMetadata,
      projectCreated: project.created,
      projectId: project.projectId,
      projectName: project.projectName,
      readyState: deployment.readyState,
    };
  });
}

async function deployWithSharedServer(
  businessId: number,
  context: SiteContext,
  config: Config,
  input: {
    customerDomain?: string | null;
    kind: DeploymentKind;
    logMessage: string;
    urlTemplate: string;
    postDeployCommand: string;
  }
): Promise<CoreDeploymentResult> {
  const files = collectDeploymentFiles(context.siteDir);
  const remoteSiteRoot = buildSshRemoteBasePath(
    config,
    input.kind,
    context.generatedSite.slug
  );
  const releaseToken = `${Date.now().toString(36)}-${context.generatedSite.version}`;
  const remoteReleaseDir = path.posix.join(remoteSiteRoot, "releases", releaseToken);
  const remoteCurrentDir = path.posix.join(remoteSiteRoot, "current");
  const deploymentValues = {
    kind: input.kind,
    slug: context.generatedSite.slug,
    business_id: context.business.id,
    business_name: context.business.name,
    generated_site_id: context.generatedSite.id,
    version: context.generatedSite.version,
    customer_domain: input.customerDomain ?? "",
    deployment_dir: remoteReleaseDir,
    current_dir: remoteCurrentDir,
  };
  const deploymentUrl = buildSshUrl(input.urlTemplate, deploymentValues);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message: input.logMessage,
  });

  return withStagedDirectory(files, async (directory) => {
    const auth = prepareSshCredentialFiles(config);

    try {
      await runSshCommand(
        config,
        [
          "set -e",
          `mkdir -p ${escapeShellArg(path.posix.join(remoteSiteRoot, "releases"))}`,
          `mkdir -p ${escapeShellArg(remoteReleaseDir)}`,
        ].join(" && "),
        auth
      );

      await copyDirectoryToRemote(config, directory, remoteReleaseDir, auth);

      const hook = input.postDeployCommand.trim()
        ? applyTemplate(input.postDeployCommand, {
            ...deploymentValues,
            deployment_url: deploymentUrl,
          }).trim()
        : "";
      const activationCommands = [
        "set -e",
        `ln -sfn ${escapeShellArg(remoteReleaseDir)} ${escapeShellArg(remoteCurrentDir)}`,
      ];

      if (hook) {
        activationCommands.push(hook);
      }

      await runSshCommand(config, activationCommands.join(" && "), auth);
    } finally {
      auth.cleanup();
    }

    return {
      deploymentId: `ssh:${input.kind}:${releaseToken}`,
      deploymentUrl,
      metadata: {
        remoteCurrentDir,
        remoteReleaseDir,
        remoteSiteRoot,
      },
      projectId: remoteSiteRoot,
      projectName: context.generatedSite.slug,
      readyState: "READY",
    };
  });
}

async function deployPreviewWithSharedServer(
  businessId: number,
  context: SiteContext,
  config: Config,
  options?: { initiatedBy?: "automatic" | "manual" }
): Promise<CoreDeploymentResult> {
  if (!isSshPreviewDeploymentConfigured(config)) {
    throw new Error(
      "Add the shared-server host, username, remote base path, and preview URL template in Settings before deploying previews."
    );
  }

  return deployWithSharedServer(businessId, context, config, {
    kind: "preview",
    logMessage:
      options?.initiatedBy === "automatic"
        ? `Auto-deploying preview for ${context.business.name} to the shared server`
        : `Deploying preview for ${context.business.name} to the shared server`,
    postDeployCommand: config.sshPreviewPostDeployCommand,
    urlTemplate: config.sshPreviewUrlTemplate,
  });
}

async function deployCustomerWithSharedServer(
  businessId: number,
  context: SiteContext,
  config: Config,
  options?: { customerDomain?: string | null }
): Promise<
  CoreDeploymentResult & {
    customerDomain: string | null;
    customerDomainVerification: VerificationRecord[];
    customerDomainVerified: boolean;
  }
> {
  const requestedDomain =
    normalizeHostname(options?.customerDomain) ??
    normalizeHostname(context.business.customer_domain);

  if (
    !config.sshHost.trim() ||
    !config.sshUser.trim() ||
    !config.sshRemoteBasePath.trim() ||
    !config.sshCustomerUrlTemplate.trim()
  ) {
    throw new Error(
      "Add the shared-server host, username, remote base path, and customer URL template in Settings before deploying customer sites."
    );
  }

  const deployment = await deployWithSharedServer(businessId, context, config, {
    customerDomain: requestedDomain,
    kind: "customer",
    logMessage: `Deploying a dedicated customer site for ${context.business.name} to the shared server`,
    postDeployCommand: config.sshCustomerPostDeployCommand,
    urlTemplate: config.sshCustomerUrlTemplate,
  });

  const verification = requestedDomain
    ? [
        {
          type: "MANUAL",
          domain: requestedDomain,
          value: config.sshHost.trim(),
          reason:
            "Point the domain to your shared server and ensure the customer post-deploy command provisions the virtual host and TLS certificate.",
        },
      ]
    : [];

  setBusinessCustomerProject(context.business.id, {
    provider: "ssh-static",
    projectId: deployment.projectId,
    projectName: deployment.projectName ?? context.generatedSite.slug,
    metadata: deployment.metadata ?? null,
  });

  if (requestedDomain) {
    setBusinessCustomerDomain(
      context.business.id,
      requestedDomain,
      false,
      verification
    );
  }

  return {
    ...deployment,
    aliasHost: requestedDomain,
    aliasUrl: null,
    customerDomain: requestedDomain,
    customerDomainVerification: verification,
    customerDomainVerified: false,
    projectCreated: false,
  };
}

export async function deployPreviewForBusiness(
  businessId: number,
  options?: { initiatedBy?: "automatic" | "manual" }
): Promise<DeployPreviewResult> {
  initializeDatabase();
  const config = getConfig();
  const context = latestGeneratedSiteForBusiness(businessId);
  const provider = config.previewDeploymentProvider;

  try {
    const deployment =
      provider === "cloudflare-pages"
        ? await deployPreviewWithCloudflare(businessId, context, config, options)
        : provider === "ssh-static"
          ? await deployPreviewWithSharedServer(
              businessId,
              context,
              config,
              options
            )
          : await deployPreviewWithVercel(businessId, context, config, options);

    insertSiteDeployment({
      aliasHost: deployment.aliasHost,
      aliasUrl: deployment.aliasUrl,
      businessId,
      deploymentId: deployment.deploymentId,
      deploymentKind: "preview",
      deploymentProvider: provider,
      deploymentUrl: deployment.deploymentUrl,
      generatedSiteId: context.generatedSite.id,
      metadata: deployment.metadata ?? null,
      projectId: deployment.projectId,
      projectName: deployment.projectName ?? null,
      readyState: deployment.readyState,
      target: "preview",
    });

    logActivity({
      kind: "deployment",
      stage: deployment.aliasUrl ? "aliased" : "completed",
      businessId,
      businessName: context.business.name,
      message: deployment.aliasUrl
        ? `Preview deployed for ${context.business.name} to ${deploymentProviderLabel(provider)} at ${deployment.aliasUrl}`
        : `Preview deployed for ${context.business.name} to ${deploymentProviderLabel(provider)} at ${deployment.deploymentUrl}`,
    });

    return {
      provider,
      aliasUrl: deployment.aliasUrl ?? null,
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.deploymentUrl,
      generatedSiteId: context.generatedSite.id,
      projectId: deployment.projectId,
      projectName: deployment.projectName ?? null,
      readyState: deployment.readyState ?? null,
      version: context.generatedSite.version,
    };
  } catch (error) {
    logActivity({
      kind: "deployment",
      stage: "failed",
      businessId,
      businessName: context.business.name,
      message: `Preview deployment failed for ${context.business.name} on ${deploymentProviderLabel(provider)}: ${toErrorMessage(
        error,
        "Unknown deployment error."
      )}`,
    });
    throw error;
  }
}

export async function deployCustomerProjectForBusiness(
  businessId: number,
  options?: { customerDomain?: string | null }
): Promise<DeployCustomerResult> {
  initializeDatabase();
  const config = getConfig();
  const context = latestGeneratedSiteForBusiness(businessId);
  const customerState = getCustomerProjectState(businessId);
  const provider = config.customerDeploymentProvider;

  try {
    const deployment =
      provider === "cloudflare-pages"
        ? await deployCustomerWithCloudflare(
            businessId,
            context,
            customerState,
            config,
            options
          )
        : provider === "ssh-static"
          ? await deployCustomerWithSharedServer(
              businessId,
              context,
              config,
              options
            )
          : await deployCustomerWithVercel(
              businessId,
              context,
              customerState,
              config,
              options
            );

    insertSiteDeployment({
      aliasHost: deployment.aliasHost,
      aliasUrl: deployment.aliasUrl,
      businessId,
      deploymentId: deployment.deploymentId,
      deploymentKind: "customer",
      deploymentProvider: provider,
      deploymentUrl: deployment.deploymentUrl,
      generatedSiteId: context.generatedSite.id,
      metadata: deployment.metadata ?? null,
      projectId: deployment.projectId,
      projectName: deployment.projectName ?? null,
      readyState: deployment.readyState,
      target: "production",
    });

    if (provider !== "ssh-static") {
      setBusinessCustomerProject(context.business.id, {
        provider,
        projectId: deployment.projectId,
        projectName: deployment.projectName ?? deployment.projectId,
        metadata: deployment.metadata ?? null,
      });
    }

    logActivity({
      kind: "deployment",
      stage: deployment.aliasUrl ? "aliased" : "completed",
      businessId,
      businessName: context.business.name,
      message: deployment.aliasUrl
        ? `Customer deployment for ${context.business.name} is live on ${deploymentProviderLabel(provider)} at ${deployment.aliasUrl}`
        : `Customer deployment for ${context.business.name} is live on ${deploymentProviderLabel(provider)} at ${deployment.deploymentUrl}`,
    });

    return {
      provider,
      aliasUrl: deployment.aliasUrl ?? null,
      customerDomain: deployment.customerDomain,
      customerDomainVerification: deployment.customerDomainVerification,
      customerDomainVerified: deployment.customerDomainVerified,
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.deploymentUrl,
      generatedSiteId: context.generatedSite.id,
      projectCreated: Boolean(deployment.projectCreated),
      projectId: deployment.projectId,
      projectName: deployment.projectName ?? null,
      readyState: deployment.readyState ?? null,
      version: context.generatedSite.version,
    };
  } catch (error) {
    logActivity({
      kind: "deployment",
      stage: "failed",
      businessId,
      businessName: context.business.name,
      message: `Customer deployment failed for ${context.business.name} on ${deploymentProviderLabel(provider)}: ${toErrorMessage(
        error,
        "Unknown deployment error."
      )}`,
    });
    throw error;
  }
}

export function getCustomerProjectState(businessId: number): CustomerProjectState {
  initializeDatabase();
  const db = getDb();
  const business = db
    .prepare(
      `SELECT
        customer_domain,
        customer_domain_verified,
        customer_domain_verification_json,
        customer_project_provider,
        customer_project_metadata_json,
        vercel_customer_project_id,
        vercel_customer_project_name
      FROM businesses
      WHERE id = ?`
    )
    .get(businessId) as
      | {
          customer_domain: string | null;
          customer_domain_verified: number | null;
          customer_domain_verification_json: string | null;
          customer_project_provider: string | null;
          customer_project_metadata_json: string | null;
          vercel_customer_project_id: string | null;
          vercel_customer_project_name: string | null;
        }
      | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const customerProjectId = business.vercel_customer_project_id ?? null;

  return {
    customerDomain: business.customer_domain ?? null,
    customerDomainVerification: parseVerification(
      business.customer_domain_verification_json
    ),
    customerDomainVerified: Number(business.customer_domain_verified ?? 0) === 1,
    customerProjectId,
    customerProjectMetadata: parseMetadata(
      business.customer_project_metadata_json
    ),
    customerProjectName: business.vercel_customer_project_name ?? null,
    customerProjectProvider: customerProjectId
      ? normalizeDeploymentProvider(business.customer_project_provider)
      : null,
  };
}
