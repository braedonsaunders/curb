import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import fs from "fs";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import path from "path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildAnthropicOAuthConfigUpdates,
  refreshAnthropicToken,
} from "./anthropic-oauth";
import {
  DEFAULT_AI_MODELS,
  getConfiguredAiModel,
  getConfiguredAiProviderLabel,
} from "./ai-provider";
import { getConfig, updateConfig, type Config } from "./config";
import {
  buildOpenAIOAuthConfigUpdates,
  DEFAULT_OPENAI_OAUTH_MODEL,
  extractChatGPTAccountId,
  OPENAI_CODEX_API_ENDPOINT,
  OPENAI_OAUTH_CODEX_MODELS,
  refreshOpenAIToken,
} from "./openai-oauth";
import type { WebsiteSourceSnapshot } from "./website-source";
import type { WebsitePageSignals } from "./website-screenshot";

const PROMPTS_DIR = path.resolve(process.cwd(), "..", "prompts");
const ANTHROPIC_OAUTH_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
];
const ANTHROPIC_OAUTH_USER_AGENT = "claude-cli/2.1.2 (external, cli)";

export interface BusinessData {
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  rating: number | null;
  review_count: number | null;
  hours_json: string | null;
  photos_json: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface VisualAuditInput {
  businessName: string;
  category: string | null;
  city: string | null;
  requestedUrl: string;
  finalUrl: string;
  pageTitle: string | null;
  screenshotBase64: string;
  screenshotMediaType: "image/jpeg";
  pageSignals: WebsitePageSignals;
}

export interface VisualAuditResult {
  grade: string;
  ownerSentiment: "proud" | "mixed" | "embarrassed";
  summary: string;
  strengths: string[];
  issues: string[];
  websiteComplexity: "simple" | "moderate" | "advanced";
  replacementDifficulty: "easy" | "medium" | "hard";
  advancedFeatures: string[];
}

export interface ExistingSiteFile {
  path: string;
  content: string;
}

export interface SourceBrandAsset {
  relativePath: string;
  sourceUrl: string;
  mimeType: string | null;
}

export interface GenerateSiteOptions {
  promptOverride?: string;
  modificationPrompt?: string;
  existingSiteFiles?: ExistingSiteFile[];
  sourceSiteSnapshot?: WebsiteSourceSnapshot | null;
  sourceBrandAssets?: {
    logo?: SourceBrandAsset | null;
  };
  sourceSiteVisuals?: Array<{
    finalUrl: string;
    pageTitle: string | null;
    screenshotBase64: string;
    screenshotMediaType: "image/jpeg";
    pageSignals: WebsitePageSignals;
  }>;
}

export interface ModifySiteWithToolsOptions {
  siteDir: string;
  modificationPrompt: string;
  additionalInstructions?: string[];
  sourceSiteSnapshot?: WebsiteSourceSnapshot | null;
  sourceBrandAssets?: {
    logo?: SourceBrandAsset | null;
  };
}

export type SiteArchitectureMode = "single-page" | "multi-page";

export interface SiteArchitectureRecommendation {
  mode: SiteArchitectureMode;
  required: boolean;
  confidence: "medium" | "high";
  reasons: string[];
  sourcePageEstimate: number;
  sourcePageEstimateIsLowerBound: boolean;
  minimumHtmlPageCount: number;
  targetHtmlPageCountMin: number;
  targetHtmlPageCountMax: number;
}

const STRONG_MULTI_PAGE_FEATURES = new Set([
  "online store",
  "appointment booking",
  "customer portal",
  "large multi-page navigation",
]);

const DEDICATED_PAGE_SLUG_HINTS = new Set([
  "services",
  "service",
  "portfolio",
  "gallery",
  "faq",
  "faqs",
  "team",
  "staff",
  "locations",
  "location",
  "pricing",
  "plans",
  "menu",
  "shop",
  "products",
  "product",
  "booking",
  "book",
  "appointments",
  "appointment",
  "contact",
  "about",
  "resources",
  "resource",
  "blog",
  "news",
  "specialties",
  "specialty",
]);

const SITE_MODIFIER_MAX_STEPS = 20;
const SITE_MODIFIER_MAX_READ_CHARS = 24000;
const SITE_MODIFIER_MAX_FILE_LIST = 250;
const SITE_MODIFIER_TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".md",
  ".mjs",
  ".svg",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml",
]);
const SITE_MODIFIER_PROTECTED_FILES = new Set(["__source_snapshot.json"]);

async function buildAnthropicOauthProvider(config: Config) {
  if (!config.anthropicOAuthAccessToken) {
    throw new Error(
      "Anthropic OAuth is selected, but no Anthropic OAuth token is connected."
    );
  }

  let accessToken = config.anthropicOAuthAccessToken;
  let refreshToken = config.anthropicOAuthRefreshToken;
  let expiresAtMs = config.anthropicOAuthExpiresAtMs;

  const refreshIfNeeded = async () => {
    if (
      !refreshToken ||
      !accessToken ||
      (expiresAtMs > 0 && Date.now() < expiresAtMs)
    ) {
      return;
    }

    try {
      const tokens = await refreshAnthropicToken(refreshToken);
      const nextConfig = updateConfig(
        buildAnthropicOAuthConfigUpdates(tokens, {
          refreshToken,
          expiresAtMs,
          authMode: config.anthropicAuthMode,
        })
      );

      accessToken = nextConfig.anthropicOAuthAccessToken;
      refreshToken = nextConfig.anthropicOAuthRefreshToken;
      expiresAtMs = nextConfig.anthropicOAuthExpiresAtMs;
    } catch {
      // Fall back to the existing token and let Anthropic surface an auth error.
    }
  };

  await refreshIfNeeded();

  const oauthFetch: typeof fetch = async (requestInput, init) => {
    await refreshIfNeeded();

    const requestHeaders = new Headers();

    if (requestInput instanceof Request) {
      requestInput.headers.forEach((value, key) => {
        requestHeaders.set(key, value);
      });
    }

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          requestHeaders.set(key, value);
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          requestHeaders.set(key, String(value));
        }
      } else {
        for (const [key, value] of Object.entries(init.headers)) {
          if (value !== undefined) {
            requestHeaders.set(key, String(value));
          }
        }
      }
    }

    const incomingBeta = requestHeaders.get("anthropic-beta") ?? "";
    const mergedBetas = [
      ...new Set(
        [...ANTHROPIC_OAUTH_BETAS, ...incomingBeta.split(",")]
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ].join(",");

    requestHeaders.set("authorization", `Bearer ${accessToken}`);
    requestHeaders.set("anthropic-beta", mergedBetas);
    requestHeaders.set("user-agent", ANTHROPIC_OAUTH_USER_AGENT);
    requestHeaders.delete("x-api-key");

    let finalInput: RequestInfo | URL = requestInput;

    try {
      const requestUrl =
        typeof requestInput === "string" || requestInput instanceof URL
          ? new URL(requestInput.toString())
          : new URL(requestInput.url);

      if (
        requestUrl.pathname === "/v1/messages" &&
        !requestUrl.searchParams.has("beta")
      ) {
        requestUrl.searchParams.set("beta", "true");
        finalInput =
          requestInput instanceof Request
            ? new Request(requestUrl.toString(), requestInput)
            : requestUrl;
      }
    } catch {
      // Keep the original request input if the URL cannot be parsed.
    }

    return fetch(finalInput, {
      ...init,
      headers: requestHeaders,
    });
  };

  return createAnthropic({
    authToken: accessToken,
    headers: {
      "anthropic-beta": ANTHROPIC_OAUTH_BETAS.join(","),
    },
    fetch: oauthFetch,
  });
}

