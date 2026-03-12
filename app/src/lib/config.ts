import crypto from "crypto";

import { getDb } from "./db";

export type AiProvider = "anthropic" | "openai" | "google" | "openrouter";
export type AnthropicAuthMode = "apiKey" | "oauth";
export type OpenAIAuthMode = "apiKey" | "oauth";
export type DeploymentProvider =
  | "vercel"
  | "cloudflare-pages"
  | "ssh-static";

export interface Config {
  googlePlacesApiKey: string;
  aiProvider: AiProvider;
  anthropicApiKey: string;
  anthropicAuthMode: AnthropicAuthMode;
  anthropicModel: string;
  anthropicOAuthAccessToken: string;
  anthropicOAuthRefreshToken: string;
  anthropicOAuthExpiresAtMs: number;
  openaiApiKey: string;
  openaiAuthMode: OpenAIAuthMode;
  openaiModel: string;
  openaiOAuthAccessToken: string;
  openaiOAuthRefreshToken: string;
  openaiOAuthExpiresAtMs: number;
  openaiOAuthAccountId: string;
  openaiOAuthApiKey: string;
  googleApiKey: string;
  googleModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  autoEnrichmentEnabled: boolean;
  defaultLocation: string;
  defaultRadiusKm: number;
  defaultCategories: string[];
  ownerName: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  siteBaseUrl: string;
  previewDeploymentProvider: DeploymentProvider;
  customerDeploymentProvider: DeploymentProvider;
  vercelToken: string;
  vercelTeamId: string;
  vercelPreviewProjectId: string;
  vercelPreviewRootDomain: string;
  cloudflareApiToken: string;
  cloudflareAccountId: string;
  cloudflareAccountsJson: string;
  cloudflarePreviewProjectName: string;
  cloudflareCustomerProductionBranch: string;
  sharedFormEndpointUrl: string;
  sharedFormSigningSecret: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  resendApiKey: string;
  resendFromEmail: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPrivateKey: string;
  sshKnownHosts: string;
  sshRemoteBasePath: string;
  sshPreviewUrlTemplate: string;
  sshCustomerUrlTemplate: string;
  sshPreviewPostDeployCommand: string;
  sshCustomerPostDeployCommand: string;
  previewAdminSecret: string;
  pricingText: string;
}

type SettingKey = keyof Config;

const DEFAULT_CONFIG: Config = {
  googlePlacesApiKey: "",
  aiProvider: "anthropic",
  anthropicApiKey: "",
  anthropicAuthMode: "apiKey",
  anthropicModel: "claude-sonnet-4-20250514",
  anthropicOAuthAccessToken: "",
  anthropicOAuthRefreshToken: "",
  anthropicOAuthExpiresAtMs: 0,
  openaiApiKey: "",
  openaiAuthMode: "apiKey",
  openaiModel: "gpt-4.1",
  openaiOAuthAccessToken: "",
  openaiOAuthRefreshToken: "",
  openaiOAuthExpiresAtMs: 0,
  openaiOAuthAccountId: "",
  openaiOAuthApiKey: "",
  googleApiKey: "",
  googleModel: "gemini-2.5-pro",
  openrouterApiKey: "",
  openrouterModel: "openai/gpt-4.1",
  autoEnrichmentEnabled: true,
  defaultLocation: "Hamilton, ON",
  defaultRadiusKm: 15,
  defaultCategories: [],
  ownerName: "",
  businessName: "",
  businessAddress: "",
  businessEmail: "",
  siteBaseUrl: "http://localhost:3000/sites",
  previewDeploymentProvider: "vercel",
  customerDeploymentProvider: "vercel",
  vercelToken: "",
  vercelTeamId: "",
  vercelPreviewProjectId: "",
  vercelPreviewRootDomain: "",
  cloudflareApiToken: "",
  cloudflareAccountId: "",
  cloudflareAccountsJson: "",
  cloudflarePreviewProjectName: "",
  cloudflareCustomerProductionBranch: "production",
  sharedFormEndpointUrl: "",
  sharedFormSigningSecret: "",
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  resendApiKey: "",
  resendFromEmail: "",
  sshHost: "",
  sshPort: 22,
  sshUser: "",
  sshPrivateKey: "",
  sshKnownHosts: "",
  sshRemoteBasePath: "/var/www/curb",
  sshPreviewUrlTemplate: "https://preview.example.com/{slug}",
  sshCustomerUrlTemplate: "https://sites.example.com/{slug}",
  sshPreviewPostDeployCommand: "",
  sshCustomerPostDeployCommand: "",
  previewAdminSecret: "",
  pricingText: "",
};

