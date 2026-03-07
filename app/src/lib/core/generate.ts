import fs from "fs";
import path from "path";
import { logActivity } from "../activity-log";
import {
  getConfiguredAiModel,
  getConfiguredAiProviderLabel,
} from "../ai-provider";
import { getConfig } from "../config";
import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import {
  generateSite,
  recommendSiteArchitecture,
  type BusinessData,
  type ExistingSiteFile,
  type GenerateSiteOptions,
  type SiteArchitectureRecommendation,
  type SourceBrandAsset,
} from "../claude";
import { downloadPlacePhoto } from "../places";
import {
  captureWebsiteSourceSnapshot,
  type WebsiteSourceSnapshot,
} from "../website-source";
import { captureWebsiteScreenshot } from "../website-screenshot";

const SITES_DIR = path.resolve(process.cwd(), "..", "sites");
const SOURCE_SNAPSHOT_PAGE_LIMIT = 12;
const SOURCE_SCREENSHOT_LIMIT = 4;
const EXISTING_SITE_FILE_LIMIT = 10;
const EXISTING_SITE_MAX_CHARS = 45000;
const EXISTING_SITE_MAX_CHARS_PER_FILE = 12000;
const CONTACT_CONFIG_PATH = "assets/curb-site-config.js";
const CONTACT_RUNTIME_PATH = "assets/curb-contact.js";
const VERCEL_CONFIG_PATH = "vercel.json";
const SOURCE_BRAND_DIR = "assets/brand";
const EDITABLE_SITE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".svg",
  ".txt",
]);

export interface GenerateResult {
  businessId: number;
  businessName: string;
  slug: string;
  sitePath: string;
  version: number;
  generationTimeMs: number;
}

interface GeneratedSiteFile {
  path: string;
  content: string;
}