async function buildOpenAIOauthProvider(config: Config) {
  if (config.openaiOAuthApiKey) {
    return {
      model: createOpenAI({ apiKey: config.openaiOAuthApiKey }),
      modelId: getConfiguredAiModel(config).trim() || DEFAULT_AI_MODELS.openai,
    };
  }

  if (!config.openaiOAuthAccessToken) {
    throw new Error(
      "OpenAI OAuth is selected, but no OpenAI OAuth token is connected."
    );
  }

  let accessToken = config.openaiOAuthAccessToken;
  const refreshToken = config.openaiOAuthRefreshToken;
  let expiresAtMs = config.openaiOAuthExpiresAtMs;
  let accountId = config.openaiOAuthAccountId || extractChatGPTAccountId(accessToken);

  const refreshIfNeeded = async () => {
    if (!refreshToken || !accessToken || (expiresAtMs > 0 && Date.now() < expiresAtMs)) {
      return;
    }

    try {
      const tokens = await refreshOpenAIToken(refreshToken);
      const nextConfig = updateConfig(
        buildOpenAIOAuthConfigUpdates(tokens, {
          refreshToken,
          expiresAtMs,
          authMode: config.openaiAuthMode,
          existingPlatformApiKey: config.openaiOAuthApiKey,
          existingAccountId: accountId,
        })
      );

      accessToken = nextConfig.openaiOAuthAccessToken;
      expiresAtMs = nextConfig.openaiOAuthExpiresAtMs;
      accountId =
        nextConfig.openaiOAuthAccountId || extractChatGPTAccountId(accessToken);
    } catch {
      // Fall back to the existing token and let OpenAI surface an auth error.
    }
  };

  await refreshIfNeeded();

  const resolvedModel = OPENAI_OAUTH_CODEX_MODELS.has(config.openaiModel)
    ? config.openaiModel
    : DEFAULT_OPENAI_OAUTH_MODEL;

  const openaiOauthFetch: typeof fetch = async (requestInput, init) => {
    await refreshIfNeeded();

    const headers = new Headers();

    if (requestInput instanceof Request) {
      requestInput.headers.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers.set(key, value);
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          if (value !== undefined) {
            headers.set(key, String(value));
          }
        }
      } else {
        for (const [key, value] of Object.entries(init.headers)) {
          if (value !== undefined) {
            headers.set(key, String(value));
          }
        }
      }
    }

    headers.delete("authorization");
    headers.delete("Authorization");
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("originator", "curb");
    headers.set("user-agent", "curb/0.1.0");

    if (!headers.get("session_id")) {
      headers.set("session_id", randomUUID());
    }

    if (accountId) {
      headers.set("ChatGPT-Account-Id", accountId);
    }

    const parsedUrl =
      requestInput instanceof URL
        ? requestInput
        : new URL(
            typeof requestInput === "string" ? requestInput : requestInput.url
          );

    const targetUrl =
      parsedUrl.pathname.includes("/v1/responses") ||
      parsedUrl.pathname.includes("/chat/completions")
        ? new URL(OPENAI_CODEX_API_ENDPOINT)
        : parsedUrl;

    return fetch(targetUrl, {
      ...init,
      headers,
    });
  };

  return {
    model: createOpenAI({
      apiKey: "openai-oauth-dummy-key",
      fetch: openaiOauthFetch,
    }),
    modelId: resolvedModel,
  };
}

async function getLanguageModelRuntime(): Promise<{
  config: Config;
  model: LanguageModel;
  providerLabel: string;
}> {
  const config = getConfig();
  const providerLabel = getConfiguredAiProviderLabel(config);
  const modelId =
    getConfiguredAiModel(config).trim() || DEFAULT_AI_MODELS[config.aiProvider];

  if (config.aiProvider === "anthropic") {
    if (config.anthropicAuthMode === "oauth") {
      if (config.anthropicOAuthAccessToken) {
        const provider = await buildAnthropicOauthProvider(config);
        return { config, model: provider(modelId), providerLabel };
      }

      if (!config.anthropicApiKey) {
        throw new Error(
          "Anthropic OAuth is selected, but no OAuth token is connected. Connect Anthropic OAuth in Settings or switch Anthropic back to API key mode."
        );
      }
    }

    if (config.anthropicApiKey) {
      const provider = createAnthropic({ apiKey: config.anthropicApiKey });
      return { config, model: provider(modelId), providerLabel };
    }

    if (config.anthropicOAuthAccessToken) {
      const provider = await buildAnthropicOauthProvider(config);
      return { config, model: provider(modelId), providerLabel };
    }

    throw new Error(
      "Anthropic credentials are not set. Configure an Anthropic API key or connect Anthropic OAuth in Settings."
    );
  }

  if (config.aiProvider === "openai") {
    if (config.openaiAuthMode === "oauth") {
      if (config.openaiOAuthApiKey || config.openaiOAuthAccessToken) {
        const provider = await buildOpenAIOauthProvider(config);
        return {
          config,
          model: provider.model(provider.modelId),
          providerLabel,
        };
      }

      if (!config.openaiApiKey) {
        throw new Error(
          "OpenAI OAuth is selected, but no OAuth token is connected. Connect OpenAI OAuth in Settings or switch OpenAI back to API key mode."
        );
      }
    }

    if (config.openaiApiKey) {
      const provider = createOpenAI({ apiKey: config.openaiApiKey });
      return { config, model: provider(modelId), providerLabel };
    }

    if (config.openaiOAuthApiKey || config.openaiOAuthAccessToken) {
      const provider = await buildOpenAIOauthProvider(config);
      return {
        config,
        model: provider.model(provider.modelId),
        providerLabel,
      };
    }

    throw new Error(
      "OpenAI credentials are not set. Configure an OpenAI API key or connect OpenAI OAuth in Settings."
    );
  }

  if (config.aiProvider === "google") {
    if (!config.googleApiKey) {
      throw new Error(
        "Google Gemini credentials are not set. Configure a Google AI API key in Settings."
      );
    }

    const provider = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
    return { config, model: provider(modelId), providerLabel };
  }

  if (!config.openrouterApiKey) {
    throw new Error(
      "OpenRouter credentials are not set. Configure an OpenRouter API key in Settings."
    );
  }

  const provider = createOpenRouter({
    apiKey: config.openrouterApiKey,
    compatibility: "strict",
  });

  return { config, model: provider.chat(modelId), providerLabel };
}

async function generateModelText(options: {
  messages: ModelMessage[];
  maxOutputTokens: number;
}): Promise<{ text: string; providerLabel: string; config: Config }> {
  const runtime = await getLanguageModelRuntime();
  const result = await generateText({
    model: runtime.model,
    messages: options.messages,
    maxOutputTokens: options.maxOutputTokens,
  });
  const text = result.text.trim();

  if (!text) {
    throw new Error(`${runtime.providerLabel} returned no text content.`);
  }

  return {
    text,
    providerLabel: runtime.providerLabel,
    config: runtime.config,
  };
}

export function isAiAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return [
    "credentials are not set",
    "api key",
    "authentication_error",
    "unauthorized",
    "forbidden",
    "invalid x-api-key",
    "invalid api key",
    "invalid_api_key",
    "access token",
  ].some((snippet) => message.toLowerCase().includes(snippet));
}

