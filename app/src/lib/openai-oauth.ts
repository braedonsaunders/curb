import crypto from "crypto";
import { getConfig, type Config, type OpenAIAuthMode } from "./config";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_SCOPES = "openid profile email offline_access";

export const OPENAI_OAUTH_CODEX_MODELS = new Set([
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
]);

export const DEFAULT_OPENAI_OAUTH_MODEL = "gpt-5.3-codex";
export const OPENAI_CODEX_API_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";

export interface OpenAIOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface OpenAIOAuthStatus {
  connected: boolean;
  expiresAtMs: number | null;
  hasRefreshToken: boolean;
  hasPlatformApiKey: boolean;
  hasAccountId: boolean;
  mode: "platformApiKey" | "chatgptBackend" | null;
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createOpenAIPkcePair(): {
  verifier: string;
  challenge: string;
} {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest()
  );

  return { verifier, challenge };
}

export function buildOpenAIAuthorizeUrl(
  state: string,
  challenge: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: OPENAI_REDIRECT_URI,
    scope: OPENAI_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "curb",
  });

  return `${OPENAI_AUTH_URL}?${params.toString()}`;
}

export async function exchangeOpenAICode(
  code: string,
  codeVerifier: string
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: OPENAI_REDIRECT_URI,
    client_id: OPENAI_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as OpenAIOAuthTokens;
}

export async function refreshOpenAIToken(
  refreshToken: string
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OPENAI_CLIENT_ID,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI token refresh failed (${response.status}): ${text}`);
  }

  return (await response.json()) as OpenAIOAuthTokens;
}

export async function exchangeOpenAITokenForApiKey(
  idToken: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token: "openai-api-key",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    client_id: OPENAI_CLIENT_ID,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OpenAI token to API key exchange failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export function parseOpenAIJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<
    string,
    unknown
  >;
}

export function extractChatGPTAccountId(
  accessToken: string
): string | undefined {
  try {
    const payload = parseOpenAIJwtPayload(accessToken);
    const directId = payload.chatgpt_account_id;
    if (typeof directId === "string" && directId.length > 0) {
      return directId;
    }

    const authClaims = payload["https://api.openai.com/auth"] as
      | Record<string, unknown>
      | undefined;
    const nestedId = authClaims?.chatgpt_account_id;
    if (typeof nestedId === "string" && nestedId.length > 0) {
      return nestedId;
    }

    const organizations = payload.organizations;
    if (Array.isArray(organizations)) {
      const firstOrg = organizations[0] as Record<string, unknown> | undefined;
      const orgId = firstOrg?.id;
      if (typeof orgId === "string" && orgId.length > 0) {
        return orgId;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractOpenAIAccountIdFromTokens(tokens: {
  access_token?: string;
  id_token?: string;
}): string | undefined {
  if (tokens.id_token) {
    const fromIdToken = extractChatGPTAccountId(tokens.id_token);
    if (fromIdToken) {
      return fromIdToken;
    }
  }

  if (tokens.access_token) {
    const fromAccessToken = extractChatGPTAccountId(tokens.access_token);
    if (fromAccessToken) {
      return fromAccessToken;
    }
  }

  return undefined;
}

export function getOpenAIOAuthStatus(
  config: Config = getConfig()
): OpenAIOAuthStatus {
  const hasPlatformApiKey = Boolean(config.openaiOAuthApiKey);
  const hasChatgptBackendToken = Boolean(config.openaiOAuthAccessToken);

  return {
    connected: hasPlatformApiKey || hasChatgptBackendToken,
    expiresAtMs:
      config.openaiOAuthExpiresAtMs > 0 ? config.openaiOAuthExpiresAtMs : null,
    hasRefreshToken: Boolean(config.openaiOAuthRefreshToken),
    hasPlatformApiKey,
    hasAccountId: Boolean(config.openaiOAuthAccountId),
    mode: hasPlatformApiKey
      ? "platformApiKey"
      : hasChatgptBackendToken
        ? "chatgptBackend"
        : null,
  };
}

export function buildOpenAIOAuthConfigUpdates(
  tokens: OpenAIOAuthTokens,
  options?: {
    refreshToken?: string;
    expiresAtMs?: number;
    authMode?: OpenAIAuthMode;
    platformApiKey?: string;
    existingPlatformApiKey?: string;
    accountId?: string;
    existingAccountId?: string;
  }
): Partial<Config> {
  const accountId =
    options?.accountId ??
    extractOpenAIAccountIdFromTokens(tokens) ??
    options?.existingAccountId ??
    "";

  return {
    openaiAuthMode: options?.authMode ?? "oauth",
    openaiOAuthAccessToken: tokens.access_token,
    openaiOAuthRefreshToken: tokens.refresh_token ?? options?.refreshToken ?? "",
    openaiOAuthExpiresAtMs: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : (options?.expiresAtMs ?? 0),
    openaiOAuthAccountId: accountId,
    openaiOAuthApiKey:
      options?.platformApiKey ?? options?.existingPlatformApiKey ?? "",
  };
}

export function clearOpenAIOAuthConfigUpdates(
  authMode: OpenAIAuthMode = "apiKey"
): Partial<Config> {
  return {
    openaiAuthMode: authMode,
    openaiOAuthAccessToken: "",
    openaiOAuthRefreshToken: "",
    openaiOAuthExpiresAtMs: 0,
    openaiOAuthAccountId: "",
    openaiOAuthApiKey: "",
  };
}
