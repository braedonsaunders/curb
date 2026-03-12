import crypto from "crypto";
import {
  buildAnthropicOAuthConfigUpdates,
  refreshAnthropicToken,
} from "./anthropic-oauth";
import {
  getConfig,
  updateConfig,
  type AiProvider,
  type Config,
} from "./config";
import {
  buildOpenAIOAuthConfigUpdates,
  DEFAULT_OPENAI_OAUTH_MODEL,
  OPENAI_OAUTH_CODEX_MODELS,
  refreshOpenAIToken,
} from "./openai-oauth";

const MODEL_LIST_TIMEOUT_MS = 10_000;
const MODEL_LIST_CACHE_TTL_MS = 60_000;

const modelCache = new Map<
  string,
  {
    fetchedAt: number;
    models: string[];
  }
>();

export type ProviderModelDraft = Partial<
  Pick<
    Config,
    | "aiProvider"
    | "anthropicApiKey"
    | "anthropicAuthMode"
    | "anthropicModel"
    | "openaiApiKey"
    | "openaiAuthMode"
    | "openaiModel"
    | "googleApiKey"
    | "googleModel"
    | "openrouterApiKey"
    | "openrouterModel"
  >
>;

export interface ProviderModelListResult {
  models: string[];
  selectedModel: string | null;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const data = payload as Record<string, unknown>;

  if (Array.isArray(data.data)) {
    return uniqueSorted(
      data.data.flatMap((entry) => {
        if (typeof entry === "string") {
          return [entry];
        }

        if (!entry || typeof entry !== "object") {
          return [];
        }

        const id = (entry as Record<string, unknown>).id;
        return typeof id === "string" ? [id] : [];
      })
    );
  }

  if (Array.isArray(data.models)) {
    return uniqueSorted(
      data.models.flatMap((entry) => {
        if (typeof entry === "string") {
          return [entry];
        }

        if (!entry || typeof entry !== "object") {
          return [];
        }

        const candidate = entry as Record<string, unknown>;
        const name = candidate.name;
        const id = candidate.id;

        if (typeof name === "string") {
          return [name];
        }

        return typeof id === "string" ? [id] : [];
      })
    );
  }

  return [];
}

function isOpenAIModelReadScopeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("(403") &&
    error.message.includes("api.model.read")
  );
}

function getOpenAIOauthBackendModels(): string[] {
  return Array.from(OPENAI_OAUTH_CODEX_MODELS);
}