function loadPromptTemplate(filename: string): string {
  const filePath = path.join(PROMPTS_DIR, filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function isWithinSiteDirectory(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function normalizeSiteToolPath(filePath: string): string {
  const normalized = path.posix.normalize(
    filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "")
  );

  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new Error("Invalid site file path.");
  }

  return normalized;
}

function resolveSiteToolPath(siteDir: string, filePath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const relativePath = normalizeSiteToolPath(filePath);
  if (SITE_MODIFIER_PROTECTED_FILES.has(relativePath)) {
    throw new Error("This internal site file cannot be modified.");
  }
  const absolutePath = path.resolve(siteDir, relativePath);

  if (!isWithinSiteDirectory(absolutePath, siteDir)) {
    throw new Error("Requested file is outside the site directory.");
  }

  return { absolutePath, relativePath };
}

function isLikelySiteTextFile(filePath: string, buffer: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (SITE_MODIFIER_TEXT_EXTENSIONS.has(extension)) {
    return true;
  }

  return !buffer.subarray(0, 8000).includes(0);
}

function walkSiteFiles(siteDir: string): string[] {
  if (!fs.existsSync(siteDir)) {
    return [];
  }

  const results: string[] = [];
  const stack = [siteDir];

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

function listSiteFilesForModel(siteDir: string, directory?: string): Array<{
  path: string;
  size: number;
  isText: boolean;
}> {
  const normalizedDirectory = directory?.trim();
  const scopedRoot =
    !normalizedDirectory || normalizedDirectory === "." || normalizedDirectory === "./"
      ? siteDir
      : resolveSiteToolPath(siteDir, normalizedDirectory).absolutePath;

  if (!fs.existsSync(scopedRoot)) {
    throw new Error("Requested directory does not exist.");
  }

  const stat = fs.statSync(scopedRoot);
  if (!stat.isDirectory()) {
    throw new Error("Requested path is not a directory.");
  }

  return walkSiteFiles(scopedRoot)
    .map((fullPath) => {
      const relativePath = path.relative(siteDir, fullPath).replaceAll("\\", "/");
      if (SITE_MODIFIER_PROTECTED_FILES.has(relativePath)) {
        return null;
      }

      const buffer = fs.readFileSync(fullPath);
      return {
        path: relativePath,
        size: buffer.byteLength,
        isText: isLikelySiteTextFile(fullPath, buffer),
      };
    })
    .filter(
      (
        entry
      ): entry is {
        path: string;
        size: number;
        isText: boolean;
      } => entry !== null
    )
    .slice(0, SITE_MODIFIER_MAX_FILE_LIST);
}

function buildSiteFileInventory(siteDir: string): string {
  const files = listSiteFilesForModel(siteDir);

  if (files.length === 0) {
    return "Current Site Files:\n- No files were found in the working site bundle.";
  }

  const lines = files.map(
    (file) =>
      `- ${file.path} (${file.isText ? "text" : "binary"}, ${file.size} bytes)`
  );
  const omittedCount = Math.max(0, walkSiteFiles(siteDir).length - files.length);

  return [
    "Current Site Files:",
    ...lines,
    omittedCount > 0
      ? `- ...and ${omittedCount} more file${omittedCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function readSiteFileForModel(
  siteDir: string,
  filePath: string,
  offset = 0,
  limit = SITE_MODIFIER_MAX_READ_CHARS
): {
  path: string;
  size: number;
  isText: boolean;
  offset: number;
  limit: number;
  returnedChars: number;
  truncated: boolean;
  content: string;
} {
  const { absolutePath, relativePath } = resolveSiteToolPath(siteDir, filePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("Site file not found.");
  }

  const buffer = fs.readFileSync(absolutePath);
  const isText = isLikelySiteTextFile(absolutePath, buffer);
  if (!isText) {
    throw new Error("This file is binary and cannot be read as text.");
  }

  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, Math.min(limit, SITE_MODIFIER_MAX_READ_CHARS));
  const content = buffer.toString("utf-8");
  const sliced = content.slice(safeOffset, safeOffset + safeLimit);

  return {
    path: relativePath,
    size: buffer.byteLength,
    isText,
    offset: safeOffset,
    limit: safeLimit,
    returnedChars: sliced.length,
    truncated: safeOffset + safeLimit < content.length,
    content: sliced,
  };
}

function writeSiteFileFromModel(
  siteDir: string,
  filePath: string,
  content: string
): {
  path: string;
  created: boolean;
  changed: boolean;
  size: number;
} {
  const { absolutePath, relativePath } = resolveSiteToolPath(siteDir, filePath);
  const exists = fs.existsSync(absolutePath);

  if (exists && fs.statSync(absolutePath).isDirectory()) {
    throw new Error("Cannot overwrite a directory with a file.");
  }

  let changed = true;
  if (exists) {
    const existingBuffer = fs.readFileSync(absolutePath);
    if (!isLikelySiteTextFile(absolutePath, existingBuffer)) {
      throw new Error("This file is binary and cannot be overwritten as text.");
    }

    changed = existingBuffer.toString("utf-8") !== content;
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf-8");

  return {
    path: relativePath,
    created: !exists,
    changed,
    size: Buffer.byteLength(content, "utf-8"),
  };
}

function replaceInSiteFileFromModel(
  siteDir: string,
  filePath: string,
  oldText: string,
  newText: string,
  replaceAll = false
): {
  path: string;
  changed: boolean;
  replacements: number;
  size: number;
} {
  const { absolutePath, relativePath } = resolveSiteToolPath(siteDir, filePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("Site file not found.");
  }

  const existingBuffer = fs.readFileSync(absolutePath);
  if (!isLikelySiteTextFile(absolutePath, existingBuffer)) {
    throw new Error("This file is binary and cannot be edited as text.");
  }

  const existingContent = existingBuffer.toString("utf-8");
  const matchCount = oldText ? existingContent.split(oldText).length - 1 : 0;
  if (matchCount === 0) {
    throw new Error("The requested text to replace was not found in the file.");
  }

  const replacements = replaceAll ? matchCount : 1;
  const nextContent = replaceAll
    ? existingContent.split(oldText).join(newText)
    : existingContent.replace(oldText, newText);

  fs.writeFileSync(absolutePath, nextContent, "utf-8");

  return {
    path: relativePath,
    changed: nextContent !== existingContent,
    replacements,
    size: Buffer.byteLength(nextContent, "utf-8"),
  };
}

function deleteSiteFileFromModel(
  siteDir: string,
  filePath: string
): {
  path: string;
  deleted: boolean;
} {
  const { absolutePath, relativePath } = resolveSiteToolPath(siteDir, filePath);

  if (!fs.existsSync(absolutePath)) {
    return { path: relativePath, deleted: false };
  }

  if (fs.statSync(absolutePath).isDirectory()) {
    throw new Error("Use file deletion only on files, not directories.");
  }

  fs.rmSync(absolutePath, { force: true });
  return { path: relativePath, deleted: true };
}

function injectPlaceholders(
  template: string,
  values: Record<string, string | number | null | undefined>
): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value == null ? "" : String(value)
    );
  }

  return result;
}

function injectBusinessData(template: string, data: BusinessData): string {
  return injectPlaceholders(template, {
    name: data.name,
    category: data.category,
    address: data.address,
    city: data.city,
    phone: data.phone,
    email: data.email,
    website_url: data.website_url,
    rating: data.rating?.toString() ?? "",
    review_count: data.review_count?.toString() ?? "",
    hours_json: data.hours_json,
    photos_json: data.photos_json,
    google_maps_url: data.google_maps_url,
    latitude: data.latitude?.toString() ?? "",
    longitude: data.longitude?.toString() ?? "",
  });
}

function buildBusinessContext(data: BusinessData): string {
  const lines: string[] = [
    `Business Name: ${data.name}`,
    `Category: ${data.category ?? "Unknown"}`,
    `Address: ${data.address ?? "N/A"}`,
    `City: ${data.city ?? "N/A"}`,
    `Phone: ${data.phone ?? "N/A"}`,
    `Email: ${data.email ?? "N/A"}`,
    `Website: ${data.website_url ?? "None"}`,
    `Google Rating: ${data.rating ?? "N/A"} (${data.review_count ?? 0} reviews)`,
    `Google Maps: ${data.google_maps_url ?? "N/A"}`,
  ];

  if (data.hours_json) {
    try {
      const hours = JSON.parse(data.hours_json);
      lines.push(`Hours: ${JSON.stringify(hours, null, 2)}`);
    } catch {
      lines.push(`Hours: ${data.hours_json}`);
    }
  }

  return lines.join("\n");
}

function buildSourceSiteSummary(
  snapshot: WebsiteSourceSnapshot | null | undefined
): string {
  if (!snapshot) {
    return "No live source website snapshot was captured.";
  }

  const pageInventory = snapshot.pages.map(
    (page, index) =>
      `Page ${index + 1}: ${page.url} (local path: ${page.localPath})`
  );

  const pageSections = snapshot.pages.map((page, index) =>
    [
      `Page ${index + 1}: ${page.url}`,
      `Local path: ${page.localPath}`,
      `Title: ${page.title ?? "N/A"}`,
      `Description: ${page.description ?? "N/A"}`,
      `Headings: ${page.headings.length ? page.headings.join(" | ") : "N/A"}`,
      `Navigation: ${
        page.navLinks.length
          ? page.navLinks
              .map((entry) =>
                entry.text ? `${entry.text} -> ${entry.href}` : entry.href
              )
              .join(" | ")
          : "N/A"
      }`,
      `Calls to action: ${
        page.callToActions.length ? page.callToActions.join(" | ") : "N/A"
      }`,
      `Forms: ${
        page.forms.length
          ? page.forms
              .map(
                (form) =>
                  `method=${form.method ?? "N/A"}, action=${
                    form.action ?? "N/A"
                  }, fields=[${form.fields.join(", ")}]`
              )
              .join(" | ")
          : "N/A"
      }`,
      `Detected features: ${
        page.detectedFeatures.length
          ? page.detectedFeatures.join(", ")
          : "none detected"
      }`,
      `Images: ${
        page.images.length
          ? page.images
              .map((image) =>
                image.alt ? `${image.alt} -> ${image.src}` : image.src
              )
              .join(" | ")
          : "N/A"
      }`,
      `Extracted page text:\n${page.textContent || "N/A"}`,
    ].join("\n")
  );

  return [
    "Source Website Snapshot:",
    "Treat this as brand and content inventory plus evidence of what to improve, not as a layout blueprint to preserve.",
    `Requested URL: ${snapshot.requestedUrl}`,
    `Final URL: ${snapshot.finalUrl}`,
    `Captured pages: ${snapshot.pageCount}`,
    `Estimated total site pages: ${
      snapshot.estimatedPageCountIsLowerBound
        ? `at least ${snapshot.estimatedPageCount}`
        : snapshot.estimatedPageCount
    }`,
    `Capture limit reached: ${snapshot.captureLimitReached ? "yes" : "no"}`,
    "Source page inventory (content can be reorganized into a stronger information architecture):",
    ...pageInventory,
    `Brand colors: ${
      snapshot.brand.colorPalette.length
        ? snapshot.brand.colorPalette.join(", ")
        : "N/A"
    }`,
    `Brand backgrounds: ${
      snapshot.brand.backgroundPalette.length
        ? snapshot.brand.backgroundPalette.join(", ")
        : "N/A"
    }`,
    `Brand fonts: ${
      snapshot.brand.fontFamilies.length
        ? snapshot.brand.fontFamilies.join(", ")
        : "N/A"
    }`,
    `Logo candidates: ${
      snapshot.brand.logoCandidates.length
        ? snapshot.brand.logoCandidates.join(" | ")
        : "N/A"
    }`,
    "Detailed source-page content below is canonical for facts and feature coverage, but not for layout, page order, or section sequencing.",
    ...pageSections,
  ].join("\n\n");
}

function buildSourceSiteVisualSummary(
  visuals: GenerateSiteOptions["sourceSiteVisuals"]
): string {
  if (!visuals || visuals.length === 0) {
    return "No source-site screenshots were captured.";
  }

  return [
    "Source Website Visuals:",
    "Treat screenshots as brand/style evidence and a baseline to outperform. Do not preserve their spacing, hierarchy, or section composition unless explicitly required.",
    ...visuals.map((visual, index) =>
      [
        `Screenshot ${index + 1}: ${visual.finalUrl}`,
        `Page title: ${visual.pageTitle ?? "Unknown"}`,
        buildPageSignalsSummary(visual.pageSignals),
      ].join("\n")
    ),
  ].join("\n\n");
}

function buildSourceBrandAssetSummary(
  sourceBrandAssets: GenerateSiteOptions["sourceBrandAssets"]
): string {
  const logo = sourceBrandAssets?.logo;
  if (!logo) {
    return [
      "Source Brand Assets:",
      "No exact source logo asset was captured.",
      "Do not invent, redraw, or fabricate a replacement logo mark.",
    ].join("\n");
  }

  return [
    "Source Brand Assets:",
    `Exact source logo bundle path for reuse: ${logo.relativePath}`,
    `Original logo URL: ${logo.sourceUrl}`,
    `Logo MIME type: ${logo.mimeType ?? "Unknown"}`,
    "If you display a logo anywhere in the site, you must reference this exact asset using the correct relative path from each file and must not redraw or approximate it.",
  ].join("\n");
}

function buildExistingSiteSummary(
  files: ExistingSiteFile[] | undefined
): string {
  if (!files || files.length === 0) {
    return "No current generated site bundle was provided.";
  }

  const htmlPageCount = files.filter((file) => isHtmlSiteFile(file.path)).length;
  const maxChars = 45000;
  const maxCharsPerFile = 12000;
  let usedChars = 0;
  const sections: string[] = [];

  for (const file of files) {
    if (usedChars >= maxChars) {
      break;
    }

    const remainingChars = maxChars - usedChars;
    const snippet = file.content.slice(
      0,
      Math.min(maxCharsPerFile, remainingChars)
    );
    usedChars += snippet.length;

    sections.push(
      [
        `File: ${file.path}`,
        snippet.length < file.content.length
          ? `${snippet}\n...[truncated]`
          : snippet,
      ].join("\n")
    );
  }

  return [
    "Current Generated Site Bundle:",
    "Use this bundle as the working draft when applying requested site changes.",
    `Current generated HTML pages: ${htmlPageCount}`,
    ...sections,
  ].join("\n\n");
}

function stripCodeFences(text: string): string {
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

function ensureGeneratedSitePayload(text: string): string {
  const cleaned = stripCodeFences(text);
  if (/<<<FILE:[^>]+>>>/i.test(cleaned)) {
    return cleaned;
  }

  if (
    !/^<!DOCTYPE html/i.test(cleaned) &&
    !/<html[\s>]/i.test(cleaned) &&
    !/^<[\w!]/.test(cleaned)
  ) {
    throw new Error(
      "Site generation returned non-HTML content instead of a website document."
    );
  }

  return cleaned;
}

function buildPageSignalsSummary(pageSignals: WebsitePageSignals): string {
  const features = pageSignals.detectedFeatures.length
    ? pageSignals.detectedFeatures.join(", ")
    : "none detected";
  const headings = pageSignals.headingSamples.length
    ? pageSignals.headingSamples.join(" | ")
    : "none captured";

  return [
    `Navigation links: ${pageSignals.navLinkCount}`,
    `Internal links: ${pageSignals.internalLinkCount}`,
    `External links: ${pageSignals.externalLinkCount}`,
    `Forms: ${pageSignals.formCount}`,
    `Buttons: ${pageSignals.buttonCount}`,
    `Detected features: ${features}`,
    `Heading samples: ${headings}`,
  ].join("\n");
}

function isHtmlSiteFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}

function localPathToPageSlug(localPath: string): string {
  if (localPath === "index.html") {
    return "";
  }

  return localPath
    .replace(/\/index\.html$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function pageSlugHasDedicatedPageHint(pageSlug: string): boolean {
  return pageSlug
    .split("/")
    .filter(Boolean)
    .some((segment) => DEDICATED_PAGE_SLUG_HINTS.has(segment));
}

function derivePageComplexityBudget(
  sourcePageEstimate: number,
  sourcePageEstimateIsLowerBound: boolean
): {
  minimumHtmlPageCount: number;
  targetHtmlPageCountMin: number;
  targetHtmlPageCountMax: number;
} {
  if (sourcePageEstimate <= 1) {
    return {
      minimumHtmlPageCount: 1,
      targetHtmlPageCountMin: 1,
      targetHtmlPageCountMax: 1,
    };
  }

  let targetHtmlPageCountMin: number;
  let targetHtmlPageCountMax: number;

  if (sourcePageEstimate <= 2) {
    targetHtmlPageCountMin = 2;
    targetHtmlPageCountMax = 2;
  } else if (sourcePageEstimate <= 5) {
    targetHtmlPageCountMin = 3;
    targetHtmlPageCountMax = 5;
  } else if (sourcePageEstimate <= 9) {
    targetHtmlPageCountMin = 5;
    targetHtmlPageCountMax = 7;
  } else if (sourcePageEstimate <= 14) {
    targetHtmlPageCountMin = 7;
    targetHtmlPageCountMax = 10;
  } else if (sourcePageEstimate <= 24) {
    targetHtmlPageCountMin = 9;
    targetHtmlPageCountMax = 14;
  } else {
    targetHtmlPageCountMin = 12;
    targetHtmlPageCountMax = 18;
  }

  if (!sourcePageEstimateIsLowerBound) {
    targetHtmlPageCountMax = Math.min(
      targetHtmlPageCountMax,
      sourcePageEstimate
    );
  }

  return {
    minimumHtmlPageCount: targetHtmlPageCountMin,
    targetHtmlPageCountMin,
    targetHtmlPageCountMax: Math.max(
      targetHtmlPageCountMin,
      targetHtmlPageCountMax
    ),
  };
}

export function recommendSiteArchitecture(
  options: GenerateSiteOptions = {}
): SiteArchitectureRecommendation {
  const reasons: string[] = [];
  let score = 0;
  const sourcePages = options.sourceSiteSnapshot?.pages ?? [];

  const existingHtmlFiles = (options.existingSiteFiles ?? []).filter((file) =>
    isHtmlSiteFile(file.path)
  );
  const existingSecondaryPages = existingHtmlFiles.filter(
    (file) => file.path !== "index.html"
  );
  const sourcePageEstimate = Math.max(
    options.sourceSiteSnapshot?.estimatedPageCount ??
      options.sourceSiteSnapshot?.pageCount ??
      0,
    sourcePages.length
  );
  const sourcePageEstimateIsLowerBound =
    sourcePageEstimate ===
      (options.sourceSiteSnapshot?.estimatedPageCount ??
        options.sourceSiteSnapshot?.pageCount ??
        0) && !!options.sourceSiteSnapshot?.estimatedPageCountIsLowerBound;
  const referencePageEstimate = Math.max(
    existingHtmlFiles.length,
    sourcePageEstimate
  );
  const referencePageEstimateIsLowerBound =
    referencePageEstimate === sourcePageEstimate &&
    sourcePageEstimateIsLowerBound;
  const pageComplexityBudget = derivePageComplexityBudget(
    referencePageEstimate,
    referencePageEstimateIsLowerBound
  );

  if (existingSecondaryPages.length > 0) {
    score += 5;
    reasons.push(
      `Current generated bundle already includes ${existingHtmlFiles.length} HTML pages.`
    );
  }

  const nonHomeSourcePages = sourcePages.filter(
    (page) => page.localPath !== "index.html"
  );
  const sourcePageSlugs = Array.from(
    new Set(
      nonHomeSourcePages
        .map((page) => localPathToPageSlug(page.localPath))
        .filter(Boolean)
    )
  );
  const dedicatedPageSlugCount = sourcePageSlugs.filter((pageSlug) =>
    pageSlugHasDedicatedPageHint(pageSlug)
  ).length;

  if (sourcePages.length >= 3) {
    score += 4;
    reasons.push(`Source site has ${sourcePages.length} captured pages.`);
  } else if (nonHomeSourcePages.length >= 2) {
    score += 3;
    reasons.push(
      `Source site exposes ${nonHomeSourcePages.length} distinct non-home pages.`
    );
  }

  if (dedicatedPageSlugCount >= 2) {
    score += 3;
    reasons.push(
      "Source navigation appears to contain distinct supporting pages that should not be collapsed into one long page."
    );
  } else if (dedicatedPageSlugCount >= 1 && sourcePages.length >= 2) {
    score += 2;
    reasons.push(
      "Source site includes at least one clear dedicated content page beyond the homepage."
    );
  }

  const detectedFeatures = new Set<string>();
  for (const page of sourcePages) {
    for (const feature of page.detectedFeatures) {
      detectedFeatures.add(feature);
    }
  }

  for (const visual of options.sourceSiteVisuals ?? []) {
    for (const feature of visual.pageSignals.detectedFeatures) {
      detectedFeatures.add(feature);
    }
  }

  const strongFeatureMatches = Array.from(detectedFeatures).filter((feature) =>
    STRONG_MULTI_PAGE_FEATURES.has(feature)
  );
  if (strongFeatureMatches.length > 0) {
    score += 4;
    reasons.push(
      `Detected complex site features: ${strongFeatureMatches.join(", ")}.`
    );
  }

  const navCounts = [
    ...sourcePages.map((page) => page.navLinks.length),
    ...(options.sourceSiteVisuals ?? []).map(
      (visual) => visual.pageSignals.navLinkCount
    ),
  ];
  const maxNavLinkCount = navCounts.length > 0 ? Math.max(...navCounts) : 0;
  if (maxNavLinkCount >= 8) {
    score += 3;
    reasons.push(
      `Navigation depth is high (${maxNavLinkCount} links), which usually needs multiple pages.`
    );
  }

  if (referencePageEstimate >= 10) {
    score += 4;
    reasons.push(
      `Source/site complexity suggests ${
        referencePageEstimateIsLowerBound
          ? `at least ${referencePageEstimate}`
          : referencePageEstimate
      } meaningful pages, so the redesign must preserve comparable page-level complexity.`
    );
  } else if (referencePageEstimate >= 6) {
    score += 3;
    reasons.push(
      `Source/site complexity is closer to a ${
        referencePageEstimateIsLowerBound
          ? `${referencePageEstimate}+`
          : referencePageEstimate
      }-page site than a simple brochure page.`
    );
  } else if (referencePageEstimate >= 3) {
    score += 2;
    reasons.push(
      `The site already spans multiple distinct pages and should not be collapsed into a single long page.`
    );
  }

  if (score >= 4) {
    return {
      mode: "multi-page",
      required: true,
      confidence: "high",
      reasons,
      sourcePageEstimate: referencePageEstimate,
      sourcePageEstimateIsLowerBound: referencePageEstimateIsLowerBound,
      minimumHtmlPageCount: pageComplexityBudget.minimumHtmlPageCount,
      targetHtmlPageCountMin: pageComplexityBudget.targetHtmlPageCountMin,
      targetHtmlPageCountMax: pageComplexityBudget.targetHtmlPageCountMax,
    };
  }

  if (score >= 2) {
    return {
      mode: "multi-page",
      required: false,
      confidence: "medium",
      reasons,
      sourcePageEstimate: referencePageEstimate,
      sourcePageEstimateIsLowerBound: referencePageEstimateIsLowerBound,
      minimumHtmlPageCount: pageComplexityBudget.minimumHtmlPageCount,
      targetHtmlPageCountMin: pageComplexityBudget.targetHtmlPageCountMin,
      targetHtmlPageCountMax: pageComplexityBudget.targetHtmlPageCountMax,
    };
  }

  return {
    mode: "single-page",
    required: false,
    confidence: "medium",
    sourcePageEstimate: referencePageEstimate,
    sourcePageEstimateIsLowerBound: referencePageEstimateIsLowerBound,
    minimumHtmlPageCount: 1,
    targetHtmlPageCountMin: 1,
    targetHtmlPageCountMax: Math.max(1, pageComplexityBudget.targetHtmlPageCountMax),
    reasons:
      reasons.length > 0
        ? reasons
        : [
            "No strong multi-page signals were detected from the current bundle, source pages, or navigation structure.",
          ],
  };
}

function buildArchitectureRecommendationSummary(
  options: GenerateSiteOptions = {}
): string {
  const recommendation = recommendSiteArchitecture(options);
  const sourcePageEstimateLabel = recommendation.sourcePageEstimateIsLowerBound
    ? `at least ${recommendation.sourcePageEstimate}`
    : `${recommendation.sourcePageEstimate}`;
  const targetPageRangeLabel =
    recommendation.targetHtmlPageCountMin === recommendation.targetHtmlPageCountMax
      ? `${recommendation.targetHtmlPageCountMin}`
      : `${recommendation.targetHtmlPageCountMin}-${recommendation.targetHtmlPageCountMax}`;

  return [
    "Architecture Recommendation:",
    `Recommended architecture: ${recommendation.mode}`,
    `Requirement level: ${
      recommendation.required ? "required" : "preferred"
    }`,
    `Confidence: ${recommendation.confidence}`,
    `Estimated source/site page complexity: ${sourcePageEstimateLabel} pages`,
    `Target substantive HTML page range: ${targetPageRangeLabel}`,
    `Recommended substantive HTML page minimum: ${recommendation.minimumHtmlPageCount}`,
    ...recommendation.reasons.map((reason) => `- ${reason}`),
    recommendation.mode === "multi-page"
      ? recommendation.required
        ? `- Return a multi-page static site bundle with at least ${recommendation.minimumHtmlPageCount} substantive HTML pages and keep page-level complexity roughly aligned with the source site.`
        : `- Prefer a multi-page bundle in roughly the ${targetPageRangeLabel}-page range unless there is a very strong reason to consolidate.`
      : "- A single-page site is acceptable only if the content can be consolidated cleanly without losing clarity or utility.",
  ].join("\n");
}

export async function generateSite(
  businessData: BusinessData,
  options: GenerateSiteOptions = {}
): Promise<string> {
  const promptTemplate = loadPromptTemplate("site-generation.md");
  const businessContext = buildBusinessContext(businessData);
  const existingSiteSummary = buildExistingSiteSummary(options.existingSiteFiles);
  const sourceSiteSummary = buildSourceSiteSummary(options.sourceSiteSnapshot);
  const sourceBrandAssetSummary = buildSourceBrandAssetSummary(
    options.sourceBrandAssets
  );
  const architectureRecommendationSummary =
    buildArchitectureRecommendationSummary(options);
  const sourceSiteVisualSummary = buildSourceSiteVisualSummary(
    options.sourceSiteVisuals
  );
  const modificationPrompt =
    options.modificationPrompt?.trim() ?? options.promptOverride?.trim() ?? "";
  const promptSections = [
    promptTemplate ||
      "Rebuild the business website using the available business data and source-site snapshot.",
    "Business Context:",
    businessContext,
    existingSiteSummary,
    sourceSiteSummary,
    sourceBrandAssetSummary,
    architectureRecommendationSummary,
    sourceSiteVisualSummary,
  ];

  if (modificationPrompt) {
    promptSections.push(
      options.existingSiteFiles?.length
        ? "Requested modifications to apply to the current site bundle:"
        : "Additional user instructions:",
      modificationPrompt
    );
  }

  promptSections.push(
    "Output rules:",
    "- Do not ask the user for missing business details.",
    "- When a current generated site bundle is provided, treat it as the working draft and apply the requested modifications to that draft.",
    "- This is a redesign, not a literal clone. Preserve recognizable brand cues while clearly upgrading the site.",
    "- Use the source site as truth for branding, business facts, service coverage, and feature inventory, not as a limit on design quality, layout, or composition.",
    "- Treat source screenshots and page summaries as evidence of what the brand is and what must be improved, not as canonical references for spacing, hierarchy, or section order.",
    "- Extract the brand DNA from the source material, then reinterpret it into a world-class modern website with a distinct creative direction.",
    "- The visual quality bar is AAA-level: premium, current, custom-designed, and strong enough to sell as a serious paid upgrade.",
    "- Create a polished, conversion-focused, modern business website that feels materially better than the original and obviously more valuable at first glance.",
    "- Before writing code, establish an internal design brief for this business: audience, conversion goal, practical constraints, a clear aesthetic direction, and one memorable differentiator.",
    "- Start from a blank canvas for layout and composition. Preserve brand identity and business truth, not the source site's visual structure.",
    "- Do not mirror the source hero composition, navigation arrangement, card grids, footer structure, typography scale, or repetitive section rhythm unless the business truly needs the same pattern.",
    "- If the source site feels visually weak, replace its composition entirely instead of lightly modernizing the same layout.",
    "- Choose a clear art direction and execute it consistently with stronger typography, richer backgrounds or surfaces, deliberate contrast, varied section composition, and premium spacing.",
    "- Typography must feel chosen, not defaulted. Avoid generic font stacks unless the brand truly calls for restraint.",
    "- Use a cohesive visual system with deliberate color hierarchy, CSS variables or shared tokens, purposeful motion, atmospheric backgrounds or surfaces, and compositions that do not feel like safe templates.",
    "- Match implementation complexity to the concept: restrained directions should be precise and elegant, while bolder directions should have enough layering, motion, and detail to feel fully resolved.",
    "- Preserve and improve all customer-facing content and features from the source material.",
    "- Rewrite and elevate weak copy when helpful, but do not lose important business information.",
    "- Reorganize layout, page structure, and section order whenever needed to produce a stronger modern experience.",
    "- Avoid safe template output, dated layouts, weak typography, cramped spacing, flat white-box sections, generic hero-plus-card patterns, and low-effort visual design.",
    "- When an exact source logo file path is provided, every visible logo treatment must use that exact asset path. Do not recreate, redraw, typeset, simplify, or approximate the logo.",
    "- If no exact source logo asset is provided, do not invent or fabricate a new logo mark.",
    "- Choose the site architecture that best fits the business: single-page only for simple brochure sites, multi-page when there are clearly distinct pages, galleries, FAQs, specialties, resources, locations, or utility flows.",
    "- Match the source site's page-level complexity. Do not collapse a many-page website into a one-page brochure or a tiny handful of pages.",
    "- When the Architecture Recommendation section provides a substantive HTML page target or minimum, follow it. Those counts refer to real content pages, not redirects, placeholders, or duplicate shells.",
    "- When the Architecture Recommendation section says multi-page is required, you must return a multi-page bundle with at least the stated minimum number of substantive HTML pages.",
    "- Multi-page is required when there are multiple substantive source pages, large navigation, or complex flows such as store, booking, or portal behavior.",
    "- If single-page, consolidate content into anchored sections and use working in-page navigation like #about-us or #specials.",
    "- If multi-page, return a static site bundle with one file per page and keep all internal navigation relative to the site bundle.",
    "- The output must be a static site bundle with no build step and no framework runtime requirement.",
    "- Never leave bundler placeholders such as assets/main.js, assets/index.js, assets/index.css, /src/main.jsx, or rel=\"modulepreload\" unless you also return those exact files.",
    "- Never emit broken root-relative internal links such as /about-us/ or /specials/.",
    "- Contact, quote, and booking-request forms must use standard HTML form markup and remain compatible with static hosting. Prefer leaving action blank and adding data-curb-contact-form=\"true\" when you include a lead form.",
    "- Remove obsolete admin, CMS, webmaster login, and old vendor-credit links unless the user explicitly needs them."
  );

  promptSections.push(
    "Response format:",
    "- Return the site as a static file bundle using these exact markers:",
    "<<<FILE:index.html>>>",
    "<!DOCTYPE html>...",
    "<<<END FILE>>>",
    "- Add more files the same way, for example <<<FILE:about-us/index.html>>> or <<<FILE:assets/site.css>>>.",
    "- If the best solution is a single page, return only one file: index.html.",
    "- Do not wrap the response in markdown fences."
  );

  const userPrompt = injectBusinessData(promptSections.join("\n\n"), businessData);

  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        image: string;
        mediaType: "image/jpeg";
      }
  > = [{ type: "text", text: userPrompt }];

  for (const [index, visual] of (options.sourceSiteVisuals ?? []).entries()) {
    content.push({
      type: "text",
      text: `Attached source-site screenshot ${index + 1} for ${visual.finalUrl}.`,
    });
    content.push({
      type: "image",
      image: visual.screenshotBase64,
      mediaType: visual.screenshotMediaType,
    });
  }

  const response = await generateModelText({
    maxOutputTokens: 20000,
    messages: [{ role: "user", content }],
  });

  return ensureGeneratedSitePayload(response.text);
}

export async function modifySiteWithTools(
  businessData: BusinessData,
  options: ModifySiteWithToolsOptions
): Promise<{ summary: string; changedPaths: string[] }> {
  const runtime = await getLanguageModelRuntime();
  const promptTemplate = loadPromptTemplate("site-modification.md");
  const businessContext = buildBusinessContext(businessData);
  const sourceSiteSummary = buildSourceSiteSummary(options.sourceSiteSnapshot);
  const sourceBrandAssetSummary = buildSourceBrandAssetSummary(
    options.sourceBrandAssets
  );
  const fileInventory = buildSiteFileInventory(options.siteDir);
  const changedPaths = new Set<string>();

  const systemPrompt =
    promptTemplate ||
    [
      "You are a senior front-end engineer editing an existing static website in place.",
      "Use the available tools to inspect the current site, then make the smallest precise file edits needed to satisfy the user request.",
      "Do not regenerate or rewrite the whole site unless the user explicitly asks for a wholesale redesign.",
      "Prefer targeted replacements over broad rewrites. Preserve untouched files exactly.",
      "When you are done, reply with a short plain-text summary of the edits you made.",
    ].join("\n\n");

  const promptSections = [
    "Business Context:",
    businessContext,
    sourceSiteSummary,
    sourceBrandAssetSummary,
    fileInventory,
    "User Request:",
    options.modificationPrompt.trim(),
    "Editing Rules:",
    [
      "- Use tools to inspect files before changing them.",
      "- Prefer `replace_in_file` for localized edits.",
      "- Use `write_site_file` when creating a new file or when a file needs substantial restructuring.",
      "- Only touch files that are necessary to fulfill the request.",
      "- Reuse the existing CSS, JS, tokens, structure, and copy unless the user explicitly asks for broader changes.",
      "- Do not make unrelated design, layout, copy, or architecture changes.",
      "- Keep the site static-hosting friendly and preserve working internal links and local asset references.",
      "- Remove dead bundler entry tags such as assets/main.js, assets/index.js, assets/index.css, /src/main.jsx, or rel=\"modulepreload\" when the referenced file is not present in the bundle.",
      "- If the user asks for a new page, create that page and update only the navigation or CTA links that need to point to it.",
    ].join("\n"),
  ];

  if ((options.additionalInstructions?.length ?? 0) > 0) {
    promptSections.push(
      "Additional Required Fixes:",
      options.additionalInstructions!.map((instruction) => `- ${instruction}`).join("\n")
    );
  }

  const result = await generateText({
    model: runtime.model,
    system: systemPrompt,
    prompt: promptSections.join("\n\n"),
    tools: {
      list_site_files: tool({
        description:
          "List files in the current site bundle. Use this to inspect the available HTML, CSS, JS, assets, and page paths before editing.",
        inputSchema: z.object({
          directory: z
            .string()
            .trim()
            .optional()
            .describe("Optional relative directory to inspect. Omit to list from the site root."),
        }),
        execute: async ({ directory }) => ({
          files: listSiteFilesForModel(options.siteDir, directory),
        }),
      }),
      read_site_file: tool({
        description:
          "Read text content from an existing site file. Use offset/limit if you need a later slice of a large file.",
        inputSchema: z.object({
          path: z.string().trim().min(1).describe("Relative path of the file to read."),
          offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Optional character offset for partial reads."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(SITE_MODIFIER_MAX_READ_CHARS)
            .optional()
            .describe("Optional maximum number of characters to read."),
        }),
        execute: async ({ path: filePath, offset, limit }) =>
          readSiteFileForModel(options.siteDir, filePath, offset, limit),
      }),
      replace_in_file: tool({
        description:
          "Perform a targeted text replacement inside an existing text file. Prefer this for small, precise edits.",
        inputSchema: z.object({
          path: z.string().trim().min(1).describe("Relative path of the file to modify."),
          oldText: z
            .string()
            .min(1)
            .describe("Exact existing text to replace. It must already exist in the file."),
          newText: z
            .string()
            .describe("Replacement text that should be written in place of oldText."),
          replaceAll: z
            .boolean()
            .optional()
            .describe("Set true to replace every occurrence instead of only the first."),
        }),
        execute: async ({ path: filePath, oldText, newText, replaceAll }) => {
          const outcome = replaceInSiteFileFromModel(
            options.siteDir,
            filePath,
            oldText,
            newText,
            replaceAll
          );
          if (outcome.changed) {
            changedPaths.add(outcome.path);
          }
          return outcome;
        },
      }),
      write_site_file: tool({
        description:
          "Write a complete text file. Use this to create a new text file or to replace an existing file after substantial restructuring.",
        inputSchema: z.object({
          path: z.string().trim().min(1).describe("Relative path of the file to write."),
          content: z.string().describe("The complete file contents to write."),
        }),
        execute: async ({ path: filePath, content }) => {
          const outcome = writeSiteFileFromModel(
            options.siteDir,
            filePath,
            content
          );
          if (outcome.changed || outcome.created) {
            changedPaths.add(outcome.path);
          }
          return outcome;
        },
      }),
      delete_site_file: tool({
        description:
          "Delete an existing file from the site bundle when the user explicitly wants it removed or replaced.",
        inputSchema: z.object({
          path: z.string().trim().min(1).describe("Relative path of the file to delete."),
        }),
        execute: async ({ path: filePath }) => {
          const outcome = deleteSiteFileFromModel(options.siteDir, filePath);
          if (outcome.deleted) {
            changedPaths.add(outcome.path);
          }
          return outcome;
        },
      }),
    },
    toolChoice: "required",
    stopWhen: stepCountIs(SITE_MODIFIER_MAX_STEPS),
    maxOutputTokens: 1200,
  });

  return {
    summary: result.text.trim(),
    changedPaths: Array.from(changedPaths).sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

export async function generateEmail(
  businessData: BusinessData,
  previewUrl: string,
  config: Config
): Promise<{ subject: string; body: string }> {
  const promptTemplate = loadPromptTemplate("email-outreach.md");
  const businessContext = buildBusinessContext(businessData);

  let userPrompt: string;
  if (promptTemplate) {
    userPrompt = injectBusinessData(promptTemplate, businessData)
      .replace(/\{\{preview_url\}\}/g, previewUrl)
      .replace(/\{\{owner_name\}\}/g, config.ownerName)
      .replace(/\{\{business_name\}\}/g, config.businessName)
      .replace(/\{\{business_email\}\}/g, config.businessEmail)
      .replace(/\{\{business_address\}\}/g, config.businessAddress)
      .replace(/\{\{pricing_text\}\}/g, config.pricingText);
  } else {
    userPrompt = `Write a professional cold outreach email to a local business owner. The goal is to show them
a free sample website you've built for their business, and offer your web design services.

Sender Info:
- Name: ${config.ownerName || "Web Designer"}
- Business: ${config.businessName || "Web Design Services"}
- Email: ${config.businessEmail || ""}
- Mailing address: ${config.businessAddress || ""}
- Pricing context: ${config.pricingText || "Do not include pricing unless it helps the message feel specific."}

Target Business:
${businessContext}

Preview URL: ${previewUrl}

Write a short, friendly, non-pushy email. Include a compelling subject line.
Return your response as JSON with exactly two fields: "subject" and "body".
The body should be plain text (not HTML). No markdown code fences.`;
  }

  const response = await generateModelText({
    maxOutputTokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = stripCodeFences(response.text);

  try {
    const parsed = JSON.parse(text);
    if (!parsed.subject || !parsed.body) {
      throw new Error("Response missing subject or body fields.");
    }
    return { subject: parsed.subject, body: parsed.body };
  } catch (e) {
    throw new Error(
      `Failed to parse ${response.providerLabel} email response as JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function auditWebsite(
  input: VisualAuditInput
): Promise<VisualAuditResult> {
  const promptTemplate = loadPromptTemplate("audit-scoring.md");

  let userPrompt: string;
  if (promptTemplate) {
    userPrompt = injectPlaceholders(promptTemplate, {
      business_name: input.businessName,
      category: input.category ?? "Unknown",
      city: input.city ?? "Unknown",
      requested_url: input.requestedUrl,
      final_url: input.finalUrl,
      page_title: input.pageTitle ?? "Unknown",
      site_signals: buildPageSignalsSummary(input.pageSignals),
    });
  } else {
    userPrompt = `You are reviewing a local business website from a screenshot.

Business: ${input.businessName}
Category: ${input.category ?? "Unknown"}
City: ${input.city ?? "Unknown"}
Requested URL: ${input.requestedUrl}
Final URL loaded: ${input.finalUrl}
Page title: ${input.pageTitle ?? "Unknown"}
Live page signals:
${buildPageSignalsSummary(input.pageSignals)}

Judge the site the way a business owner would, not with technical speed or SEO metrics.
Focus on visual polish, modern feel, clarity, trust, and whether the owner would likely feel proud or embarrassed to send customers there.

Return JSON with exactly these fields:
{
  "grade": "D",
  "ownerSentiment": "embarrassed",
  "summary": "...",
  "strengths": ["..."],
  "issues": ["..."],
  "websiteComplexity": "advanced",
  "replacementDifficulty": "hard",
  "advancedFeatures": ["online store"]
}

Use only proud, mixed, or embarrassed for ownerSentiment.
Use only simple, moderate, or advanced for websiteComplexity.
Use only easy, medium, or hard for replacementDifficulty.
No markdown code fences.`;
  }

  const response = await generateModelText({
    maxOutputTokens: 1200,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image",
            image: input.screenshotBase64,
            mediaType: input.screenshotMediaType,
          },
        ],
      },
    ],
  });

  const text = stripCodeFences(response.text);

  try {
    const parsed = JSON.parse(text);
    if (
      !parsed.grade ||
      !parsed.summary ||
      !parsed.ownerSentiment ||
      !Array.isArray(parsed.strengths) ||
      !Array.isArray(parsed.issues) ||
      !parsed.websiteComplexity ||
      !parsed.replacementDifficulty ||
      !Array.isArray(parsed.advancedFeatures)
    ) {
      throw new Error("Response missing required audit fields.");
    }

    return {
      grade: String(parsed.grade).trim().toUpperCase(),
      ownerSentiment:
        parsed.ownerSentiment === "proud" ||
        parsed.ownerSentiment === "mixed" ||
        parsed.ownerSentiment === "embarrassed"
          ? parsed.ownerSentiment
          : "mixed",
      summary: String(parsed.summary).trim(),
      strengths: parsed.strengths
        .map((item: unknown) => String(item).trim())
        .filter(Boolean)
        .slice(0, 4),
      issues: parsed.issues
        .map((item: unknown) => String(item).trim())
        .filter(Boolean)
        .slice(0, 4),
      websiteComplexity:
        parsed.websiteComplexity === "simple" ||
        parsed.websiteComplexity === "moderate" ||
        parsed.websiteComplexity === "advanced"
          ? parsed.websiteComplexity
          : "moderate",
      replacementDifficulty:
        parsed.replacementDifficulty === "easy" ||
        parsed.replacementDifficulty === "medium" ||
        parsed.replacementDifficulty === "hard"
          ? parsed.replacementDifficulty
          : "medium",
      advancedFeatures: parsed.advancedFeatures
        .map((item: unknown) => String(item).trim())
        .filter(Boolean)
        .slice(0, 6),
    };
  } catch (e) {
    throw new Error(
      `Failed to parse ${response.providerLabel} audit response as JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
