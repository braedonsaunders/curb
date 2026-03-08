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
  modifySiteWithTools,
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
const SOURCE_SNAPSHOT_FILE = "__source_snapshot.json";
const EDITABLE_SITE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".svg",
  ".txt",
]);
const REQUESTED_ROUTE_PATTERNS: Array<{
  route: string;
  pattern: RegExp;
}> = [
  { route: "/about-us/", pattern: /\babout(?:\s+us)?\b/i },
  { route: "/contact/", pattern: /\bcontact(?:\s+us)?\b/i },
  { route: "/gallery/", pattern: /\bgallery\b/i },
  { route: "/menu/", pattern: /\bmenu\b/i },
  { route: "/services/", pattern: /\bservices?\b/i },
];

export interface GenerateResult {
  businessId: number;
  businessName: string;
  slug: string;
  sitePath: string;
  version: number;
  generationTimeMs: number;
}

export type SiteGenerationMode = "generate" | "modify" | "regenerate";

export interface GenerateSiteForBusinessOptions {
  mode?: SiteGenerationMode;
  prompt?: string;
}

interface GeneratedSiteFile {
  path: string;
  content: string;
}

interface MissingBundleReference {
  fromFilePath: string;
  rawReference: string;
  resolvedTarget: string;
  targetType: "file" | "route";
}

interface MissingPageLink {
  fromFilePath: string;
  rawReference: string;
  resolvedTarget: string;
}

interface GeneratedBundleValidationResult {
  htmlPageCount: number;
  missingNonPageBundleReferences: MissingBundleReference[];
  missingPageLinks: MissingPageLink[];
  missingRequestedPageRoutes: string[];
}

function buildMissingReferenceKey(
  issue: Pick<
    MissingBundleReference,
    "fromFilePath" | "rawReference" | "resolvedTarget" | "targetType"
  >
): string {
  return `${issue.fromFilePath}::${issue.rawReference}::${issue.targetType}::${issue.resolvedTarget}`;
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

function inferImageMimeType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return null;
}

function extractRequestedRouteAliases(
  modificationPrompt: string | undefined
): string[] {
  const normalizedPrompt = modificationPrompt?.trim();
  if (!normalizedPrompt) {
    return [];
  }

  if (
    !/\b(page|pages|link|links|nav|navigation|route|routes|tab|tabs)\b/i.test(
      normalizedPrompt
    )
  ) {
    return [];
  }

  return REQUESTED_ROUTE_PATTERNS.filter(({ pattern }) =>
    pattern.test(normalizedPrompt)
  ).map(({ route }) => route);
}

type SourceLogoCandidate = {
  altTexts: string[];
  explicit: boolean;
  frequency: number;
  url: string;
};

const LOGO_CONTEXT_STOPWORDS = new Set([
  "and",
  "ca",
  "com",
  "contact",
  "home",
  "http",
  "https",
  "inc",
  "ltd",
  "map",
  "the",
  "us",
  "www",
]);

const THIRD_PARTY_LOGO_HINTS = [
  "americanexpress",
  "amex",
  "facebook",
  "fedex",
  "google",
  "instagram",
  "mastercard",
  "paypal",
  "pngwing",
  "qrcode",
  "qr-code",
  "twitter",
  "u-haul",
  "uhaul",
  "visa",
  "youtube",
];

function tokenizeLogoContext(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 && !LOGO_CONTEXT_STOPWORDS.has(token)
    );
}

