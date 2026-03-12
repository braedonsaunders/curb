import { NextRequest, NextResponse } from "next/server";
import { getAnthropicOAuthStatus } from "@/lib/anthropic-oauth";
import { getOpenAIOAuthStatus } from "@/lib/openai-oauth";
import { AI_PROVIDER_LABELS } from "@/lib/ai-provider";
import { initializeDatabase } from "@/lib/schema";
import {
  getConfig,
  updateConfig,
  type AiProvider,
  type AnthropicAuthMode,
  type Config,
  type DeploymentProvider,
  type OpenAIAuthMode,
} from "@/lib/config";
import { listProviderModelsFromApi } from "@/lib/provider-models";

interface SettingsPayload {
  credentials: {
    googlePlaces: string;
    provider: AiProvider;
    anthropicApiKey: string;
    anthropicAuthMode: AnthropicAuthMode;
    anthropicModel: string;
    openaiApiKey: string;
    openaiAuthMode: OpenAIAuthMode;
    openaiModel: string;
    googleApiKey: string;
    googleModel: string;
    openrouterApiKey: string;
    openrouterModel: string;
  };
  anthropicOAuth: {
    connected: boolean;
    expiresAtMs: number | null;
    hasRefreshToken: boolean;
  };
  openaiOAuth: {
    connected: boolean;
    expiresAtMs: number | null;
    hasRefreshToken: boolean;
    hasPlatformApiKey: boolean;
    hasAccountId: boolean;
    mode: "platformApiKey" | "chatgptBackend" | null;
  };
  defaults: {
    location: string;
    radius: number;
    categories: string[];
    siteBaseUrl: string;
  };
  deployments: {
    previewProvider: DeploymentProvider;
    customerProvider: DeploymentProvider;
    vercel: {
      token: string;
      teamId: string;
      previewProjectId: string;
      previewRootDomain: string;
    };
    cloudflare: {
      apiToken: string;
      accountId: string;
      accountsJson: string;
      previewProjectName: string;
      customerProductionBranch: string;
    };
    sharedServer: {
      host: string;
      port: number;
      user: string;
      privateKey: string;
      knownHosts: string;
      remoteBasePath: string;
      previewUrlTemplate: string;
      customerUrlTemplate: string;
      previewPostDeployCommand: string;
      customerPostDeployCommand: string;
    };
  };
  forms: {
    endpointUrl: string;
    signingSecret: string;
    turnstileSiteKey: string;
    turnstileSecretKey: string;
    resendApiKey: string;
    resendFromEmail: string;
  };
  outreach: {
    yourName: string;
    businessName: string;
    address: string;
    email: string;
  };
  pricing: {
    text: string;
  };
  sales: {
    appBaseUrl: string;
    stripeSecretKey: string;
    stripeWebhookSecret: string;
  };
}

type WritableSettingsSection =
  | "credentials"
  | "defaults"
  | "deployments"
  | "forms"
  | "outreach"
  | "pricing"
  | "sales";