function isEditableSiteFile(filePath: string): boolean {
  return EDITABLE_SITE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toEditableSiteFiles(files: GeneratedSiteFile[]): ExistingSiteFile[] {
  return files.filter((file) => isEditableSiteFile(file.path));
}

function inferImageExtension(
  rawUrl: string,
  contentType: string | null
): string | null {
  const normalizedContentType = contentType?.toLowerCase() ?? "";

  if (normalizedContentType.includes("svg")) return "svg";
  if (normalizedContentType.includes("png")) return "png";
  if (normalizedContentType.includes("webp")) return "webp";
  if (normalizedContentType.includes("gif")) return "gif";
  if (
    normalizedContentType.includes("jpeg") ||
    normalizedContentType.includes("jpg")
  ) {
    return "jpg";
  }

  try {
    const url = new URL(rawUrl);
    const extension = path.extname(url.pathname).toLowerCase();
    if (extension === ".svg") return "svg";
    if (extension === ".png") return "png";
    if (extension === ".webp") return "webp";
    if (extension === ".gif") return "gif";
    if (extension === ".jpg" || extension === ".jpeg") return "jpg";
  } catch {
    return null;
  }

  return null;
}

function scoreLogoCandidate(candidateUrl: string): number {
  let score = 0;
  const normalized = candidateUrl.toLowerCase();

  if (normalized.includes(".svg")) score += 20;
  if (normalized.includes("logo")) score += 12;
  if (normalized.includes("brand")) score += 6;
  if (normalized.includes("header")) score += 3;
  if (normalized.includes("icon")) score -= 10;
  if (normalized.includes("favicon")) score -= 20;

  return score;
}

async function downloadSourceLogoAsset(
  siteDir: string,
  snapshot: WebsiteSourceSnapshot | null | undefined
): Promise<SourceBrandAsset | null> {
  const candidates = Array.from(
    new Set(snapshot?.brand.logoCandidates.filter(Boolean) ?? [])
  ).sort((left, right) => scoreLogoCandidate(right) - scoreLogoCandidate(left));

  if (candidates.length === 0) {
    return null;
  }

  const brandDir = path.join(siteDir, ...SOURCE_BRAND_DIR.split("/"));
  fs.mkdirSync(brandDir, { recursive: true });

  for (const candidate of candidates) {
    try {
      const candidateUrl = new URL(candidate);
      if (!/^https?:$/i.test(candidateUrl.protocol)) {
        continue;
      }

      const response = await fetch(candidateUrl.toString(), {
        redirect: "follow",
      });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type");
      if (
        contentType &&
        /^text\/html\b/i.test(contentType.trim())
      ) {
        continue;
      }

      const extension = inferImageExtension(response.url || candidate, contentType);
      if (!extension) {
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0) {
        continue;
      }

      const relativePath = `${SOURCE_BRAND_DIR}/source-logo.${extension}`;
      const outputPath = path.join(siteDir, ...relativePath.split("/"));
      fs.writeFileSync(outputPath, buffer);

      return {
        relativePath,
        sourceUrl: response.url || candidate,
        mimeType: contentType,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function bundleReferencesAssetPath(
  files: GeneratedSiteFile[],
  assetPath: string
): boolean {
  const assetName = path.posix.basename(assetPath);
  return files.some(
    (file) => isEditableSiteFile(file.path) && file.content.includes(assetName)
  );
}

function countHtmlPages(files: GeneratedSiteFile[]): number {
  return files.filter((file) => isHtmlFile(file.path)).length;
}

function buildExactLogoCorrectionPrompt(relativePath: string): string {
  return [
    "Critical correction:",
    `Use the exact source logo asset from bundle path ${relativePath} for every visible logo placement, with the correct relative path from each page.`,
    "Replace any redrawn, text-only, approximate, simplified, or recreated logo treatment.",
    "Do not typeset the business name as a substitute mark when the exact logo file is available.",
  ].join(" ");
}

function buildMultiPageCorrectionPrompt(
  recommendation: SiteArchitectureRecommendation
): string {
  return [
    "Architecture correction:",
    "This website must be returned as a multi-page static site bundle.",
    "Return at least two HTML pages with a clear separation of concerns instead of collapsing everything into a single scrolling homepage.",
    recommendation.reasons.length > 0
      ? `Reasons: ${recommendation.reasons.join(" ")}`
      : "Reasons: the captured source material indicates a multi-page architecture.",
  ].join(" ");
}

function toAnchorIdFromLocalPath(localPath: string): string {
  if (localPath === "index.html") {
    return "top";
  }

  return localPath
    .replace(/\/index\.html$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeGeneratedFilePath(filePath: string): string | null {
  const trimmed = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }

  return normalized;
}

function parseGeneratedSiteFiles(payload: string): GeneratedSiteFile[] {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("Site generation returned an empty response.");
  }

  const hasFileMarkers = /<<<FILE:[^\n>]+>>>/i.test(trimmed);
  const matches = hasFileMarkers
    ? Array.from(
        trimmed.matchAll(/<<<FILE:([^\n>]+)>>>\s*([\s\S]*?)\s*<<<END FILE>>>/gi)
      )
    : [];

  if (matches.length > 0) {
    const fileMap = new Map<string, string>();
    for (const match of matches) {
      const nextPath = normalizeGeneratedFilePath(match[1] ?? "");
      const nextContent = (match[2] ?? "").trim();
      if (!nextPath || !nextContent) {
        continue;
      }

      fileMap.set(nextPath, nextContent);
    }

    const files = Array.from(fileMap.entries()).map(([filePath, content]) => ({
      path: filePath,
      content,
    }));

    if (files.length === 0) {
      throw new Error("Site generation returned no usable files.");
    }

    if (!files.some((file) => file.path === "index.html")) {
      throw new Error("Site generation must include an index.html homepage.");
    }

    return files;
  }

  if (/^<!DOCTYPE html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return [{ path: "index.html", content: trimmed }];
  }

  throw new Error("Site generation returned no valid site files.");
}

function isHtmlFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}

function routePathFromFilePath(filePath: string): string {
  if (filePath === "index.html") {
    return "/";
  }

  if (/\/index\.html$/i.test(filePath)) {
    return `/${filePath.replace(/\/index\.html$/i, "")}/`;
  }

  return `/${filePath}`;
}

function routeKeysForGeneratedFile(filePath: string): string[] {
  const keys = new Set<string>([`/${filePath}`]);
  if (isHtmlFile(filePath)) {
    keys.add(routePathFromFilePath(filePath));
  }
  return Array.from(keys);
}

function relativeHrefBetweenFiles(
  fromFilePath: string,
  toFilePath: string
): string {
  const fromDir =
    path.posix.dirname(fromFilePath) === "."
      ? ""
      : path.posix.dirname(fromFilePath);

  const targetPath = /\/index\.html$/i.test(toFilePath)
    ? toFilePath.replace(/index\.html$/i, "")
    : toFilePath;

  let relativeHref = path.posix.relative(fromDir, targetPath);
  if (!relativeHref) {
    return "./";
  }

  const targetIsDirectoryLike =
    /\/index\.html$/i.test(toFilePath) || !path.posix.extname(toFilePath);
  if (targetIsDirectoryLike && !relativeHref.endsWith("/")) {
    relativeHref += "/";
  }

  if (fromDir === "" && !relativeHref.startsWith(".")) {
    relativeHref = `./${relativeHref}`;
  }

  return relativeHref;
}

function normalizeInternalRoutePath(rawHref: string, currentFilePath: string): string | null {
  const trimmed = rawHref.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:")
  ) {
    return null;
  }

  const currentRoute = routePathFromFilePath(currentFilePath);
  const baseUrl = new URL(`https://generated.local${currentRoute}`);

  try {
    const candidateUrl = new URL(trimmed, baseUrl);
    const pathname = candidateUrl.pathname || "/";

    if (pathname === "/") {
      return "/";
    }

    if (pathname.endsWith(".html")) {
      return pathname.startsWith("/") ? pathname : `/${pathname}`;
    }

    return pathname.endsWith("/") ? pathname : `${pathname}/`;
  } catch {
    return null;
  }
}

function ensureTopAnchor(html: string): string {
  if (/id=["']top["']/i.test(html)) {
    return html;
  }

  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, '<body id="top"$1>');
  }

  return html;
}

function appendMissingSectionAnchors(html: string, anchorIds: string[]): string {
  const missingIds = anchorIds.filter(
    (anchorId) =>
      anchorId !== "top" &&
      !new RegExp(`id=["']${anchorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(html)
  );

  if (missingIds.length === 0) {
    return html;
  }

  const anchorMarkup = [
    '<div class="curb-generated-anchor-map" aria-hidden="true">',
    ...missingIds.map((anchorId) => `  <span id="${anchorId}"></span>`),
    "</div>",
  ].join("\n");

  if (/<\/main>/i.test(html)) {
    return html.replace(/<\/main>/i, `${anchorMarkup}\n</main>`);
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${anchorMarkup}\n</body>`);
  }

  return `${html}\n${anchorMarkup}`;
}

function rewriteSinglePageLinks(
  html: string,
  currentFilePath: string,
  sourceSiteSnapshot: GenerateSiteOptions["sourceSiteSnapshot"]
): string {
  if (!sourceSiteSnapshot || sourceSiteSnapshot.pages.length === 0) {
    return ensureTopAnchor(html);
  }

  const hrefToAnchor = new Map<string, string>();

  for (const page of sourceSiteSnapshot.pages) {
    const anchorId = toAnchorIdFromLocalPath(page.localPath);
    const anchorHref = anchorId === "top" ? "#top" : `#${anchorId}`;
    const pathValue =
      page.localPath === "index.html"
        ? "/"
        : `/${page.localPath.replace(/\/index\.html$/i, "")}/`;

    hrefToAnchor.set(pathValue, anchorHref);
    hrefToAnchor.set(pathValue.slice(0, -1), anchorHref);

    if (page.localPath !== "index.html") {
      const relativePath = page.localPath.replace(/\/index\.html$/i, "");
      hrefToAnchor.set(relativePath, anchorHref);
      hrefToAnchor.set(`${relativePath}/`, anchorHref);
    } else {
      hrefToAnchor.set("./", "#top");
      hrefToAnchor.set("index.html", "#top");
    }
  }

  let nextHtml = ensureTopAnchor(html);

  nextHtml = nextHtml.replace(
    /href=(["'])([^"']+)\1/gi,
    (fullMatch, quote: string, rawHref: string) => {
      const normalizedHref = normalizeInternalRoutePath(rawHref, currentFilePath);
      if (!normalizedHref) {
        return fullMatch;
      }

      const replacementHref = hrefToAnchor.get(normalizedHref);
      if (!replacementHref) {
        return fullMatch;
      }

      return `href=${quote}${replacementHref}${quote}`;
    }
  );

  return appendMissingSectionAnchors(
    nextHtml,
    sourceSiteSnapshot.pages.map((page) => toAnchorIdFromLocalPath(page.localPath))
  );
}

function rewriteBundleLinks(
  files: GeneratedSiteFile[],
  sourceSiteSnapshot: GenerateSiteOptions["sourceSiteSnapshot"]
): GeneratedSiteFile[] {
  const htmlFiles = files.filter((file) => isHtmlFile(file.path));
  const isSinglePage = htmlFiles.length <= 1;
  const routeToFilePath = new Map<string, string>();

  for (const file of files) {
    for (const routeKey of routeKeysForGeneratedFile(file.path)) {
      routeToFilePath.set(routeKey, file.path);
    }
  }

  if (sourceSiteSnapshot) {
    for (const page of sourceSiteSnapshot.pages) {
      const sourceRoute = routePathFromFilePath(page.localPath);
      if (routeToFilePath.has(sourceRoute)) {
        continue;
      }

      const matchingFile = htmlFiles.find(
        (file) => routePathFromFilePath(file.path) === sourceRoute
      );
      if (matchingFile) {
        routeToFilePath.set(sourceRoute, matchingFile.path);
      }
    }
  }

  return files.map((file) => {
    if (!isHtmlFile(file.path)) {
      return file;
    }

    if (isSinglePage) {
      return {
        ...file,
        content: rewriteSinglePageLinks(file.content, file.path, sourceSiteSnapshot),
      };
    }

    const rewritten = file.content.replace(
      /(href|src|action|poster)=(["'])([^"']+)\2/gi,
      (fullMatch, attribute: string, quote: string, rawHref: string) => {
        const normalizedRoute = normalizeInternalRoutePath(rawHref, file.path);
        if (!normalizedRoute) {
          return fullMatch;
        }

        const targetFilePath = routeToFilePath.get(normalizedRoute);
        if (!targetFilePath) {
          return fullMatch;
        }

        const hash = (() => {
          try {
            const candidateUrl = new URL(
              rawHref,
              `https://generated.local${routePathFromFilePath(file.path)}`
            );
            return candidateUrl.hash ?? "";
          } catch {
            return "";
          }
        })();

        return `${attribute}=${quote}${relativeHrefBetweenFiles(file.path, targetFilePath)}${hash}${quote}`;
      }
    );

    return {
      ...file,
      content: rewritten,
    };
  });
}

function resetSiteDirectory(siteDir: string): void {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
}

function writeGeneratedSiteFiles(
  siteDir: string,
  files: GeneratedSiteFile[]
): void {
  for (const file of files) {
    const outputPath = path.join(siteDir, ...file.path.split("/"));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, file.content, "utf-8");
  }
}

function walkDirectoryFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function readExistingSiteFiles(siteDir: string): ExistingSiteFile[] {
  const files = walkDirectoryFiles(siteDir)
    .filter((fullPath) => {
      const relativePath = path
        .relative(siteDir, fullPath)
        .split(path.sep)
        .join("/");

      if (
        relativePath.startsWith("assets/photos/") ||
        relativePath === "__source_snapshot.json"
      ) {
        return false;
      }

      return isEditableSiteFile(relativePath);
    })
    .slice(0, EXISTING_SITE_FILE_LIMIT);

  let usedChars = 0;
  const collected: ExistingSiteFile[] = [];

  for (const fullPath of files) {
    if (usedChars >= EXISTING_SITE_MAX_CHARS) {
      break;
    }

    const relativePath = path
      .relative(siteDir, fullPath)
      .split(path.sep)
      .join("/");

    try {
      const remainingChars = EXISTING_SITE_MAX_CHARS - usedChars;
      const content = fs.readFileSync(fullPath, "utf-8");
      const trimmedContent = content.slice(
        0,
        Math.min(EXISTING_SITE_MAX_CHARS_PER_FILE, remainingChars)
      );
      usedChars += trimmedContent.length;
      collected.push({
        path: relativePath,
        content: trimmedContent,
      });
    } catch {
      continue;
    }
  }

  return collected;
}

function buildPortableContactConfig(
  businessData: BusinessData
): string {
  const config = getConfig();
  const directRecipient = businessData.email?.trim() ?? "";
  const fallbackRecipient = config.businessEmail?.trim() ?? "";
  const recipientEmail = directRecipient || fallbackRecipient;
  const recipientSource = directRecipient
    ? "business"
    : fallbackRecipient
      ? "fallback"
      : "unset";

  const siteConfig = {
    businessName: businessData.name,
    contact: {
      recipientEmail,
      recipientSource,
      deliveryMode: "mailto",
      subjectPrefix: `New website lead for ${businessData.name}`,
      fallbackMessage:
        "If your email app did not open, copy the prepared message below and send it manually.",
    },
  };

  return [
    "// Update recipientEmail before handing the site off to the customer if needed.",
    `window.CURB_SITE_CONFIG = ${JSON.stringify(siteConfig, null, 2)};`,
    "",
  ].join("\n");
}

const PORTABLE_CONTACT_RUNTIME = `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var contactConfig = siteConfig.contact || {};

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function ensureStatus(form) {
    var status = form.querySelector("[data-curb-form-status]");
    if (status) {
      return status;
    }

    status = document.createElement("div");
    status.setAttribute("data-curb-form-status", "true");
    status.style.marginTop = "0.75rem";
    status.style.fontSize = "0.95rem";
    form.appendChild(status);
    return status;
  }

  function ensureFallback(form) {
    var fallback = form.querySelector("[data-curb-mailto-fallback]");
    if (fallback) {
      return fallback;
    }

    fallback = document.createElement("div");
    fallback.setAttribute("data-curb-mailto-fallback", "true");
    fallback.hidden = true;
    fallback.style.marginTop = "1rem";
    fallback.style.padding = "1rem";
    fallback.style.border = "1px solid rgba(15, 23, 42, 0.12)";
    fallback.style.borderRadius = "0.75rem";
    fallback.style.background = "rgba(248, 250, 252, 0.96)";
    fallback.innerHTML =
      '<p data-curb-mailto-copy-message style="margin:0 0 0.75rem 0;font-size:0.95rem;"></p>' +
      '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">' +
      '<a data-curb-mailto-link href="#" style="font-weight:600;">Open email app again</a>' +
      '<button data-curb-mailto-copy type="button" style="padding:0.6rem 0.9rem;border-radius:999px;border:0;background:#0f172a;color:#fff;cursor:pointer;">Copy message</button>' +
      "</div>" +
      '<pre data-curb-mailto-preview style="margin:0;white-space:pre-wrap;font-size:0.85rem;line-height:1.5;"></pre>';
    form.appendChild(fallback);
    return fallback;
  }

  function setStatus(form, type, message) {
    var status = ensureStatus(form);
    status.textContent = message;
    status.style.color = type === "error" ? "#b42318" : "#166534";
  }

  function serializeForm(form) {
    var formData = new FormData(form);
    var pairs = [];
    formData.forEach(function (value, key) {
      if (typeof value === "string" && value.trim()) {
        pairs.push([key, value.trim()]);
      }
    });
    return pairs;
  }

  function looksLikeContactForm(form) {
    if (form.getAttribute("data-curb-contact-form") === "true") {
      return true;
    }

    var tokens = [];
    var controls = form.querySelectorAll("input, textarea, select");
    controls.forEach(function (control) {
      ["name", "id", "placeholder", "aria-label"].forEach(function (attribute) {
        var value = control.getAttribute(attribute);
        if (value) {
          tokens.push(value.toLowerCase());
        }
      });
    });

    var haystack = tokens.join(" ");
    return /(name|email|phone|message|quote|service|appointment|booking)/.test(haystack);
  }

  function shouldHandleForm(form) {
    if (!looksLikeContactForm(form)) {
      return false;
    }

    var action = text(form.getAttribute("action"));
    if (!action || action === "#") {
      return true;
    }

    if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(action)) {
      return false;
    }

    return !/^(https?:)?\\/\\//i.test(action);
  }

  function buildMailtoUrl(recipient, pairs) {
    var lines = pairs.map(function (pair) {
      return pair[0] + ": " + pair[1];
    });
    var subject = text(contactConfig.subjectPrefix) || "Website inquiry";
    return "mailto:" + encodeURIComponent(recipient) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\\n"));
  }

  function buildFallbackText(recipient, pairs) {
    var subject = text(contactConfig.subjectPrefix) || "Website inquiry";
    var body = pairs.map(function (pair) {
      return pair[0] + ": " + pair[1];
    }).join("\\n");
    return [
      "To: " + recipient,
      "Subject: " + subject,
      "",
      body
    ].join("\\n");
  }

  function showFallback(form, recipient, mailtoUrl, fallbackText) {
    var fallback = ensureFallback(form);
    var message = fallback.querySelector("[data-curb-mailto-copy-message]");
    var link = fallback.querySelector("[data-curb-mailto-link]");
    var preview = fallback.querySelector("[data-curb-mailto-preview]");
    var copyButton = fallback.querySelector("[data-curb-mailto-copy]");
    var hint =
      text(contactConfig.fallbackMessage) ||
      "If your email app did not open, copy the prepared message below.";

    if (message) {
      message.textContent = hint;
    }
    if (link) {
      link.setAttribute("href", mailtoUrl);
    }
    if (preview) {
      preview.textContent = fallbackText;
    }
    if (copyButton) {
      copyButton.onclick = async function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fallbackText);
            copyButton.textContent = "Copied";
            window.setTimeout(function () {
              copyButton.textContent = "Copy message";
            }, 1800);
            return;
          }
        } catch (error) {
          void error;
        }

        window.prompt("Copy this email message", fallbackText);
      };
    }

    fallback.hidden = false;
  }

  function bindForm(form) {
    if (form.dataset.curbBound === "true" || !shouldHandleForm(form)) {
      return;
    }

    form.dataset.curbBound = "true";

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var submitter = form.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
      }

      var pairs = serializeForm(form);
      var recipient = text(contactConfig.recipientEmail);
      var mailtoUrl = buildMailtoUrl(recipient, pairs);
      var fallbackText = buildFallbackText(recipient, pairs);
      var composerOpened = false;
      var visibilityHandler = function () {
        if (document.hidden) {
          composerOpened = true;
        }
      };

      try {
        if (!recipient) {
          throw new Error(
            "Set contact.recipientEmail in assets/curb-site-config.js before launch."
          );
        }

        document.addEventListener("visibilitychange", visibilityHandler, {
          once: false
        });
        setStatus(form, "success", "Opening your email app...");
        window.location.href = mailtoUrl;

        window.setTimeout(function () {
          document.removeEventListener("visibilitychange", visibilityHandler);
          if (!composerOpened) {
            setStatus(form, "error", "Email app not detected.");
            showFallback(form, recipient, mailtoUrl, fallbackText);
            return;
          }

          showFallback(form, recipient, mailtoUrl, fallbackText);
          setStatus(
            form,
            "success",
            "Your email draft should be open. Send it from your mail app."
          );
        }, 1200);
      } catch (error) {
        var message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to send your message right now.";
        setStatus(form, "error", message);
      } finally {
        if (submitter) {
          submitter.disabled = false;
        }
      }
    });
  }

  function bindForms() {
    Array.prototype.slice.call(document.forms || []).forEach(bindForm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindForms);
  } else {
    bindForms();
  }
})();`;

function injectPortableRuntime(
  files: GeneratedSiteFile[],
  businessData: BusinessData
): GeneratedSiteFile[] {
  const fileMap = new Map<string, GeneratedSiteFile>();

  for (const file of files) {
    fileMap.set(file.path, file);
  }

  fileMap.set(CONTACT_CONFIG_PATH, {
    path: CONTACT_CONFIG_PATH,
    content: buildPortableContactConfig(businessData),
  });
  fileMap.set(CONTACT_RUNTIME_PATH, {
    path: CONTACT_RUNTIME_PATH,
    content: `${PORTABLE_CONTACT_RUNTIME}\n`,
  });
  fileMap.set(VERCEL_CONFIG_PATH, {
    path: VERCEL_CONFIG_PATH,
    content: `${JSON.stringify(
      {
        cleanUrls: true,
        trailingSlash: true,
      },
      null,
      2
    )}\n`,
  });

  return Array.from(fileMap.values()).map((file) => {
    if (!isHtmlFile(file.path)) {
      return file;
    }

    const configSrc = relativeHrefBetweenFiles(file.path, CONTACT_CONFIG_PATH);
    const runtimeSrc = relativeHrefBetweenFiles(file.path, CONTACT_RUNTIME_PATH);
    const scriptMarkup = [
      `  <script src="${configSrc}"></script>`,
      `  <script src="${runtimeSrc}" defer></script>`,
    ].join("\n");

    if (/curb-site-config\.js/i.test(file.content)) {
      return file;
    }

    if (/<\/body>/i.test(file.content)) {
      return {
        ...file,
        content: file.content.replace(/<\/body>/i, `${scriptMarkup}\n</body>`),
      };
    }

    if (/<\/html>/i.test(file.content)) {
      return {
        ...file,
        content: file.content.replace(/<\/html>/i, `${scriptMarkup}\n</html>`),
      };
    }

    return {
      ...file,
      content: `${file.content}\n${scriptMarkup}\n`,
    };
  });
}

function businessRowToData(
  row: Record<string, unknown>
): BusinessData {
  return {
    name: row.name as string,
    category: (row.category as string) ?? null,
    address: (row.address as string) ?? null,
    city: (row.city as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website_url: (row.website_url as string) ?? null,
    rating: (row.rating as number) ?? null,
    review_count: (row.review_count as number) ?? null,
    hours_json: (row.hours_json as string) ?? null,
    photos_json: (row.photos_json as string) ?? null,
    google_maps_url: (row.google_maps_url as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
  };
}

async function downloadPhotos(
  photosJson: string | null,
  slug: string
): Promise<string[]> {
  if (!photosJson) return [];

  let photoRefs: string[];
  try {
    photoRefs = JSON.parse(photosJson);
  } catch {
    return [];
  }

  if (!Array.isArray(photoRefs) || photoRefs.length === 0) return [];

  const toDownload = photoRefs.slice(0, 5);
  const downloadedPaths: string[] = [];

  for (const ref of toDownload) {
    try {
      const relativePath = await downloadPlacePhoto(ref, slug);
      downloadedPaths.push(relativePath);
    } catch (err) {
      console.error(
        `Failed to download photo for ${slug}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return downloadedPaths;
}

export async function generateSiteForBusiness(
  businessId: number,
  modificationPrompt?: string
): Promise<GenerateResult> {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(businessId) as Record<string, unknown> | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const slug = business.slug as string;
  const name = business.name as string;
  const photosJson = business.photos_json as string | null;
  const websiteUrl = business.website_url as string | null;

  // Create directory structure
  const siteDir = path.join(SITES_DIR, slug);
  const existingSiteFiles = readExistingSiteFiles(siteDir);
  resetSiteDirectory(siteDir);

  // Prepare business data for the configured AI provider
  const businessData = businessRowToData(business);

  logActivity({
    kind: "generation",
    stage: "started",
    businessId,
    businessName: name,
    message: `Started website generation for ${name}`,
  });

  try {
    const startTime = Date.now();
    const aiConfig = getConfig();
    const providerLabel = getConfiguredAiProviderLabel(aiConfig);
    const modelUsed = `${aiConfig.aiProvider}:${getConfiguredAiModel(aiConfig)}`;
    const assetsDir = path.join(siteDir, "assets", "photos");
    fs.mkdirSync(assetsDir, { recursive: true });

    logActivity({
      kind: "generation",
      stage: "assets",
      businessId,
      businessName: name,
      message: `Downloading local business photos for ${name}`,
    });
    await downloadPhotos(photosJson, slug);

    logActivity({
      kind: "generation",
      stage: "crawl",
      businessId,
      businessName: name,
      message: websiteUrl
        ? `Capturing source-site content with Playwright from ${websiteUrl}`
        : `No live website found for ${name}; generating from business data only`,
    });
    const sourceSiteSnapshot = websiteUrl
      ? await captureWebsiteSourceSnapshot(websiteUrl, {
          maxPages: SOURCE_SNAPSHOT_PAGE_LIMIT,
        }).catch((err) => {
          console.error(
            `Failed to capture website snapshot for ${slug}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          return null;
        })
      : null;

    if (sourceSiteSnapshot) {
      const snapshotPath = path.join(siteDir, "__source_snapshot.json");
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify(sourceSiteSnapshot, null, 2),
        "utf-8"
      );

      logActivity({
        kind: "generation",
        stage: "crawl_complete",
        businessId,
        businessName: name,
        message: `Captured ${sourceSiteSnapshot.pageCount} source pages for ${name}`,
      });
    }

    const screenshotUrls = Array.from(
      new Set(
        (
          sourceSiteSnapshot?.pages.map((page) => page.url) ??
          (websiteUrl ? [websiteUrl] : [])
        ).filter(Boolean)
      )
    ).slice(0, SOURCE_SCREENSHOT_LIMIT);

    const sourceSiteVisuals: NonNullable<
      GenerateSiteOptions["sourceSiteVisuals"]
    > = [];
    const sourceBrandAssets: NonNullable<
      GenerateSiteOptions["sourceBrandAssets"]
    > = {};

    sourceBrandAssets.logo = await downloadSourceLogoAsset(
      siteDir,
      sourceSiteSnapshot
    );

    if (sourceBrandAssets.logo) {
      logActivity({
        kind: "generation",
        stage: "assets",
        businessId,
        businessName: name,
        message: `Captured exact source logo asset for ${name}`,
      });
    }

    if (screenshotUrls.length > 0) {
      logActivity({
        kind: "generation",
        stage: "screenshots",
        businessId,
        businessName: name,
        message: `Capturing ${screenshotUrls.length} live screenshots for ${name}`,
      });
    }

    for (const sourceUrl of screenshotUrls) {
      try {
        const screenshot = await captureWebsiteScreenshot(sourceUrl, slug);
        sourceSiteVisuals.push({
          finalUrl: screenshot.finalUrl,
          pageTitle: screenshot.pageTitle,
          screenshotBase64: screenshot.base64,
          screenshotMediaType: screenshot.mediaType,
          pageSignals: screenshot.pageSignals,
        });
      } catch (err) {
        console.error(
          `Failed to capture screenshot for ${slug} (${sourceUrl}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const architectureRecommendation = recommendSiteArchitecture({
      existingSiteFiles,
      sourceSiteSnapshot,
      sourceBrandAssets,
      sourceSiteVisuals,
    });
    const requiresMultiPageBundle =
      architectureRecommendation.mode === "multi-page" &&
      architectureRecommendation.required;

    logActivity({
      kind: "generation",
      stage: "model",
      businessId,
      businessName: name,
      message: `Generating upgraded production site with ${providerLabel} for ${name}`,
    });
    let payload = await generateSite(businessData, {
      modificationPrompt,
      existingSiteFiles,
      sourceSiteSnapshot,
      sourceBrandAssets,
      sourceSiteVisuals,
    });
    let parsedFiles = parseGeneratedSiteFiles(payload);
    let normalizedFiles = injectPortableRuntime(
      rewriteBundleLinks(parsedFiles, sourceSiteSnapshot),
      businessData
    );

    const correctionPrompts: string[] = [];
    if (
      sourceBrandAssets.logo &&
      !bundleReferencesAssetPath(
        normalizedFiles,
        sourceBrandAssets.logo.relativePath
      )
    ) {
      correctionPrompts.push(
        buildExactLogoCorrectionPrompt(sourceBrandAssets.logo.relativePath)
      );
    }

    if (requiresMultiPageBundle && countHtmlPages(normalizedFiles) < 2) {
      correctionPrompts.push(
        buildMultiPageCorrectionPrompt(architectureRecommendation)
      );
    }

    if (correctionPrompts.length > 0) {
      logActivity({
        kind: "generation",
        stage: "model",
        businessId,
        businessName: name,
        message: `Revising generated bundle to enforce required output constraints for ${name}`,
      });

      payload = await generateSite(businessData, {
        modificationPrompt: [
          modificationPrompt?.trim() || null,
          ...correctionPrompts,
        ]
          .filter(Boolean)
          .join("\n\n"),
        existingSiteFiles: toEditableSiteFiles(normalizedFiles),
        sourceSiteSnapshot,
        sourceBrandAssets,
        sourceSiteVisuals,
      });
      parsedFiles = parseGeneratedSiteFiles(payload);
      normalizedFiles = injectPortableRuntime(
        rewriteBundleLinks(parsedFiles, sourceSiteSnapshot),
        businessData
      );

      if (
        sourceBrandAssets.logo &&
        !bundleReferencesAssetPath(
          normalizedFiles,
          sourceBrandAssets.logo.relativePath
        )
      ) {
        throw new Error(
          `Generated site did not use the exact source logo asset at ./${sourceBrandAssets.logo.relativePath}.`
        );
      }

      if (requiresMultiPageBundle && countHtmlPages(normalizedFiles) < 2) {
        throw new Error(
          "Generated site returned only one HTML page even though a multi-page bundle was required."
        );
      }
    }

    logActivity({
      kind: "generation",
      stage: "write",
      businessId,
      businessName: name,
      message: `Writing ${normalizedFiles.length} generated file${normalizedFiles.length === 1 ? "" : "s"} for ${name}`,
    });
    writeGeneratedSiteFiles(siteDir, normalizedFiles);

    const generationTimeMs = Date.now() - startTime;

    // Determine version
    const latestVersion = db
      .prepare(
        "SELECT MAX(version) as max_version FROM generated_sites WHERE business_id = ?"
      )
      .get(businessId) as { max_version: number | null } | undefined;

    const version = (latestVersion?.max_version ?? 0) + 1;

    // Insert generated_sites record
    const sitePath = path.relative(
      path.resolve(process.cwd(), ".."),
      siteDir
    );

    db.prepare(
      `INSERT INTO generated_sites (
        business_id, version, slug, site_path, prompt_used, model_used,
        generation_time_ms, exported
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      businessId,
      version,
      slug,
      sitePath,
      modificationPrompt ?? null,
      modelUsed,
      generationTimeMs
    );

    // Update business status
    db.prepare(
      "UPDATE businesses SET status = 'generated', updated_at = datetime('now') WHERE id = ?"
    ).run(businessId);

    logActivity({
      kind: "generation",
      stage: "completed",
      businessId,
      businessName: name,
      message: `Generated production site for ${name} in ${Math.round(
        generationTimeMs / 1000
      )}s`,
    });

    return {
      businessId,
      businessName: name,
      slug,
      sitePath: siteDir,
      version,
      generationTimeMs,
    };
  } catch (error) {
    logActivity({
      kind: "generation",
      stage: "failed",
      businessId,
      businessName: name,
      message: `Website generation failed for ${name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    throw error;
  }
}