function isOpenAIOauthBackendModelList(models: string[]): boolean {
  const oauthModels = getOpenAIOauthBackendModels();
  return (
    models.length === oauthModels.length &&
    models.every((model) => OPENAI_OAUTH_CODEX_MODELS.has(model))
  );
}

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Model list request failed (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`
    );
  }

  const data = (await response.json()) as unknown;

  if (!data || typeof data !== "object") {
    throw new Error("Model list response was invalid.");
  }

  return data as Record<string, unknown>;
}

function getProviderModel(config: Config, provider: AiProvider): string {
  switch (provider) {
    case "openai":
      return config.openaiModel;
    case "google":
      return config.googleModel;
    case "openrouter":
      return config.openrouterModel;
    case "anthropic":
    default:
      return config.anthropicModel;
  }
}

function getSelectedProviderModel(
  provider: AiProvider,
  config: Config,
  models: string[]
): string | null {
  const selectedModel = getProviderModel(config, provider).trim();
  if (selectedModel && models.includes(selectedModel)) {
    return selectedModel;
  }

  if (
    provider === "openai" &&
    config.openaiAuthMode === "oauth" &&
    config.openaiOAuthAccessToken &&
    isOpenAIOauthBackendModelList(models) &&
    models.includes(DEFAULT_OPENAI_OAUTH_MODEL)
  ) {
    return DEFAULT_OPENAI_OAUTH_MODEL;
  }

  return models[0] ?? null;
}

function createCacheKey(provider: AiProvider, config: Config): string {
  const relevant = (() => {
    switch (provider) {
      case "anthropic":
        return JSON.stringify({
          authMode: config.anthropicAuthMode,
          apiKey: config.anthropicApiKey,
          accessToken: config.anthropicOAuthAccessToken,
          refreshToken: config.anthropicOAuthRefreshToken,
        });
      case "openai":
        return JSON.stringify({
          authMode: config.openaiAuthMode,
          apiKey: config.openaiApiKey,
          oauthApiKey: config.openaiOAuthApiKey,
          accessToken: config.openaiOAuthAccessToken,
          refreshToken: config.openaiOAuthRefreshToken,
        });
      case "google":
        return JSON.stringify({
          apiKey: config.googleApiKey,
        });
      case "openrouter":
        return JSON.stringify({
          apiKey: config.openrouterApiKey,
        });
    }
  })();

  return `${provider}:${crypto.createHash("sha256").update(relevant).digest("hex")}`;
}

function toConfig(config?: Config, draft?: ProviderModelDraft): Config {
  const nextConfig = {
    ...(config ?? getConfig()),
  };

  for (const [key, value] of Object.entries(draft ?? {})) {
    if (value !== undefined) {
      (
        nextConfig as Record<string, Config[keyof Config] | undefined>
      )[key] = value as Config[keyof Config];
    }
  }

  return nextConfig;
}

async function resolveAnthropicAccess(config: Config): Promise<Record<string, string>> {
  if (config.anthropicAuthMode === "oauth") {
    if (!config.anthropicOAuthAccessToken) {
      throw new Error(
        "Connect Anthropic OAuth before loading Anthropic models."
      );
    }

    let accessToken = config.anthropicOAuthAccessToken;
    const refreshToken = config.anthropicOAuthRefreshToken;
    const expiresAtMs = config.anthropicOAuthExpiresAtMs;

    if (refreshToken && expiresAtMs > 0 && Date.now() >= expiresAtMs) {
      const refreshed = await refreshAnthropicToken(refreshToken);
      const nextConfig = updateConfig(
        buildAnthropicOAuthConfigUpdates(refreshed, {
          refreshToken,
          expiresAtMs,
          authMode: "oauth",
        })
      );

      accessToken = nextConfig.anthropicOAuthAccessToken;
    }

    return {
      authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
    };
  }

  const apiKey = config.anthropicApiKey.trim();
  if (!apiKey) {
    throw new Error("Enter an Anthropic API key to load Anthropic models.");
  }

  return {
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
  };
}

async function resolveOpenAIAuthHeader(config: Config): Promise<string> {
  if (config.openaiAuthMode === "oauth") {
    if (config.openaiOAuthApiKey) {
      return `Bearer ${config.openaiOAuthApiKey}`;
    }

    if (!config.openaiOAuthAccessToken) {
      throw new Error("Connect OpenAI OAuth before loading OpenAI models.");
    }

    let accessToken = config.openaiOAuthAccessToken;
    const refreshToken = config.openaiOAuthRefreshToken;
    const expiresAtMs = config.openaiOAuthExpiresAtMs;

    if (refreshToken && expiresAtMs > 0 && Date.now() >= expiresAtMs) {
      const refreshed = await refreshOpenAIToken(refreshToken);
      const nextConfig = updateConfig(
        buildOpenAIOAuthConfigUpdates(refreshed, {
          refreshToken,
          expiresAtMs,
          authMode: "oauth",
          existingPlatformApiKey: config.openaiOAuthApiKey,
          existingAccountId: config.openaiOAuthAccountId,
        })
      );

      accessToken = nextConfig.openaiOAuthAccessToken;
    }

    return `Bearer ${accessToken}`;
  }

  const apiKey = config.openaiApiKey.trim();
  if (!apiKey) {
    throw new Error("Enter an OpenAI API key to load OpenAI models.");
  }

  return `Bearer ${apiKey}`;
}

async function fetchAnthropicModels(config: Config): Promise<string[]> {
  const payload = await fetchJson("https://api.anthropic.com/v1/models", {
    headers: await resolveAnthropicAccess(config),
  });

  return parseModelIds(payload);
}

async function fetchOpenAIModels(config: Config): Promise<string[]> {
  const canUseOauthBackendFallback =
    config.openaiAuthMode === "oauth" && Boolean(config.openaiOAuthAccessToken);

  if (canUseOauthBackendFallback && !config.openaiOAuthApiKey) {
    return getOpenAIOauthBackendModels();
  }

  try {
    const payload = await fetchJson("https://api.openai.com/v1/models", {
      headers: {
        Authorization: await resolveOpenAIAuthHeader(config),
      },
    });

    return parseModelIds(payload);
  } catch (error) {
    if (canUseOauthBackendFallback && isOpenAIModelReadScopeError(error)) {
      return getOpenAIOauthBackendModels();
    }

    throw error;
  }
}

async function fetchGoogleModels(config: Config): Promise<string[]> {
  const apiKey = config.googleApiKey.trim();

  if (!apiKey) {
    throw new Error("Enter a Google AI API key to load Gemini models.");
  }

  const models: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", apiKey);

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await fetchJson(url.toString());
    const pageModels = Array.isArray(payload.models)
      ? (payload.models as Array<Record<string, unknown>>)
      : [];

    for (const model of pageModels) {
      const rawName = typeof model.name === "string" ? model.name : "";
      const supportedMethods = Array.isArray(model.supportedGenerationMethods)
        ? model.supportedGenerationMethods.filter(
            (method): method is string => typeof method === "string"
          )
        : [];

      if (!rawName) {
        continue;
      }

      if (
        supportedMethods.length > 0 &&
        !supportedMethods.includes("generateContent")
      ) {
        continue;
      }

      models.push(rawName.replace(/^models\//, ""));
    }

    const nextPageToken = payload.nextPageToken;
    if (typeof nextPageToken !== "string" || nextPageToken.length === 0) {
      break;
    }

    pageToken = nextPageToken;
  }

  return uniqueSorted(models);
}

async function fetchOpenRouterModels(config: Config): Promise<string[]> {
  const apiKey = config.openrouterApiKey.trim();

  if (!apiKey) {
    throw new Error("Enter an OpenRouter API key to load OpenRouter models.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const payload = await fetchJson("https://openrouter.ai/api/v1/models/user", {
      headers,
    });
    const models = parseModelIds(payload);
    if (models.length > 0) {
      return models;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!error.message.includes("(404") && !error.message.includes("(405"))
    ) {
      throw error;
    }
  }

  const payload = await fetchJson("https://openrouter.ai/api/v1/models", {
    headers,
  });

  return parseModelIds(payload);
}

export async function listProviderModelsFromApi(
  provider: AiProvider,
  options?: {
    config?: Config;
    draft?: ProviderModelDraft;
    forceRefresh?: boolean;
  }
): Promise<ProviderModelListResult> {
  const config = toConfig(options?.config, options?.draft);
  const cacheKey = createCacheKey(provider, config);

  if (!options?.forceRefresh) {
    const cached = modelCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < MODEL_LIST_CACHE_TTL_MS) {
      return {
        models: cached.models,
        selectedModel: getSelectedProviderModel(
          provider,
          config,
          cached.models
        ),
      };
    }
  }

  const models = await (async () => {
    switch (provider) {
      case "openai":
        return await fetchOpenAIModels(config);
      case "google":
        return await fetchGoogleModels(config);
      case "openrouter":
        return await fetchOpenRouterModels(config);
      case "anthropic":
      default:
        return await fetchAnthropicModels(config);
    }
  })();

  const uniqueModels = uniqueSorted(models);

  modelCache.set(cacheKey, {
    fetchedAt: Date.now(),
    models: uniqueModels,
  });

  return {
    models: uniqueModels,
    selectedModel: getSelectedProviderModel(provider, config, uniqueModels),
  };
}