function buildBrandTokens(
  snapshot: WebsiteSourceSnapshot | null | undefined
): Set<string> {
  const tokens = new Set<string>();

  if (!snapshot) {
    return tokens;
  }

  const contextValues: string[] = [snapshot.finalUrl];
  for (const page of snapshot.pages) {
    if (page.title) {
      contextValues.push(page.title);
    }

    for (const heading of page.headings.slice(0, 6)) {
      contextValues.push(heading);
    }
  }

  for (const value of contextValues) {
    for (const token of tokenizeLogoContext(value)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function buildLogoCandidatePool(
  snapshot: WebsiteSourceSnapshot | null | undefined
): SourceLogoCandidate[] {
  if (!snapshot) {
    return [];
  }

  const candidates = new Map<string, SourceLogoCandidate>();

  const upsertCandidate = (
    url: string | null | undefined,
    altText: string | null | undefined,
    explicit: boolean
  ) => {
    const trimmedUrl = url?.trim();
    if (!trimmedUrl) {
      return;
    }

    const existing = candidates.get(trimmedUrl);
    if (existing) {
      existing.frequency += 1;
      existing.explicit = existing.explicit || explicit;

      const normalizedAltText = altText?.trim();
      if (
        normalizedAltText &&
        !existing.altTexts.includes(normalizedAltText)
      ) {
        existing.altTexts.push(normalizedAltText);
      }
      return;
    }

    candidates.set(trimmedUrl, {
      url: trimmedUrl,
      altTexts: altText?.trim() ? [altText.trim()] : [],
      explicit,
      frequency: 1,
    });
  };

  for (const candidate of snapshot.brand.logoCandidates.filter(Boolean)) {
    upsertCandidate(candidate, "", true);
  }

  for (const page of snapshot.pages) {
    for (const image of page.images) {
      upsertCandidate(image.src, image.alt, false);
    }
  }

  return Array.from(candidates.values());
}

function scoreLogoCandidate(
  candidate: SourceLogoCandidate,
  brandTokens: Set<string>
): number {
  let score = 0;
  const normalized = `${candidate.url} ${candidate.altTexts.join(" ")}`
    .toLowerCase();

  if (candidate.explicit) score += 20;
  score += Math.min(candidate.frequency * 8, 48);
  if (normalized.includes(".svg")) score += 20;
  if (normalized.includes("logo")) score += 12;
  if (normalized.includes("brand")) score += 6;
  if (normalized.includes("header")) score += 18;
  if (normalized.includes("icon")) score -= 10;
  if (normalized.includes("favicon")) score -= 20;

  let brandMatches = 0;
  for (const token of brandTokens) {
    if (normalized.includes(token)) {
      brandMatches += 1;
    }
  }
  score += Math.min(brandMatches * 10, 30);

  for (const hint of THIRD_PARTY_LOGO_HINTS) {
    if (normalized.includes(hint)) {
      score -= 40;
    }
  }

  return score;
}

async function downloadSourceLogoAsset(
  siteDir: string,
  snapshot: WebsiteSourceSnapshot | null | undefined
): Promise<SourceBrandAsset | null> {
  const brandTokens = buildBrandTokens(snapshot);
  const candidates = buildLogoCandidatePool(snapshot)
    .filter((candidate) => {
      const normalized = `${candidate.url} ${candidate.altTexts.join(" ")}`
        .toLowerCase();

      const hasBrandToken = Array.from(brandTokens).some((token) =>
        normalized.includes(token)
      );

      return (
        candidate.explicit ||
        candidate.frequency > 1 ||
        hasBrandToken ||
        normalized.includes("logo") ||
        normalized.includes("brand") ||
        normalized.includes("header")
      );
    })
    .sort(
      (left, right) =>
        scoreLogoCandidate(right, brandTokens) -
        scoreLogoCandidate(left, brandTokens)
    )
    .map((candidate) => candidate.url);

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

function isBelowRecommendedHtmlPageCount(
  recommendation: SiteArchitectureRecommendation,
  htmlPageCount: number
): boolean {
  return htmlPageCount < recommendation.minimumHtmlPageCount;
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
    `Return at least ${recommendation.minimumHtmlPageCount} substantive HTML pages with a clear separation of concerns instead of collapsing everything into a single scrolling homepage.`,
    recommendation.reasons.length > 0
      ? `Reasons: ${recommendation.reasons.join(" ")}`
      : "Reasons: the captured source material indicates a multi-page architecture.",
  ].join(" ");
}

function buildBundleIntegrityCorrectionPrompt(
  missingReferences: MissingBundleReference[]
): string {
  const examples = missingReferences
    .slice(0, 8)
    .map(
      (issue) =>
        `${issue.fromFilePath} references "${issue.rawReference}" but the bundle is missing ${issue.targetType} ${issue.resolvedTarget}.`
    )
    .join(" ");

  return [
    "Bundle integrity correction:",
    "Every local href, src, poster, action, srcset, and CSS url() reference must resolve to a real page or asset inside the returned static bundle.",
    "Add the missing files or pages, or rewrite the references to existing bundle paths.",
    "Do not reference assets/style.css, contact/index.html, products/index.html, or any other local path unless that exact file exists in the returned bundle.",
    examples,
  ].join(" ");
}

function buildMissingPageLinkCorrectionPrompt(
  missingPageLinks: MissingPageLink[]
): string {
  const examples = missingPageLinks
    .slice(0, 8)
    .map(
      (issue) =>
        `${issue.fromFilePath} links to "${issue.rawReference}" but no HTML page exists for ${issue.resolvedTarget}.`
    )
    .join(" ");

  return [
    "Internal page-link correction:",
    "Every internal <a href> link to another page in the site must resolve to a real HTML page in the returned bundle.",
    "Add the missing destination pages as HTML files, or change those links to existing pages if the destinations were mistakes.",
    "Do not leave navigation, CTA, card, or footer links pointing at routes that are not returned as HTML pages.",
    examples,
  ].join(" ");
}

function findMissingRequestedPageRoutes(
  files: GeneratedSiteFile[],
  requestedRoutes: string[]
): string[] {
  if (requestedRoutes.length === 0) {
    return [];
  }

  const exactRouteKeys = new Set(
    files
      .filter((file) => isHtmlFile(file.path))
      .flatMap((file) => routeKeysForGeneratedFile(file.path))
  );
  const htmlAliasTargets = files
    .filter((file) => isHtmlFile(file.path))
    .map((file) => buildRouteAliasTarget(routePathFromFilePath(file.path), file.path));

  return requestedRoutes.filter((route) => {
    if (exactRouteKeys.has(route)) {
      return false;
    }

    return !findBestRouteAliasTarget(route, htmlAliasTargets);
  });
}

function buildRequestedPageCorrectionPrompt(routes: string[]): string {
  return [
    "Requested page correction:",
    `The user explicitly asked for working top-level pages for: ${routes.join(", ")}.`,
    "Return a real dedicated HTML page, or a clearly equivalent dedicated page, for each requested item and make sure navigation points to those pages.",
    "Do not leave these requests as broken links or collapse them into a homepage-only section.",
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

function stripGeneratedPayloadCodeFences(text: string): string {
  let result = text.trim();
  if (result.startsWith("```html")) {
    result = result.slice(7);
  } else if (result.startsWith("```json")) {
    result = result.slice(7);
  } else if (result.startsWith("```")) {
    result = result.slice(3);
  }

  if (result.endsWith("```")) {
    result = result.slice(0, -3);
  }

  return result.trim();
}

function extractGeneratedSiteFileBlocks(payload: string): GeneratedSiteFile[] {
  const startPattern = /<<<\s*FILE:\s*([^\n>]+?)\s*>>>/gi;
  const endPattern = /<<<\s*END\s+FILE(?:\s*:[^\n>]+)?\s*>>>/i;
  const markers = Array.from(payload.matchAll(startPattern));

  if (markers.length === 0) {
    return [];
  }

  const fileMap = new Map<string, string>();

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const markerIndex = marker.index;
    const nextMarkerIndex = markers[index + 1]?.index ?? payload.length;
    const nextPath = normalizeGeneratedFilePath(marker[1] ?? "");

    if (markerIndex == null || !nextPath) {
      continue;
    }

    let blockContent = payload.slice(
      markerIndex + marker[0].length,
      nextMarkerIndex
    );
    const endMatch = endPattern.exec(blockContent);
    if (endMatch && endMatch.index != null) {
      blockContent = blockContent.slice(0, endMatch.index);
    }

    const nextContent = stripGeneratedPayloadCodeFences(blockContent.trim());
    if (!nextContent) {
      continue;
    }

    fileMap.set(nextPath, nextContent);
  }

  return Array.from(fileMap.entries()).map(([path, content]) => ({
    path,
    content,
  }));
}

function extractHtmlDocumentFromPayload(payload: string): string | null {
  const doctypeMatch = payload.match(/<!DOCTYPE html[\s\S]*$/i);
  if (doctypeMatch?.[0]) {
    return stripGeneratedPayloadCodeFences(doctypeMatch[0].trim());
  }

  const htmlMatch = payload.match(/<html[\s\S]*$/i);
  if (htmlMatch?.[0]) {
    return stripGeneratedPayloadCodeFences(htmlMatch[0].trim());
  }

  return null;
}

function parseGeneratedSiteFiles(payload: string): GeneratedSiteFile[] {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("Site generation returned an empty response.");
  }

  const files = extractGeneratedSiteFileBlocks(trimmed);
  if (files.length > 0) {
    if (!files.some((file) => file.path === "index.html")) {
      throw new Error("Site generation must include an index.html homepage.");
    }

    return files;
  }

  const htmlDocument = extractHtmlDocumentFromPayload(trimmed);
  if (htmlDocument) {
    return [{ path: "index.html", content: htmlDocument }];
  }

  const preview = trimmed.replace(/\s+/g, " ").slice(0, 180);
  throw new Error(
    `Site generation returned no valid site files. Response preview: ${preview}`
  );
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

interface RouteAliasTarget<T> {
  route: string;
  value: T;
  tokens: string[];
  segmentCount: number;
}

function normalizeRouteAliasToken(token: string): string {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith("ies") && trimmed.length > 4) {
    return `${trimmed.slice(0, -3)}y`;
  }

  if (trimmed.endsWith("s") && !trimmed.endsWith("ss") && trimmed.length > 3) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

function routeAliasPathname(rawRoute: string): string | null {
  const trimmed = rawRoute.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const resolvedUrl = new URL(trimmed, "https://generated.local/");
    return resolvedUrl.pathname || "/";
  } catch {
    return null;
  }
}

function routeAliasTokens(rawRoute: string): string[] {
  const pathname = routeAliasPathname(rawRoute);
  if (!pathname || pathname === "/") {
    return [];
  }

  return pathname
    .replace(/\/index\.html?$/i, "")
    .replace(/\.html?$/i, "")
    .split("/")
    .flatMap((segment) => segment.split(/[^a-z0-9]+/i))
    .map((token) => normalizeRouteAliasToken(token))
    .filter(Boolean);
}

function routeAliasSegmentCount(rawRoute: string): number {
  const pathname = routeAliasPathname(rawRoute);
  if (!pathname || pathname === "/") {
    return 0;
  }

  return pathname
    .replace(/\/index\.html?$/i, "")
    .replace(/\.html?$/i, "")
    .split("/")
    .filter(Boolean).length;
}

function buildRouteAliasTarget<T>(route: string, value: T): RouteAliasTarget<T> {
  return {
    route,
    value,
    tokens: routeAliasTokens(route),
    segmentCount: routeAliasSegmentCount(route),
  };
}

function findBestRouteAliasTarget<T>(
  rawRoute: string,
  candidates: RouteAliasTarget<T>[]
): RouteAliasTarget<T> | null {
  const target = buildRouteAliasTarget(rawRoute, null);
  const targetTokenSet = new Set(target.tokens);
  if (target.tokens.length === 0 || targetTokenSet.size === 0) {
    return null;
  }

  const scoredCandidates = candidates
    .map((candidate) => {
      if (candidate.tokens.length === 0) {
        return { candidate, score: Number.NEGATIVE_INFINITY };
      }

      const candidateTokenSet = new Set(candidate.tokens);
      const sharedTokenCount = Array.from(targetTokenSet).filter((token) =>
        candidateTokenSet.has(token)
      ).length;

      if (sharedTokenCount === 0) {
        return { candidate, score: Number.NEGATIVE_INFINITY };
      }

      let score = sharedTokenCount * 5;
      const targetLastToken = target.tokens[target.tokens.length - 1];
      const candidateLastToken = candidate.tokens[candidate.tokens.length - 1];

      if (targetLastToken === candidateLastToken) {
        score += 4;
      }

      if (target.tokens[0] === candidate.tokens[0]) {
        score += 2;
      }

      if (target.tokens.every((token) => candidateTokenSet.has(token))) {
        score += 2;
      }

      if (candidate.tokens.every((token) => targetTokenSet.has(token))) {
        score += 2;
      }

      score -= Math.max(0, candidate.segmentCount - target.segmentCount) * 4;
      score -= Math.max(0, candidate.tokens.length - target.tokens.length);

      return { candidate, score };
    })
    .filter(({ score }) => Number.isFinite(score) && score >= 6)
    .sort((left, right) => right.score - left.score);

  if (scoredCandidates.length === 0) {
    return null;
  }

  const [best, second] = scoredCandidates;
  if (second && best.score - second.score < 2) {
    return null;
  }

  return best.candidate;
}

function generatedFilePathFromRoute(route: string): string | null {
  const pathname = routeAliasPathname(route);
  if (!pathname) {
    return null;
  }

  if (pathname === "/") {
    return "index.html";
  }

  if (/\.html?$/i.test(pathname)) {
    return normalizeGeneratedFilePath(pathname.replace(/^\/+/, ""));
  }

  const normalizedPath = normalizeGeneratedFilePath(
    pathname.replace(/^\/+/, "").replace(/\/+$/, "")
  );
  if (!normalizedPath) {
    return null;
  }

  return `${normalizedPath}/index.html`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildRouteAliasRedirectPage(targetHref: string): string {
  const escapedHref = escapeHtml(targetHref);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Redirecting...</title>",
    `  <meta http-equiv="refresh" content="0;url=${escapedHref}">`,
    `  <link rel="canonical" href="${escapedHref}">`,
    "  <style>",
    "    :root { color-scheme: light; }",
    "    body { margin: 0; font-family: Arial, sans-serif; background: #111827; color: #f9fafb; display: grid; min-height: 100vh; place-items: center; }",
    "    main { width: min(32rem, calc(100vw - 2rem)); padding: 1.5rem; border-radius: 1rem; background: rgba(17, 24, 39, 0.92); box-shadow: 0 20px 45px rgba(0, 0, 0, 0.28); }",
    "    a { color: #fbbf24; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <p>Redirecting...</p>",
    `    <p><a href="${escapedHref}">Continue</a></p>`,
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function synthesizeMissingRouteAliasPages(
  files: GeneratedSiteFile[],
  sourceSiteSnapshot: GenerateSiteOptions["sourceSiteSnapshot"],
  preferredRoutes: string[] = []
): GeneratedSiteFile[] {
  const routeKeys = new Set(files.flatMap((file) => routeKeysForGeneratedFile(file.path)));
  const routesToCreate = Array.from(
    new Set(preferredRoutes.filter((route) => !routeKeys.has(route)))
  );

  if (routesToCreate.length === 0) {
    return files;
  }

  const nextFiles = [...files];
  const existingPaths = new Set(files.map((file) => file.path));
  const htmlAliasTargets = files
    .filter((file) => isHtmlFile(file.path))
    .map((file) => buildRouteAliasTarget(routePathFromFilePath(file.path), file.path));
  const sourceAnchorTargets =
    sourceSiteSnapshot?.pages
      .filter((page) => page.localPath !== "index.html")
      .map((page) =>
        buildRouteAliasTarget(
          routePathFromFilePath(page.localPath),
          toAnchorIdFromLocalPath(page.localPath)
        )
      ) ?? [];

  let createdAliasCount = 0;
  for (const route of routesToCreate) {
    if (createdAliasCount >= 12) {
      break;
    }

    if (
      route === "/" ||
      route.startsWith("/assets/") ||
      route.startsWith("/api/")
    ) {
      continue;
    }

    const aliasFilePath = generatedFilePathFromRoute(route);
    if (!aliasFilePath || existingPaths.has(aliasFilePath)) {
      continue;
    }

    const bestExistingTarget = findBestRouteAliasTarget(route, htmlAliasTargets);
    let redirectHref: string | null = null;

    if (bestExistingTarget && bestExistingTarget.value !== aliasFilePath) {
      redirectHref = relativeHrefBetweenFiles(
        aliasFilePath,
        bestExistingTarget.value
      );
    } else {
      const sourceAnchorTarget = findBestRouteAliasTarget(
        route,
        sourceAnchorTargets
      );
      const homeHref = relativeHrefBetweenFiles(aliasFilePath, "index.html");
      redirectHref =
        sourceAnchorTarget && sourceAnchorTarget.value !== "top"
          ? `${homeHref}#${sourceAnchorTarget.value}`
          : homeHref;
    }

    if (!redirectHref) {
      continue;
    }

    nextFiles.push({
      path: aliasFilePath,
      content: buildRouteAliasRedirectPage(redirectHref),
    });
    existingPaths.add(aliasFilePath);
    htmlAliasTargets.push(buildRouteAliasTarget(route, aliasFilePath));
    createdAliasCount += 1;
  }

  return nextFiles;
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

function isSkippableBundleReference(rawReference: string): boolean {
  const trimmed = rawReference.trim();
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:") ||
    /^(https?:)?\/\//i.test(trimmed)
  );
}

function resolveBundleReference(
  rawReference: string,
  currentFilePath: string
):
  | { target: string; targetType: "file" | "route" }
  | null {
  if (isSkippableBundleReference(rawReference)) {
    return null;
  }

  const sanitizedReference = rawReference
    .trim()
    .split("#", 1)[0]
    .split("?", 1)[0]
    .trim();

  if (!sanitizedReference) {
    return null;
  }

  try {
    const baseUrl = new URL(`https://generated.local/${currentFilePath}`);
    const resolvedUrl = new URL(sanitizedReference, baseUrl);
    const pathname = resolvedUrl.pathname || "/";

    if (pathname === "/") {
      return { target: "/", targetType: "route" };
    }

    if (/\.html?$/i.test(pathname)) {
      return {
        target: pathname.startsWith("/") ? pathname : `/${pathname}`,
        targetType: "route",
      };
    }

    if (path.posix.extname(pathname)) {
      const normalizedPath = normalizeGeneratedFilePath(
        pathname.replace(/^\/+/, "")
      );
      if (!normalizedPath) {
        return null;
      }

      return { target: normalizedPath, targetType: "file" };
    }

    return {
      target: pathname.endsWith("/") ? pathname : `${pathname}/`,
      targetType: "route",
    };
  } catch {
    return null;
  }
}

function collectHtmlReferences(content: string): string[] {
  const references: string[] = [];
  const attrPattern = /(?:href|src|poster|action)=(["'])([^"']+)\1/gi;
  const srcsetPattern = /srcset=(["'])([^"']+)\1/gi;

  for (const match of content.matchAll(attrPattern)) {
    const reference = (match[2] ?? "").trim();
    if (reference) {
      references.push(reference);
    }
  }

  for (const match of content.matchAll(srcsetPattern)) {
    const rawSrcset = (match[2] ?? "").trim();
    if (!rawSrcset) {
      continue;
    }

    for (const candidate of rawSrcset.split(",")) {
      const [reference] = candidate.trim().split(/\s+/, 1);
      if (reference) {
        references.push(reference);
      }
    }
  }

  return references;
}

function collectHtmlPageLinkReferences(content: string): string[] {
  const references: string[] = [];
  const anchorHrefPattern = /<a\b[^>]*\bhref=(["'])([^"']+)\1/gi;

  for (const match of content.matchAll(anchorHrefPattern)) {
    const reference = (match[2] ?? "").trim();
    if (reference) {
      references.push(reference);
    }
  }

  return references;
}

function collectCssReferences(content: string): string[] {
  const references: string[] = [];
  const urlPattern = /url\(([^)]+)\)/gi;

  for (const match of content.matchAll(urlPattern)) {
    const reference = (match[1] ?? "")
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (reference) {
      references.push(reference);
    }
  }

  return references;
}

function findMissingLocalBundleReferences(
  files: GeneratedSiteFile[],
  extraFilePaths: Iterable<string> = []
): MissingBundleReference[] {
  const routeKeys = new Set(files.flatMap((file) => routeKeysForGeneratedFile(file.path)));
  const filePaths = new Set<string>(extraFilePaths);
  for (const file of files) {
    filePaths.add(file.path);
  }
  const missingReferences = new Map<string, MissingBundleReference>();

  for (const file of files) {
    const references = new Set<string>();

    if (isHtmlFile(file.path)) {
      for (const reference of collectHtmlReferences(file.content)) {
        references.add(reference);
      }
    }

    if (/\.css$/i.test(file.path)) {
      for (const reference of collectCssReferences(file.content)) {
        references.add(reference);
      }
    }

    for (const reference of references) {
      const resolved = resolveBundleReference(reference, file.path);
      if (!resolved) {
        continue;
      }

      const exists =
        resolved.targetType === "route"
          ? routeKeys.has(resolved.target)
          : filePaths.has(resolved.target);

      if (exists) {
        continue;
      }

      const issueKey = buildMissingReferenceKey({
        fromFilePath: file.path,
        rawReference: reference,
        resolvedTarget: resolved.target,
        targetType: resolved.targetType,
      });
      missingReferences.set(issueKey, {
        fromFilePath: file.path,
        rawReference: reference,
        resolvedTarget: resolved.target,
        targetType: resolved.targetType,
      });
    }
  }

  return Array.from(missingReferences.values());
}

function findMissingLocalPageLinks(files: GeneratedSiteFile[]): MissingPageLink[] {
  const htmlRouteKeys = new Set(
    files
      .filter((file) => isHtmlFile(file.path))
      .flatMap((file) => routeKeysForGeneratedFile(file.path))
  );
  const missingPageLinks = new Map<string, MissingPageLink>();

  for (const file of files) {
    if (!isHtmlFile(file.path)) {
      continue;
    }

    const references = new Set(collectHtmlPageLinkReferences(file.content));
    for (const reference of references) {
      const resolved = resolveBundleReference(reference, file.path);
      if (!resolved || resolved.targetType !== "route") {
        continue;
      }

      if (htmlRouteKeys.has(resolved.target)) {
        continue;
      }

      const issueKey = buildMissingReferenceKey({
        fromFilePath: file.path,
        rawReference: reference,
        resolvedTarget: resolved.target,
        targetType: "route",
      });
      missingPageLinks.set(issueKey, {
        fromFilePath: file.path,
        rawReference: reference,
        resolvedTarget: resolved.target,
      });
    }
  }

  return Array.from(missingPageLinks.values());
}

function analyzeGeneratedBundle(
  files: GeneratedSiteFile[],
  requestedRouteAliases: string[],
  availableStaticAssetPaths: Iterable<string>
): GeneratedBundleValidationResult {
  const missingPageLinks = findMissingLocalPageLinks(files);
  const missingPageLinkKeys = new Set(
    missingPageLinks.map((issue) =>
      buildMissingReferenceKey({
        fromFilePath: issue.fromFilePath,
        rawReference: issue.rawReference,
        resolvedTarget: issue.resolvedTarget,
        targetType: "route",
      })
    )
  );
  const missingBundleReferences = findMissingLocalBundleReferences(
    files,
    availableStaticAssetPaths
  );

  return {
    htmlPageCount: countHtmlPages(files),
    missingNonPageBundleReferences: missingBundleReferences.filter(
      (issue) => !missingPageLinkKeys.has(buildMissingReferenceKey(issue))
    ),
    missingPageLinks,
    missingRequestedPageRoutes: findMissingRequestedPageRoutes(
      files,
      requestedRouteAliases
    ),
  };
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
  const aliasTargets: Array<RouteAliasTarget<string>> = [];

  for (const page of sourceSiteSnapshot.pages) {
    const anchorId = toAnchorIdFromLocalPath(page.localPath);
    const anchorHref = anchorId === "top" ? "#top" : `#${anchorId}`;
    const pathValue =
      page.localPath === "index.html"
        ? "/"
        : `/${page.localPath.replace(/\/index\.html$/i, "")}/`;

    aliasTargets.push(buildRouteAliasTarget(pathValue, anchorHref));

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

      const replacementHref =
        hrefToAnchor.get(normalizedHref) ??
        findBestRouteAliasTarget(normalizedHref, aliasTargets)?.value;
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
  const aliasTargets = htmlFiles.map((file) =>
    buildRouteAliasTarget(routePathFromFilePath(file.path), file.path)
  );

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

        const targetFilePath =
          routeToFilePath.get(normalizedRoute) ??
          findBestRouteAliasTarget(normalizedRoute, aliasTargets)?.value;
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

function toSiteRelativePath(siteDir: string, fullPath: string): string {
  return path.relative(siteDir, fullPath).split(path.sep).join("/");
}

function createWorkingSiteDirectory(siteDir: string): string {
  const parentDir = path.dirname(siteDir);
  fs.mkdirSync(parentDir, { recursive: true });
  return fs.mkdtempSync(path.join(parentDir, `${path.basename(siteDir)}-staging-`));
}

function copySiteDirectory(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  for (const fullPath of walkDirectoryFiles(sourceDir)) {
    const relativePath = toSiteRelativePath(sourceDir, fullPath);
    const outputPath = path.join(targetDir, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(fullPath, outputPath);
  }
}

function promoteWorkingSiteDirectory(
  siteDir: string,
  workingSiteDir: string
): void {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.renameSync(workingSiteDir, siteDir);
}

function readCachedSourceSnapshot(siteDir: string): WebsiteSourceSnapshot | null {
  const snapshotPath = path.join(siteDir, SOURCE_SNAPSHOT_FILE);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as WebsiteSourceSnapshot;
  } catch {
    return null;
  }
}

function writeSourceSnapshot(
  siteDir: string,
  snapshot: WebsiteSourceSnapshot
): void {
  const snapshotPath = path.join(siteDir, SOURCE_SNAPSHOT_FILE);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
}

function readCachedSourceLogoAsset(
  siteDir: string,
  sourceSiteSnapshot: WebsiteSourceSnapshot | null
): SourceBrandAsset | null {
  const brandDir = path.join(siteDir, ...SOURCE_BRAND_DIR.split("/"));
  if (!fs.existsSync(brandDir)) {
    return null;
  }

  const logoPath = walkDirectoryFiles(brandDir).find((fullPath) =>
    /^source-logo\./i.test(path.basename(fullPath))
  );
  if (!logoPath) {
    return null;
  }

  const relativePath = toSiteRelativePath(siteDir, logoPath);
  return {
    relativePath,
    sourceUrl:
      sourceSiteSnapshot?.brand.logoCandidates[0] ??
      sourceSiteSnapshot?.finalUrl ??
      relativePath,
    mimeType: inferImageMimeType(logoPath),
  };
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

function readGeneratedSiteFilesFromDirectory(siteDir: string): GeneratedSiteFile[] {
  return walkDirectoryFiles(siteDir)
    .map((fullPath) => ({
      fullPath,
      relativePath: path.relative(siteDir, fullPath).split(path.sep).join("/"),
    }))
    .filter(
      ({ relativePath }) =>
        relativePath !== SOURCE_SNAPSHOT_FILE && isEditableSiteFile(relativePath)
    )
    .map(({ fullPath, relativePath }) => ({
      path: relativePath,
      content: fs.readFileSync(fullPath, "utf-8"),
    }));
}

function listDirectoryDifferences(leftDir: string, rightDir: string): string[] {
  const leftFiles = new Map(
    walkDirectoryFiles(leftDir).map((fullPath) => [
      toSiteRelativePath(leftDir, fullPath),
      fullPath,
    ])
  );
  const rightFiles = new Map(
    walkDirectoryFiles(rightDir).map((fullPath) => [
      toSiteRelativePath(rightDir, fullPath),
      fullPath,
    ])
  );

  const allPaths = Array.from(
    new Set([...leftFiles.keys(), ...rightFiles.keys()])
  ).sort((left, right) => left.localeCompare(right));

  return allPaths.filter((relativePath) => {
    const leftPath = leftFiles.get(relativePath);
    const rightPath = rightFiles.get(relativePath);

    if (!leftPath || !rightPath) {
      return true;
    }

    return !fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  });
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
        relativePath === SOURCE_SNAPSHOT_FILE
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
  slug: string,
  siteDir: string
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
      const relativePath = await downloadPlacePhoto(ref, slug, siteDir);
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
  options: GenerateSiteForBusinessOptions | string = {}
): Promise<GenerateResult> {
  initializeDatabase();
  const db = getDb();

  const requestOptions: GenerateSiteForBusinessOptions =
    typeof options === "string"
      ? { prompt: options, mode: options.trim() ? "modify" : "regenerate" }
      : options;
  const promptText = requestOptions.prompt?.trim() || undefined;
  const generationMode: SiteGenerationMode =
    requestOptions.mode ??
    (promptText ? "modify" : "regenerate");

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

  const siteDir = path.join(SITES_DIR, slug);
  const existingSiteFiles = readExistingSiteFiles(siteDir);
  const isModificationRequest = generationMode === "modify";
  const requestedRouteAliases = extractRequestedRouteAliases(promptText);

  const businessData = businessRowToData(business);

  logActivity({
    kind: "generation",
    stage: "started",
    businessId,
    businessName: name,
    message:
      generationMode === "modify"
        ? `Started website update for ${name}`
        : generationMode === "generate"
          ? `Started website generation for ${name}`
          : `Started website regeneration for ${name}`,
  });

  let workingSiteDir: string | null = null;
  let promotedWorkingSiteDir = false;

  try {
    const startTime = Date.now();
    const aiConfig = getConfig();
    const providerLabel = getConfiguredAiProviderLabel(aiConfig);
    const modelUsed = `${aiConfig.aiProvider}:${getConfiguredAiModel(aiConfig)}`;
    workingSiteDir = createWorkingSiteDirectory(siteDir);
    const outputSiteDir = workingSiteDir;

    if (isModificationRequest) {
      if (!promptText) {
        throw new Error("Modify mode requires a change request.");
      }

      if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
        throw new Error(`No generated site found for ${name}.`);
      }

      copySiteDirectory(siteDir, outputSiteDir);

      const sourceSiteSnapshot = readCachedSourceSnapshot(siteDir);
      const sourceBrandAssets: NonNullable<
        GenerateSiteOptions["sourceBrandAssets"]
      > = {
        logo: readCachedSourceLogoAsset(siteDir, sourceSiteSnapshot),
      };

      logActivity({
        kind: "generation",
        stage: "model",
        businessId,
        businessName: name,
        message: `Applying targeted site edits with ${providerLabel} for ${name}`,
      });

      await modifySiteWithTools(businessData, {
        siteDir: outputSiteDir,
        modificationPrompt: promptText,
        sourceSiteSnapshot,
        sourceBrandAssets,
      });

      let normalizedFiles = injectPortableRuntime(
        readGeneratedSiteFilesFromDirectory(outputSiteDir),
        businessData
      );
      const availableStaticAssetPaths = walkDirectoryFiles(outputSiteDir)
        .map((fullPath) =>
          path.relative(outputSiteDir, fullPath).split(path.sep).join("/")
        )
        .filter((relativePath) => relativePath !== SOURCE_SNAPSHOT_FILE);
      let bundleValidation = analyzeGeneratedBundle(
        normalizedFiles,
        requestedRouteAliases,
        availableStaticAssetPaths
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

      if (bundleValidation.missingRequestedPageRoutes.length > 0) {
        correctionPrompts.push(
          buildRequestedPageCorrectionPrompt(
            bundleValidation.missingRequestedPageRoutes
          )
        );
      }

      if (bundleValidation.missingPageLinks.length > 0) {
        correctionPrompts.push(
          buildMissingPageLinkCorrectionPrompt(bundleValidation.missingPageLinks)
        );
      }

      if (bundleValidation.missingNonPageBundleReferences.length > 0) {
        correctionPrompts.push(
          buildBundleIntegrityCorrectionPrompt(
            bundleValidation.missingNonPageBundleReferences
          )
        );
      }

      if (correctionPrompts.length > 0) {
        logActivity({
          kind: "generation",
          stage: "model",
          businessId,
          businessName: name,
          message: `Revising targeted site edits to resolve bundle issues for ${name}`,
        });

        await modifySiteWithTools(businessData, {
          siteDir: outputSiteDir,
          modificationPrompt: promptText,
          additionalInstructions: correctionPrompts,
          sourceSiteSnapshot,
          sourceBrandAssets,
        });

        normalizedFiles = injectPortableRuntime(
          readGeneratedSiteFilesFromDirectory(outputSiteDir),
          businessData
        );
        bundleValidation = analyzeGeneratedBundle(
          normalizedFiles,
          requestedRouteAliases,
          availableStaticAssetPaths
        );

        if (
          sourceBrandAssets.logo &&
          !bundleReferencesAssetPath(
            normalizedFiles,
            sourceBrandAssets.logo.relativePath
          )
        ) {
          throw new Error(
            `Updated site did not preserve the exact source logo asset at ./${sourceBrandAssets.logo.relativePath}.`
          );
        }

        if (bundleValidation.missingPageLinks.length > 0) {
          throw new Error(
            `Updated site still contains internal page links without matching HTML pages: ${bundleValidation.missingPageLinks
              .slice(0, 6)
              .map(
                (issue) =>
                  `${issue.fromFilePath} -> ${issue.rawReference} (${issue.resolvedTarget})`
              )
              .join("; ")}`
          );
        }

        if (bundleValidation.missingNonPageBundleReferences.length > 0) {
          throw new Error(
            `Updated site still contains broken local bundle references: ${bundleValidation.missingNonPageBundleReferences
              .slice(0, 6)
              .map(
                (issue) =>
                  `${issue.fromFilePath} -> ${issue.rawReference} (${issue.resolvedTarget})`
              )
              .join("; ")}`
          );
        }

        if (bundleValidation.missingRequestedPageRoutes.length > 0) {
          logActivity({
            kind: "generation",
            stage: "validation",
            businessId,
            businessName: name,
            message: `Updated bundle still omitted dedicated pages for ${bundleValidation.missingRequestedPageRoutes.join(", ")}; keeping exact-route aliases so navigation still resolves for ${name}.`,
          });
        }
      }

      normalizedFiles = synthesizeMissingRouteAliasPages(
        normalizedFiles,
        sourceSiteSnapshot,
        bundleValidation.missingRequestedPageRoutes
      );

      logActivity({
        kind: "generation",
        stage: "write",
        businessId,
        businessName: name,
        message: `Writing ${normalizedFiles.length} site file${normalizedFiles.length === 1 ? "" : "s"} for ${name}`,
      });
      writeGeneratedSiteFiles(outputSiteDir, normalizedFiles);

      const changedPaths = listDirectoryDifferences(siteDir, outputSiteDir);
      if (changedPaths.length === 0) {
        throw new Error(
          "Requested site modification produced no file changes."
        );
      }

      promoteWorkingSiteDirectory(siteDir, outputSiteDir);
      promotedWorkingSiteDir = true;

      const generationTimeMs = Date.now() - startTime;
      const latestVersion = db
        .prepare(
          "SELECT MAX(version) as max_version FROM generated_sites WHERE business_id = ?"
        )
        .get(businessId) as { max_version: number | null } | undefined;

      const version = (latestVersion?.max_version ?? 0) + 1;
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
        promptText,
        modelUsed,
        generationTimeMs
      );

      db.prepare(
        "UPDATE businesses SET status = 'generated', updated_at = datetime('now') WHERE id = ?"
      ).run(businessId);

      logActivity({
        kind: "generation",
        stage: "completed",
        businessId,
        businessName: name,
        message: `Updated production site for ${name} in ${Math.round(
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
    }

    let sourceSiteSnapshot: WebsiteSourceSnapshot | null = null;

    if (!isModificationRequest) {
      const assetsDir = path.join(outputSiteDir, "assets", "photos");
      fs.mkdirSync(assetsDir, { recursive: true });

      logActivity({
        kind: "generation",
        stage: "assets",
        businessId,
        businessName: name,
        message: `Downloading local business photos for ${name}`,
      });
      await downloadPhotos(photosJson, slug, outputSiteDir);

      logActivity({
        kind: "generation",
        stage: "crawl",
        businessId,
        businessName: name,
        message: websiteUrl
          ? `Capturing source-site content with Playwright from ${websiteUrl}`
          : `No live website found for ${name}; generating from business data only`,
      });
      sourceSiteSnapshot = websiteUrl
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
        writeSourceSnapshot(outputSiteDir, sourceSiteSnapshot);

        logActivity({
          kind: "generation",
          stage: "crawl_complete",
          businessId,
          businessName: name,
          message: `Captured ${sourceSiteSnapshot.pageCount} source pages for ${name} (estimated site size: ${
            sourceSiteSnapshot.estimatedPageCountIsLowerBound
              ? `at least ${sourceSiteSnapshot.estimatedPageCount}`
              : sourceSiteSnapshot.estimatedPageCount
          } pages)`,
        });
      }
    }

    const screenshotUrls = isModificationRequest
      ? []
      : Array.from(
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

    sourceBrandAssets.logo = isModificationRequest
      ? readCachedSourceLogoAsset(siteDir, sourceSiteSnapshot)
      : await downloadSourceLogoAsset(outputSiteDir, sourceSiteSnapshot);

    if (sourceBrandAssets.logo && !isModificationRequest) {
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

    if (!isModificationRequest) {
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
      message:
        generationMode === "generate"
          ? `Generating production site with ${providerLabel} for ${name}`
          : `Regenerating production site with ${providerLabel} for ${name}`,
    });
    let payload = await generateSite(businessData, {
      modificationPrompt: promptText,
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
    const availableStaticAssetPaths = walkDirectoryFiles(outputSiteDir)
      .map((fullPath) =>
        path.relative(outputSiteDir, fullPath).split(path.sep).join("/")
      )
      .filter((relativePath) => relativePath !== SOURCE_SNAPSHOT_FILE);
    let bundleValidation = analyzeGeneratedBundle(
      normalizedFiles,
      requestedRouteAliases,
      availableStaticAssetPaths
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

    if (requiresMultiPageBundle && bundleValidation.htmlPageCount < 2) {
      correctionPrompts.push(
        buildMultiPageCorrectionPrompt(architectureRecommendation)
      );
    }

    if (bundleValidation.missingRequestedPageRoutes.length > 0) {
      correctionPrompts.push(
        buildRequestedPageCorrectionPrompt(
          bundleValidation.missingRequestedPageRoutes
        )
      );
    }

    if (bundleValidation.missingPageLinks.length > 0) {
      correctionPrompts.push(
        buildMissingPageLinkCorrectionPrompt(bundleValidation.missingPageLinks)
      );
    }

    if (bundleValidation.missingNonPageBundleReferences.length > 0) {
      correctionPrompts.push(
        buildBundleIntegrityCorrectionPrompt(
          bundleValidation.missingNonPageBundleReferences
        )
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
          promptText || null,
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
      bundleValidation = analyzeGeneratedBundle(
        normalizedFiles,
        requestedRouteAliases,
        availableStaticAssetPaths
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

      if (requiresMultiPageBundle && bundleValidation.htmlPageCount < 2) {
        throw new Error(
          "Generated site returned only one HTML page even though a multi-page bundle was required."
        );
      }

      if (bundleValidation.missingPageLinks.length > 0) {
        throw new Error(
          `Generated site still contains internal page links without matching HTML pages: ${bundleValidation.missingPageLinks
            .slice(0, 6)
            .map(
              (issue) =>
                `${issue.fromFilePath} -> ${issue.rawReference} (${issue.resolvedTarget})`
            )
            .join("; ")}`
        );
      }

      if (bundleValidation.missingNonPageBundleReferences.length > 0) {
        throw new Error(
          `Generated site still contains broken local bundle references: ${bundleValidation.missingNonPageBundleReferences
            .slice(0, 6)
            .map(
              (issue) =>
                `${issue.fromFilePath} -> ${issue.rawReference} (${issue.resolvedTarget})`
            )
            .join("; ")}`
        );
      }

      if (bundleValidation.missingRequestedPageRoutes.length > 0) {
        logActivity({
          kind: "generation",
          stage: "validation",
          businessId,
          businessName: name,
          message: `Generated bundle still omitted dedicated pages for ${bundleValidation.missingRequestedPageRoutes.join(", ")}; keeping exact-route aliases so navigation still resolves for ${name}.`,
        });
      }
    }

    const finalHtmlPageCount = bundleValidation.htmlPageCount;
    normalizedFiles = synthesizeMissingRouteAliasPages(
      normalizedFiles,
      sourceSiteSnapshot,
      bundleValidation.missingRequestedPageRoutes
    );
    if (
      isBelowRecommendedHtmlPageCount(
        architectureRecommendation,
        finalHtmlPageCount
      )
    ) {
      logActivity({
        kind: "generation",
        stage: "validation",
        businessId,
        businessName: name,
        message: `Accepting bundle below the recommended page target for ${name}: returned ${finalHtmlPageCount} HTML pages, target was ${architectureRecommendation.minimumHtmlPageCount}.`,
      });
    }

    logActivity({
      kind: "generation",
      stage: "write",
      businessId,
      businessName: name,
      message: `Writing ${normalizedFiles.length} generated file${normalizedFiles.length === 1 ? "" : "s"} for ${name}`,
    });
    writeGeneratedSiteFiles(outputSiteDir, normalizedFiles);
    promoteWorkingSiteDirectory(siteDir, outputSiteDir);
    promotedWorkingSiteDir = true;

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
      promptText ?? null,
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
      message: `${
        generationMode === "generate" ? "Generated" : "Regenerated"
      } production site for ${name} in ${Math.round(generationTimeMs / 1000)}s`,
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
  } finally {
    if (workingSiteDir && !promotedWorkingSiteDir) {
      fs.rmSync(workingSiteDir, { recursive: true, force: true });
    }
  }
}
