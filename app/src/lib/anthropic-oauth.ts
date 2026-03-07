import crypto from "crypto";
import { getConfig, type AnthropicAuthMode, type Config } from "./config";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTH_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const ANTHROPIC_REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback";
const ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference";

export interface AnthropicOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface AnthropicOAuthStatus {
  connected: boolean;
  expiresAtMs: number | null;
  hasRefreshToken: boolean;
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest()
  );

  return { verifier, challenge };
}

export function buildAnthropicAuthorizeUrl(
  challenge: string,
  verifier: string
): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    scope: ANTHROPIC_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });

  return `${ANTHROPIC_AUTH_URL}?${params.toString()}`;
}

export async function exchangeAnthropicCode(
  code: string,
  state: string,
  codeVerifier: string
): Promise<AnthropicOAuthTokens> {
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      state,
      grant_type: "authorization_code",
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Anthropic token exchange failed (${response.status}): ${text}`
    );
  }

  return (await response.json()) as AnthropicOAuthTokens;
}

export async function refreshAnthropicToken(
  refreshToken: string
): Promise<AnthropicOAuthTokens> {
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTHROPIC_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Anthropic token refresh failed (${response.status}): ${text}`
    );
  }

  return (await response.json()) as AnthropicOAuthTokens;
}

export function parseAnthropicCodePaste(
  rawCode: string
): { code: string; verifier: string } {
  const normalized = rawCode.trim();
  const hashIndex = normalized.indexOf("#");

  if (hashIndex === -1) {
    throw new Error(
      "Invalid code format. Expected the full code#state value from Anthropic."
    );
  }

  const code = normalized.slice(0, hashIndex).trim();
  const verifier = normalized.slice(hashIndex + 1).trim();

  if (!code || !verifier) {
    throw new Error(
      "Invalid code format. Both the code and state must be present."
    );
  }

  return { code, verifier };
}

export function getAnthropicOAuthStatus(
  config: Config = getConfig()
): AnthropicOAuthStatus {
  return {
    connected: Boolean(config.anthropicOAuthAccessToken),
    expiresAtMs:
      config.anthropicOAuthExpiresAtMs > 0
        ? config.anthropicOAuthExpiresAtMs
        : null,
    hasRefreshToken: Boolean(config.anthropicOAuthRefreshToken),
  };
}

export function buildAnthropicOAuthConfigUpdates(
  tokens: AnthropicOAuthTokens,
  options?: {
    refreshToken?: string;
    expiresAtMs?: number;
    authMode?: AnthropicAuthMode;
  }
): Partial<Config> {
  return {
    anthropicAuthMode: options?.authMode ?? "oauth",
    anthropicOAuthAccessToken: tokens.access_token,
    anthropicOAuthRefreshToken:
      tokens.refresh_token ?? options?.refreshToken ?? "",
    anthropicOAuthExpiresAtMs: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : (options?.expiresAtMs ?? 0),
  };
}

export function clearAnthropicOAuthConfigUpdates(
  authMode: AnthropicAuthMode = "apiKey"
): Partial<Config> {
  return {
    anthropicAuthMode: authMode,
    anthropicOAuthAccessToken: "",
    anthropicOAuthRefreshToken: "",
    anthropicOAuthExpiresAtMs: 0,
  };
}