const SETTING_KEYS = Object.keys(DEFAULT_CONFIG) as SettingKey[];
const ARRAY_KEYS = new Set<SettingKey>(["defaultCategories"]);
const NUMBER_KEYS = new Set<SettingKey>([
  "defaultRadiusKm",
  "anthropicOAuthExpiresAtMs",
  "openaiOAuthExpiresAtMs",
  "sshPort",
]);
const BOOLEAN_KEYS = new Set<SettingKey>(["autoEnrichmentEnabled"]);

function cloneConfig(config: Config): Config {
  return {
    ...config,
    defaultCategories: [...config.defaultCategories],
  };
}

function serializeSetting(
  key: SettingKey,
  value: Config[SettingKey]
): string {
  if (ARRAY_KEYS.has(key)) {
    return JSON.stringify(value ?? []);
  }

  return String(value ?? "");
}

function parseSetting(
  key: SettingKey,
  rawValue: string | undefined
): Config[SettingKey] {
  if (rawValue === undefined) {
    return key === "defaultCategories"
      ? [...DEFAULT_CONFIG.defaultCategories]
      : DEFAULT_CONFIG[key];
  }

  if (NUMBER_KEYS.has(key)) {
    const parsed = Number.parseInt(rawValue, 10);

    if (key === "defaultRadiusKm") {
      return (Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_CONFIG.defaultRadiusKm) as Config[SettingKey];
    }

    return (Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_CONFIG[key]) as Config[SettingKey];
  }

  if (BOOLEAN_KEYS.has(key)) {
    if (rawValue === "true" || rawValue === "1") {
      return true as Config[SettingKey];
    }

    if (rawValue === "false" || rawValue === "0") {
      return false as Config[SettingKey];
    }

    return DEFAULT_CONFIG[key];
  }

  if (key === "anthropicAuthMode") {
    return (rawValue === "oauth" ? "oauth" : "apiKey") as Config[SettingKey];
  }

  if (key === "openaiAuthMode") {
    return (rawValue === "oauth" ? "oauth" : "apiKey") as Config[SettingKey];
  }

  if (key === "aiProvider") {
    return ((rawValue === "openai" ||
      rawValue === "google" ||
      rawValue === "openrouter"
      ? rawValue
      : "anthropic") as Config[SettingKey]);
  }

  if (key === "previewDeploymentProvider" || key === "customerDeploymentProvider") {
    return ((rawValue === "cloudflare-pages" ||
      rawValue === "ssh-static"
      ? rawValue
      : "vercel") as Config[SettingKey]);
  }

  if (ARRAY_KEYS.has(key)) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry).trim())
          .filter(Boolean) as Config[SettingKey];
      }
    } catch {
      return [...DEFAULT_CONFIG.defaultCategories] as Config[SettingKey];
    }

    return [...DEFAULT_CONFIG.defaultCategories] as Config[SettingKey];
  }

  return rawValue as Config[SettingKey];
}

export function initializeSettingsStore(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES (?, ?)
  `);

  const seedDefaults = db.transaction(() => {
    for (const key of SETTING_KEYS) {
      insertSetting.run(key, serializeSetting(key, DEFAULT_CONFIG[key]));
    }
  });

  seedDefaults();
  db.prepare("DELETE FROM settings WHERE key = ?").run("googlePageSpeedApiKey");

  const previewAdminSecretRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("previewAdminSecret") as { value: string } | undefined;

  if (!previewAdminSecretRow?.value.trim()) {
    db.prepare(
      `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    ).run("previewAdminSecret", crypto.randomBytes(24).toString("hex"));
  }
}

export function getConfig(): Config {
  initializeSettingsStore();

  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;

  const config = cloneConfig(DEFAULT_CONFIG);
  const mutableConfig = config as Record<SettingKey, Config[SettingKey]>;

  for (const row of rows) {
    if (!SETTING_KEYS.includes(row.key as SettingKey)) {
      continue;
    }

    const key = row.key as SettingKey;
    mutableConfig[key] = parseSetting(key, row.value);
  }

  return config;
}

export function updateConfig(updates: Partial<Config>): Config {
  initializeSettingsStore();

  const db = getDb();
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const saveUpdates = db.transaction((entries: Array<[SettingKey, Config[SettingKey]]>) => {
    for (const [key, value] of entries) {
      upsertSetting.run(key, serializeSetting(key, value));
    }
  });

  const entries = Object.entries(updates).filter((entry): entry is [SettingKey, Config[SettingKey]] =>
    SETTING_KEYS.includes(entry[0] as SettingKey) && entry[1] !== undefined
  );

  saveUpdates(entries);

  return getConfig();
}

export function clearConfigCache(): void {
  // Config is read directly from SQLite on each access.
}

export function getDefaultConfig(): Config {
  return cloneConfig(DEFAULT_CONFIG);
}