function toSettingsPayload(config: Config): SettingsPayload {
  return {
    credentials: {
      googlePlaces: config.googlePlacesApiKey,
      provider: config.aiProvider,
      anthropicApiKey: config.anthropicApiKey,
      anthropicAuthMode: config.anthropicAuthMode,
      anthropicModel: config.anthropicModel,
      openaiApiKey: config.openaiApiKey,
      openaiAuthMode: config.openaiAuthMode,
      openaiModel: config.openaiModel,
      googleApiKey: config.googleApiKey,
      googleModel: config.googleModel,
      openrouterApiKey: config.openrouterApiKey,
      openrouterModel: config.openrouterModel,
    },
    anthropicOAuth: getAnthropicOAuthStatus(config),
    openaiOAuth: getOpenAIOAuthStatus(config),
    defaults: {
      location: config.defaultLocation,
      radius: config.defaultRadiusKm,
      categories: config.defaultCategories,
      siteBaseUrl: config.siteBaseUrl,
    },
    deployments: {
      previewProvider: config.previewDeploymentProvider,
      customerProvider: config.customerDeploymentProvider,
      vercel: {
        token: config.vercelToken,
        teamId: config.vercelTeamId,
        previewProjectId: config.vercelPreviewProjectId,
        previewRootDomain: config.vercelPreviewRootDomain,
      },
      cloudflare: {
        apiToken: config.cloudflareApiToken,
        accountId: config.cloudflareAccountId,
        accountsJson: config.cloudflareAccountsJson,
        previewProjectName: config.cloudflarePreviewProjectName,
        customerProductionBranch: config.cloudflareCustomerProductionBranch,
      },
      sharedServer: {
        host: config.sshHost,
        port: config.sshPort,
        user: config.sshUser,
        privateKey: config.sshPrivateKey,
        knownHosts: config.sshKnownHosts,
        remoteBasePath: config.sshRemoteBasePath,
        previewUrlTemplate: config.sshPreviewUrlTemplate,
        customerUrlTemplate: config.sshCustomerUrlTemplate,
        previewPostDeployCommand: config.sshPreviewPostDeployCommand,
        customerPostDeployCommand: config.sshCustomerPostDeployCommand,
      },
    },
    forms: {
      endpointUrl: config.sharedFormEndpointUrl,
      signingSecret: config.sharedFormSigningSecret,
      turnstileSiteKey: config.turnstileSiteKey,
      turnstileSecretKey: config.turnstileSecretKey,
      resendApiKey: config.resendApiKey,
      resendFromEmail: config.resendFromEmail,
    },
    outreach: {
      yourName: config.ownerName,
      businessName: config.businessName,
      address: config.businessAddress,
      email: config.businessEmail,
    },
    pricing: {
      text: config.pricingText,
    },
    sales: {
      appBaseUrl: config.appBaseUrl,
      stripeSecretKey: config.stripeSecretKey,
      stripeWebhookSecret: config.stripeWebhookSecret,
    },
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function normalizeAiProvider(value: unknown): AiProvider {
  const normalized = String(value ?? "").trim();

  if (
    normalized === "openai" ||
    normalized === "google" ||
    normalized === "openrouter"
  ) {
    return normalized;
  }

  return "anthropic";
}

function normalizeDeploymentProvider(value: unknown): DeploymentProvider {
  if (value === "cloudflare-pages" || value === "ssh-static") {
    return value;
  }

  return "vercel";
}

function flattenSettingsPayload(
  section: WritableSettingsSection,
  data: unknown
): Partial<Config> {
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid "${section}" settings payload.`);
  }

  const source = data as Record<string, unknown>;

  if (section === "credentials") {
    const anthropicAuthMode =
      source.anthropicAuthMode === "oauth" ? "oauth" : "apiKey";
    const openaiAuthMode =
      source.openaiAuthMode === "oauth" ? "oauth" : "apiKey";

    return {
      googlePlacesApiKey: String(source.googlePlaces ?? ""),
      aiProvider: normalizeAiProvider(source.provider),
      anthropicApiKey: String(source.anthropicApiKey ?? ""),
      anthropicAuthMode,
      anthropicModel: String(source.anthropicModel ?? "").trim(),
      openaiApiKey: String(source.openaiApiKey ?? ""),
      openaiAuthMode,
      openaiModel: String(source.openaiModel ?? "").trim(),
      googleApiKey: String(source.googleApiKey ?? ""),
      googleModel: String(source.googleModel ?? "").trim(),
      openrouterApiKey: String(source.openrouterApiKey ?? ""),
      openrouterModel: String(source.openrouterModel ?? "").trim(),
    };
  }

  if (section === "defaults") {
    const radius = Number.parseInt(String(source.radius ?? ""), 10);

    return {
      defaultLocation: String(source.location ?? ""),
      defaultRadiusKm: Number.isFinite(radius) && radius > 0 ? radius : 15,
      defaultCategories: normalizeStringArray(source.categories),
      siteBaseUrl: String(source.siteBaseUrl ?? ""),
    };
  }

  if (section === "deployments") {
    const vercel =
      source.vercel && typeof source.vercel === "object"
        ? (source.vercel as Record<string, unknown>)
        : {};
    const cloudflare =
      source.cloudflare && typeof source.cloudflare === "object"
        ? (source.cloudflare as Record<string, unknown>)
        : {};
    const sharedServer =
      source.sharedServer && typeof source.sharedServer === "object"
        ? (source.sharedServer as Record<string, unknown>)
        : {};
    const port = Number.parseInt(String(sharedServer.port ?? ""), 10);

    return {
      previewDeploymentProvider: normalizeDeploymentProvider(
        source.previewProvider
      ),
      customerDeploymentProvider: normalizeDeploymentProvider(
        source.customerProvider
      ),
      vercelToken: String(vercel.token ?? ""),
      vercelTeamId: String(vercel.teamId ?? "").trim(),
      vercelPreviewProjectId: String(vercel.previewProjectId ?? "").trim(),
      vercelPreviewRootDomain: String(vercel.previewRootDomain ?? "").trim(),
      cloudflareApiToken: String(cloudflare.apiToken ?? ""),
      cloudflareAccountId: String(cloudflare.accountId ?? "").trim(),
      cloudflareAccountsJson: String(cloudflare.accountsJson ?? ""),
      cloudflarePreviewProjectName: String(
        cloudflare.previewProjectName ?? ""
      ).trim(),
      cloudflareCustomerProductionBranch: String(
        cloudflare.customerProductionBranch ?? ""
      ).trim(),
      sshHost: String(sharedServer.host ?? "").trim(),
      sshPort: Number.isFinite(port) && port > 0 ? port : 22,
      sshUser: String(sharedServer.user ?? "").trim(),
      sshPrivateKey: String(sharedServer.privateKey ?? ""),
      sshKnownHosts: String(sharedServer.knownHosts ?? ""),
      sshRemoteBasePath: String(sharedServer.remoteBasePath ?? "").trim(),
      sshPreviewUrlTemplate: String(sharedServer.previewUrlTemplate ?? "").trim(),
      sshCustomerUrlTemplate: String(
        sharedServer.customerUrlTemplate ?? ""
      ).trim(),
      sshPreviewPostDeployCommand: String(
        sharedServer.previewPostDeployCommand ?? ""
      ),
      sshCustomerPostDeployCommand: String(
        sharedServer.customerPostDeployCommand ?? ""
      ),
    };
  }

  if (section === "forms") {
    return {
      sharedFormEndpointUrl: String(source.endpointUrl ?? "").trim(),
      sharedFormSigningSecret: String(source.signingSecret ?? ""),
      turnstileSiteKey: String(source.turnstileSiteKey ?? "").trim(),
      turnstileSecretKey: String(source.turnstileSecretKey ?? ""),
      resendApiKey: String(source.resendApiKey ?? ""),
      resendFromEmail: String(source.resendFromEmail ?? "").trim(),
    };
  }

  if (section === "outreach") {
    return {
      ownerName: String(source.yourName ?? ""),
      businessName: String(source.businessName ?? ""),
      businessAddress: String(source.address ?? ""),
      businessEmail: String(source.email ?? ""),
    };
  }

  if (section === "pricing") {
    return {
      pricingText: String(source.text ?? ""),
    };
  }

  if (section === "sales") {
    return {
      appBaseUrl: String(source.appBaseUrl ?? "").trim(),
      stripeSecretKey: String(source.stripeSecretKey ?? ""),
      stripeWebhookSecret: String(source.stripeWebhookSecret ?? ""),
    };
  }

  throw new Error(`Unsupported settings section "${section}".`);
}

function flattenFullPayload(data: unknown): Partial<Config> {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid settings payload.");
  }

  const source = data as Partial<Record<WritableSettingsSection, unknown>>;

  return {
    ...("credentials" in source
      ? flattenSettingsPayload("credentials", source.credentials)
      : {}),
    ...("defaults" in source
      ? flattenSettingsPayload("defaults", source.defaults)
      : {}),
    ...("deployments" in source
      ? flattenSettingsPayload("deployments", source.deployments)
      : {}),
    ...("forms" in source ? flattenSettingsPayload("forms", source.forms) : {}),
    ...("outreach" in source
      ? flattenSettingsPayload("outreach", source.outreach)
      : {}),
    ...("pricing" in source
      ? flattenSettingsPayload("pricing", source.pricing)
      : {}),
    ...("sales" in source ? flattenSettingsPayload("sales", source.sales) : {}),
  };
}

function validateSettingsUpdate(
  updates: Partial<Config>,
  currentConfig: Config
): void {
  const provider = updates.aiProvider ?? currentConfig.aiProvider;
  const anthropicAuthMode =
    updates.anthropicAuthMode ?? currentConfig.anthropicAuthMode;
  const openaiAuthMode = updates.openaiAuthMode ?? currentConfig.openaiAuthMode;

  if (
    provider === "anthropic" &&
    anthropicAuthMode === "oauth" &&
    !(
      updates.anthropicOAuthAccessToken ??
      currentConfig.anthropicOAuthAccessToken
    )
  ) {
    throw new Error(
      "Connect Anthropic OAuth before using Anthropic OAuth mode."
    );
  }

  if (
    provider === "openai" &&
    openaiAuthMode === "oauth" &&
    !(
      updates.openaiOAuthAccessToken ??
      updates.openaiOAuthApiKey ??
      currentConfig.openaiOAuthAccessToken ??
      currentConfig.openaiOAuthApiKey
    )
  ) {
    throw new Error("Connect OpenAI OAuth before using OpenAI OAuth mode.");
  }
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

async function validateSelectedProviderModel(
  updates: Partial<Config>,
  currentConfig: Config
): Promise<void> {
  const nextConfig = {
    ...currentConfig,
    ...updates,
  };
  const provider = nextConfig.aiProvider;
  const providerLabel = AI_PROVIDER_LABELS[provider];
  const selectedModel = getProviderModel(nextConfig, provider).trim();

  if (!selectedModel) {
    throw new Error(`Select a ${providerLabel} model.`);
  }

  const result = await listProviderModelsFromApi(provider, {
    config: nextConfig,
  });

  if (result.models.length === 0) {
    throw new Error(`${providerLabel} returned an empty model list.`);
  }

  if (!result.models.includes(selectedModel)) {
    throw new Error(`Select a ${providerLabel} model from the provider list.`);
  }
}

export async function GET() {
  try {
    initializeDatabase();
    return NextResponse.json(toSettingsPayload(getConfig()));
  } catch (err) {
    console.error("Get settings error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    initializeDatabase();

    const body = await request.json();
    const currentConfig = getConfig();
    let updates: Partial<Config>;

    if (body?.section) {
      updates = flattenSettingsPayload(
        body.section as WritableSettingsSection,
        body.data
      );
    } else {
      updates = flattenFullPayload(body);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid settings to update" },
        { status: 400 }
      );
    }

    validateSettingsUpdate(updates, currentConfig);

    if (!body?.section || body.section === "credentials") {
      await validateSelectedProviderModel(updates, currentConfig);
    }

    const saved = updateConfig(updates);
    return NextResponse.json(toSettingsPayload(saved));
  } catch (err) {
    console.error("Update settings error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const status =
      message.startsWith("Invalid") ||
      message.startsWith("Unsupported") ||
      message.startsWith("Connect Anthropic OAuth") ||
      message.startsWith("Connect OpenAI OAuth")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return PUT(request);
}
