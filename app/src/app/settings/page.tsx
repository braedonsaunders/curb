"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_ORDER,
  DEFAULT_AI_MODELS,
} from "@/lib/ai-provider";
import type {
  AiProvider,
  AnthropicAuthMode,
  DeploymentProvider,
  OpenAIAuthMode,
} from "@/lib/config";
import { formatStoredDateTime } from "@/lib/datetime";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Key,
  Link2,
  MapPin,
  User,
  Unplug,
  DollarSign,
  Loader2,
  RefreshCw,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";

interface SettingsData {
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

interface ProviderModelsResponse {
  models?: string[];
  selectedModel?: string | null;
  error?: string;
}

interface ProviderModelState {
  status: "idle" | "loading" | "ready" | "error";
  models: string[];
  error: string | null;
}

type ProviderCredentialDraft = Pick<
  SettingsData["credentials"],
  | "provider"
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
>;

type SettingsResponse = Partial<
  Omit<
    SettingsData,
    | "credentials"
    | "anthropicOAuth"
    | "openaiOAuth"
    | "defaults"
    | "forms"
    | "outreach"
    | "pricing"
    | "sales"
  >
> & {
  credentials?: Partial<SettingsData["credentials"]>;
  anthropicOAuth?: Partial<SettingsData["anthropicOAuth"]>;
  openaiOAuth?: Partial<SettingsData["openaiOAuth"]>;
  defaults?: Partial<SettingsData["defaults"]>;
  forms?: Partial<SettingsData["forms"]>;
  deployments?: Partial<SettingsData["deployments"]> & {
    vercel?: Partial<SettingsData["deployments"]["vercel"]>;
    cloudflare?: Partial<SettingsData["deployments"]["cloudflare"]>;
    sharedServer?: Partial<SettingsData["deployments"]["sharedServer"]>;
  };
  outreach?: Partial<SettingsData["outreach"]>;
  pricing?: Partial<SettingsData["pricing"]>;
  sales?: Partial<SettingsData["sales"]>;
};

const DEFAULT_SETTINGS: SettingsData = {
  credentials: {
    googlePlaces: "",
    provider: "anthropic",
    anthropicApiKey: "",
    anthropicAuthMode: "apiKey",
    anthropicModel: DEFAULT_AI_MODELS.anthropic,
    openaiApiKey: "",
    openaiAuthMode: "apiKey",
    openaiModel: DEFAULT_AI_MODELS.openai,
    googleApiKey: "",
    googleModel: DEFAULT_AI_MODELS.google,
    openrouterApiKey: "",
    openrouterModel: DEFAULT_AI_MODELS.openrouter,
  },
  anthropicOAuth: {
    connected: false,
    expiresAtMs: null,
    hasRefreshToken: false,
  },
  openaiOAuth: {
    connected: false,
    expiresAtMs: null,
    hasRefreshToken: false,
    hasPlatformApiKey: false,
    hasAccountId: false,
    mode: null,
  },
  defaults: {
    location: "Hamilton, ON",
    radius: 15,
    categories: [],
    siteBaseUrl: "http://localhost:3000/sites",
  },
  deployments: {
    previewProvider: "vercel",
    customerProvider: "vercel",
    vercel: {
      token: "",
      teamId: "",
      previewProjectId: "",
      previewRootDomain: "",
    },
    cloudflare: {
      apiToken: "",
      accountId: "",
      accountsJson: "",
      previewProjectName: "",
      customerProductionBranch: "production",
    },
    sharedServer: {
      host: "",
      port: 22,
      user: "",
      privateKey: "",
      knownHosts: "",
      remoteBasePath: "/var/www/curb",
      previewUrlTemplate: "https://preview.example.com/{slug}",
      customerUrlTemplate: "https://sites.example.com/{slug}",
      previewPostDeployCommand: "",
      customerPostDeployCommand: "",
    },
  },
  forms: {
    endpointUrl: "",
    signingSecret: "",
    turnstileSiteKey: "",
    turnstileSecretKey: "",
    resendApiKey: "",
    resendFromEmail: "",
  },
  outreach: { yourName: "", businessName: "", address: "", email: "" },
  pricing: { text: "" },
  sales: {
    appBaseUrl: "http://localhost:3000",
    stripeSecretKey: "",
    stripeWebhookSecret: "",
  },
};

const DEPLOYMENT_PROVIDER_LABELS: Record<DeploymentProvider, string> = {
  vercel: "Vercel",
  "cloudflare-pages": "Cloudflare Pages",
  "ssh-static": "Shared Server",
};

const PROVIDER_MODEL_FIELDS = {
  anthropic: "anthropicModel",
  openai: "openaiModel",
  google: "googleModel",
  openrouter: "openrouterModel",
} as const satisfies Record<AiProvider, keyof SettingsData["credentials"]>;

function createProviderModelStateMap(): Record<AiProvider, ProviderModelState> {
  return {
    anthropic: { status: "idle", models: [], error: null },
    openai: { status: "idle", models: [], error: null },
    google: { status: "idle", models: [], error: null },
    openrouter: { status: "idle", models: [], error: null },
  };
}

function getProviderModelReadiness(
  settings: {
    credentials: ProviderCredentialDraft;
    anthropicOAuthConnected: boolean;
    openaiOAuthConnected: boolean;
  },
  provider: AiProvider
): { canLoad: boolean; reason: string } {
  switch (provider) {
    case "anthropic":
      if (settings.credentials.anthropicAuthMode === "oauth") {
        return settings.anthropicOAuthConnected
          ? { canLoad: true, reason: "" }
          : {
              canLoad: false,
              reason: "Connect Anthropic OAuth to load Anthropic models.",
            };
      }

      return settings.credentials.anthropicApiKey.trim()
        ? { canLoad: true, reason: "" }
        : {
            canLoad: false,
            reason: "Enter an Anthropic API key to load Anthropic models.",
          };
    case "openai":
      if (settings.credentials.openaiAuthMode === "oauth") {
        return settings.openaiOAuthConnected
          ? { canLoad: true, reason: "" }
          : {
              canLoad: false,
              reason: "Connect OpenAI OAuth to load OpenAI models.",
            };
      }

      return settings.credentials.openaiApiKey.trim()
        ? { canLoad: true, reason: "" }
        : {
            canLoad: false,
            reason: "Enter an OpenAI API key to load OpenAI models.",
          };
    case "google":
      return settings.credentials.googleApiKey.trim()
        ? { canLoad: true, reason: "" }
        : {
            canLoad: false,
            reason: "Enter a Google AI API key to load Gemini models.",
          };
    case "openrouter":
      return settings.credentials.openrouterApiKey.trim()
        ? { canLoad: true, reason: "" }
        : {
            canLoad: false,
            reason: "Enter an OpenRouter API key to load OpenRouter models.",
          };
  }
}

function normalizeSettingsData(data: SettingsResponse): SettingsData {
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    credentials: {
      ...DEFAULT_SETTINGS.credentials,
      ...(data.credentials ?? {}),
    },
    anthropicOAuth: {
      ...DEFAULT_SETTINGS.anthropicOAuth,
      ...(data.anthropicOAuth ?? {}),
    },
    openaiOAuth: {
      ...DEFAULT_SETTINGS.openaiOAuth,
      ...(data.openaiOAuth ?? {}),
    },
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(data.defaults ?? {}) },
    forms: { ...DEFAULT_SETTINGS.forms, ...(data.forms ?? {}) },
    deployments: {
      ...DEFAULT_SETTINGS.deployments,
      ...(data.deployments ?? {}),
      vercel: {
        ...DEFAULT_SETTINGS.deployments.vercel,
        ...(data.deployments?.vercel ?? {}),
      },
      cloudflare: {
        ...DEFAULT_SETTINGS.deployments.cloudflare,
        ...(data.deployments?.cloudflare ?? {}),
      },
      sharedServer: {
        ...DEFAULT_SETTINGS.deployments.sharedServer,
        ...(data.deployments?.sharedServer ?? {}),
      },
    },
    outreach: { ...DEFAULT_SETTINGS.outreach, ...(data.outreach ?? {}) },
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(data.pricing ?? {}) },
    sales: { ...DEFAULT_SETTINGS.sales, ...(data.sales ?? {}) },
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [providerModels, setProviderModels] = useState<
    Record<AiProvider, ProviderModelState>
  >(createProviderModelStateMap);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    googlePlaces: false,
    anthropicApiKey: false,
    openaiApiKey: false,
    googleApiKey: false,
    openrouterApiKey: false,
    vercelToken: false,
    cloudflareApiToken: false,
    sharedFormSigningSecret: false,
    turnstileSecretKey: false,
    resendApiKey: false,
    stripeSecretKey: false,
    stripeWebhookSecret: false,
    sshPrivateKey: false,
  });
  const [oauthPhase, setOauthPhase] = useState<
    "idle" | "waiting" | "exchanging" | "disconnecting"
  >("idle");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState<string | null>(
    null
  );
  const [openAIOauthPhase, setOpenAIOauthPhase] = useState<
    "idle" | "waiting" | "disconnecting"
  >("idle");
  const [openAIOauthError, setOpenAIOauthError] = useState<string | null>(
    null
  );
  const [openAIOauthAuthorizeUrl, setOpenAIOauthAuthorizeUrl] = useState<
    string | null
  >(null);
  const latestModelRequestRef = useRef<Record<AiProvider, number>>({
    anthropic: 0,
    openai: 0,
    google: 0,
    openrouter: 0,
  });
  const modelRequestCredentials = useMemo<ProviderCredentialDraft>(
    () => ({
      provider: settings.credentials.provider,
      anthropicApiKey: settings.credentials.anthropicApiKey,
      anthropicAuthMode: settings.credentials.anthropicAuthMode,
      anthropicModel: settings.credentials.anthropicModel,
      openaiApiKey: settings.credentials.openaiApiKey,
      openaiAuthMode: settings.credentials.openaiAuthMode,
      openaiModel: settings.credentials.openaiModel,
      googleApiKey: settings.credentials.googleApiKey,
      googleModel: settings.credentials.googleModel,
      openrouterApiKey: settings.credentials.openrouterApiKey,
      openrouterModel: settings.credentials.openrouterModel,
    }),
    [
      settings.credentials.provider,
      settings.credentials.anthropicApiKey,
      settings.credentials.anthropicAuthMode,
      settings.credentials.anthropicModel,
      settings.credentials.openaiApiKey,
      settings.credentials.openaiAuthMode,
      settings.credentials.openaiModel,
      settings.credentials.googleApiKey,
      settings.credentials.googleModel,
      settings.credentials.openrouterApiKey,
      settings.credentials.openrouterModel,
    ]
  );
  const modelReadinessState = useMemo(
    () => ({
      credentials: modelRequestCredentials,
      anthropicOAuthConnected: settings.anthropicOAuth.connected,
      openaiOAuthConnected: settings.openaiOAuth.connected,
    }),
    [
      modelRequestCredentials,
      settings.anthropicOAuth.connected,
      settings.openaiOAuth.connected,
    ]
  );

  useEffect(() => {
    void fetchSettings();
  }, []);

  useEffect(() => {
    if (openAIOauthPhase !== "waiting") {
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await fetch("/api/settings/openai-oauth");
        const data = (await res.json().catch(() => null)) as
          | {
              error?: string;
              status?: Partial<SettingsData["openaiOAuth"]>;
              flow?: {
                status?: "idle" | "pending" | "complete" | "error";
                error?: string;
                authorizeUrl?: string;
              };
            }
          | null;

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to load OpenAI OAuth status");
        }

        if (data?.status) {
          setSettings((prev) =>
            normalizeSettingsData({
              ...prev,
              credentials: {
                ...prev.credentials,
                openaiAuthMode: data.status?.connected ? "oauth" : prev.credentials.openaiAuthMode,
              },
              openaiOAuth: data.status,
            })
          );
        }

        if (data?.flow?.authorizeUrl) {
          setOpenAIOauthAuthorizeUrl(data.flow.authorizeUrl);
        }

        if (data?.flow?.status === "error") {
          const message = data.flow.error ?? "OpenAI OAuth failed";
          setOpenAIOauthPhase("idle");
          setOpenAIOauthError(message);
          toast.error(message);
          return;
        }

        if (data?.status?.connected || data?.flow?.status === "complete") {
          setOpenAIOauthPhase("idle");
          setOpenAIOauthError(null);
          setOpenAIOauthAuthorizeUrl(null);
          await fetchSettings();
          toast.success("OpenAI OAuth connected");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Failed to load OpenAI OAuth status";
        setOpenAIOauthPhase("idle");
        setOpenAIOauthError(message);
        toast.error(message);
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [openAIOauthPhase]);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as SettingsResponse;
      setSettings(normalizeSettingsData(data));
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveSection(section: string) {
    setSaving(section);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          data: (settings as unknown as Record<string, unknown>)[section],
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | (SettingsResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to save settings");
      }
      setSettings(normalizeSettingsData(data ?? {}));
      toast.success("Settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings"
      );
    } finally {
      setSaving(null);
    }
  }

  function updateCredential<K extends keyof SettingsData["credentials"]>(
    key: K,
    value: SettingsData["credentials"][K]
  ) {
    setSettings((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, [key]: value },
    }));
  }

  function updateAnthropicAuthMode(value: AnthropicAuthMode) {
    setSettings((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, anthropicAuthMode: value },
    }));
  }

  function updateOpenAIAuthMode(value: OpenAIAuthMode) {
    setSettings((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, openaiAuthMode: value },
    }));
  }

  function updateDefaults(key: keyof SettingsData["defaults"], value: string | number | string[]) {
    setSettings((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [key]: value },
    }));
  }

  function updateDeploymentProviders(
    key: "previewProvider" | "customerProvider",
    value: DeploymentProvider
  ) {
    setSettings((prev) => ({
      ...prev,
      deployments: { ...prev.deployments, [key]: value },
    }));
  }

  function updateVercel(
    key: keyof SettingsData["deployments"]["vercel"],
    value: string
  ) {
    setSettings((prev) => ({
      ...prev,
      deployments: {
        ...prev.deployments,
        vercel: { ...prev.deployments.vercel, [key]: value },
      },
    }));
  }

  function updateCloudflare(
    key: keyof SettingsData["deployments"]["cloudflare"],
    value: string
  ) {
    setSettings((prev) => ({
      ...prev,
      deployments: {
        ...prev.deployments,
        cloudflare: { ...prev.deployments.cloudflare, [key]: value },
      },
    }));
  }

  function updateSharedServer(
    key: keyof SettingsData["deployments"]["sharedServer"],
    value: string | number
  ) {
    setSettings((prev) => ({
      ...prev,
      deployments: {
        ...prev.deployments,
        sharedServer: { ...prev.deployments.sharedServer, [key]: value },
      },
    }));
  }

  function updateForms(key: keyof SettingsData["forms"], value: string) {
    setSettings((prev) => ({
      ...prev,
      forms: { ...prev.forms, [key]: value },
    }));
  }

  function updateOutreach(key: keyof SettingsData["outreach"], value: string) {
    setSettings((prev) => ({
      ...prev,
      outreach: { ...prev.outreach, [key]: value },
    }));
  }

  function toggleKeyVisibility(key: string) {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function updateSales(key: keyof SettingsData["sales"], value: string) {
    setSettings((prev) => ({
      ...prev,
      sales: { ...prev.sales, [key]: value },
    }));
  }

  const loadProviderModels = useCallback(async (
    provider: AiProvider,
    options?: { forceRefresh?: boolean }
  ) => {
    const readiness = getProviderModelReadiness(modelReadinessState, provider);

    if (!readiness.canLoad) {
      setProviderModels((prev) => ({
        ...prev,
        [provider]: {
          status: "idle",
          models: [],
          error: null,
        },
      }));
      return;
    }

    const requestId = latestModelRequestRef.current[provider] + 1;
    latestModelRequestRef.current[provider] = requestId;

    setProviderModels((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        status: "loading",
        error: null,
      },
    }));

    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          credentials: modelRequestCredentials,
          forceRefresh: options?.forceRefresh === true,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | ProviderModelsResponse
        | null;

      if (!res.ok) {
        throw new Error(
          data?.error ?? `Failed to load ${AI_PROVIDER_LABELS[provider]} models`
        );
      }

      if (latestModelRequestRef.current[provider] !== requestId) {
        return;
      }

      const models = Array.isArray(data?.models)
        ? data.models.filter(
            (model): model is string =>
              typeof model === "string" && model.trim().length > 0
          )
        : [];
      const selectedModel =
        typeof data?.selectedModel === "string" && data.selectedModel.trim()
          ? data.selectedModel
          : (models[0] ?? null);

      setProviderModels((prev) => ({
        ...prev,
        [provider]: {
          status: "ready",
          models,
          error: null,
        },
      }));

      if (!selectedModel) {
        return;
      }

      const modelField = PROVIDER_MODEL_FIELDS[provider];
      setSettings((prev) => {
        const currentModel = String(prev.credentials[modelField] ?? "").trim();

        if (currentModel && models.includes(currentModel)) {
          return prev;
        }

        return {
          ...prev,
          credentials: {
            ...prev.credentials,
            [modelField]: selectedModel,
          },
        };
      });
    } catch (error) {
      if (latestModelRequestRef.current[provider] !== requestId) {
        return;
      }

      setProviderModels((prev) => ({
        ...prev,
        [provider]: {
          status: "error",
          models: [],
          error:
            error instanceof Error
              ? error.message
              : `Failed to load ${AI_PROVIDER_LABELS[provider]} models`,
        },
      }));
    }
  }, [
    modelReadinessState,
    modelRequestCredentials,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadProviderModels(settings.credentials.provider);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    loading,
    loadProviderModels,
    settings.credentials.provider,
  ]);

  async function startAnthropicOAuth() {
    setOauthPhase("waiting");
    setOauthError(null);

    try {
      const res = await fetch("/api/settings/anthropic-oauth/start", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? "Failed to start Anthropic OAuth");
      }

      setOauthAuthorizeUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start OAuth flow";
      setOauthPhase("idle");
      setOauthError(message);
      toast.error(message);
    }
  }

  async function exchangeAnthropicOAuth() {
    if (!oauthCode.trim()) {
      setOauthError("Paste the full code#state value from Anthropic.");
      return;
    }

    setOauthPhase("exchanging");
    setOauthError(null);

    try {
      const res = await fetch("/api/settings/anthropic-oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: oauthCode.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            status?: SettingsData["anthropicOAuth"];
          }
        | null;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to connect Anthropic OAuth");
      }

      setSettings((prev) =>
        normalizeSettingsData({
          ...prev,
          credentials: {
            ...prev.credentials,
            provider: "anthropic",
            anthropicAuthMode: "oauth",
          },
          anthropicOAuth:
            data.status ?? {
              connected: true,
              expiresAtMs: null,
              hasRefreshToken: false,
            },
        })
      );
      setOauthCode("");
      setOauthPhase("idle");
      setOauthAuthorizeUrl(null);
      toast.success("Anthropic OAuth connected");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to connect OAuth";
      setOauthPhase("waiting");
      setOauthError(message);
      toast.error(message);
    }
  }

  async function disconnectAnthropicOAuth() {
    setOauthPhase("disconnecting");
    setOauthError(null);

    try {
      const res = await fetch("/api/settings/anthropic-oauth", {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            status?: SettingsData["anthropicOAuth"];
          }
        | null;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to disconnect Anthropic OAuth");
      }

      setSettings((prev) =>
        normalizeSettingsData({
          ...prev,
          credentials: {
            ...prev.credentials,
            anthropicAuthMode: "apiKey",
          },
          anthropicOAuth:
            data.status ?? {
              connected: false,
              expiresAtMs: null,
              hasRefreshToken: false,
            },
        })
      );
      setOauthCode("");
      setOauthPhase("idle");
      setOauthAuthorizeUrl(null);
      toast.success("Anthropic OAuth disconnected");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disconnect OAuth";
      setOauthPhase("idle");
      setOauthError(message);
      toast.error(message);
    }
  }

  async function startOpenAIOAuth() {
    setOpenAIOauthPhase("waiting");
    setOpenAIOauthError(null);

    try {
      const res = await fetch("/api/settings/openai-oauth/start", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? "Failed to start OpenAI OAuth");
      }

      setOpenAIOauthAuthorizeUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start OpenAI OAuth";
      setOpenAIOauthPhase("idle");
      setOpenAIOauthError(message);
      toast.error(message);
    }
  }

  async function disconnectOpenAIOAuth() {
    setOpenAIOauthPhase("disconnecting");
    setOpenAIOauthError(null);

    try {
      const res = await fetch("/api/settings/openai-oauth", {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            status?: SettingsData["openaiOAuth"];
          }
        | null;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to disconnect OpenAI OAuth");
      }

      setSettings((prev) =>
        normalizeSettingsData({
          ...prev,
          credentials: {
            ...prev.credentials,
            openaiAuthMode: "apiKey",
          },
          openaiOAuth:
            data.status ?? {
              connected: false,
              expiresAtMs: null,
              hasRefreshToken: false,
              hasPlatformApiKey: false,
              hasAccountId: false,
              mode: null,
            },
        })
      );
      setOpenAIOauthPhase("idle");
      setOpenAIOauthError(null);
      setOpenAIOauthAuthorizeUrl(null);
      toast.success("OpenAI OAuth disconnected");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to disconnect OpenAI OAuth";
      setOpenAIOauthPhase("idle");
      setOpenAIOauthError(message);
      toast.error(message);
    }
  }

  function renderProviderModelField(
    provider: AiProvider,
    label: string,
    description: string
  ) {
    const modelField = PROVIDER_MODEL_FIELDS[provider];
    const modelState = providerModels[provider];
    const readiness = getProviderModelReadiness(modelReadinessState, provider);
    const selectedModel = String(settings.credentials[modelField] ?? "").trim();
    const helperText =
      modelState.status === "error"
        ? modelState.error
        : modelState.status === "loading"
          ? `Loading ${AI_PROVIDER_LABELS[provider]} models...`
          : readiness.canLoad
            ? description
            : readiness.reason;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${provider}Model`}>{label}</Label>
          <Button
            variant="outline"
            size="icon"
            title={`Refresh ${AI_PROVIDER_LABELS[provider]} models`}
            onClick={() => void loadProviderModels(provider, { forceRefresh: true })}
            disabled={!readiness.canLoad || modelState.status === "loading"}
          >
            <RefreshCw
              className={
                modelState.status === "loading" ? "size-4 animate-spin" : "size-4"
              }
            />
          </Button>
        </div>

        <Select
          value={selectedModel || null}
          onValueChange={(value: string | null) => {
            if (value) {
              updateCredential(modelField, value);
            }
          }}
          disabled={
            modelState.status === "loading" || modelState.models.length === 0
          }
        >
          <SelectTrigger id={`${provider}Model`} className="w-full">
            <SelectValue
              placeholder={
                modelState.status === "loading"
                  ? "Loading models..."
                  : readiness.canLoad
                    ? "Select a model"
                    : "Connect credentials to load models"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {modelState.models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p
          className={
            modelState.status === "error"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {helperText}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const oauthViewState =
    oauthPhase === "disconnecting" ||
    oauthPhase === "exchanging" ||
    oauthPhase === "waiting"
      ? oauthPhase
      : settings.anthropicOAuth.connected
        ? "complete"
        : "idle";
  const oauthExpiryLabel = settings.anthropicOAuth.expiresAtMs
    ? formatStoredDateTime(settings.anthropicOAuth.expiresAtMs)
    : null;
  const openAIOauthViewState =
    openAIOauthPhase === "disconnecting" || openAIOauthPhase === "waiting"
      ? openAIOauthPhase
      : settings.openaiOAuth.connected
        ? "complete"
        : "idle";
  const openAIOauthExpiryLabel = settings.openaiOAuth.expiresAtMs
    ? formatStoredDateTime(settings.openaiOAuth.expiresAtMs)
    : null;
  const activeProvider = settings.credentials.provider;
  const activeProviderLabel = AI_PROVIDER_LABELS[activeProvider];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure discovery, visual audits, and outreach details
        </p>
      </div>

      <Tabs defaultValue="deployments" className="space-y-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="credentials">AI & APIs</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="outreach">Outreach</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
        </TabsList>

        <TabsContent value="deployments" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="size-4" />
                Deployment Targets
              </CardTitle>
              <CardDescription>
                Choose the provider used for previews and customer launches,
                then fill in the credentials for any provider you want Curb to
                use.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="previewDeploymentProvider">
                    Preview Provider
                  </Label>
                  <Select
                    value={settings.deployments.previewProvider}
                    onValueChange={(value) =>
                      updateDeploymentProviders(
                        "previewProvider",
                        value as DeploymentProvider
                      )
                    }
                  >
                    <SelectTrigger id="previewDeploymentProvider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(DEPLOYMENT_PROVIDER_LABELS) as Array<
                          [DeploymentProvider, string]
                        >
                      ).map(([provider, label]) => (
                        <SelectItem key={provider} value={provider}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This provider handles the public preview URL attached to a
                    generated site.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customerDeploymentProvider">
                    Customer Provider
                  </Label>
                  <Select
                    value={settings.deployments.customerProvider}
                    onValueChange={(value) =>
                      updateDeploymentProviders(
                        "customerProvider",
                        value as DeploymentProvider
                      )
                    }
                  >
                    <SelectTrigger id="customerDeploymentProvider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(DEPLOYMENT_PROVIDER_LABELS) as Array<
                          [DeploymentProvider, string]
                        >
                      ).map(([provider, label]) => (
                        <SelectItem key={provider} value={provider}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This provider handles the live customer deployment flow.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="space-y-4 rounded-xl border p-4">
                  <div className="space-y-1">
                    <p className="font-medium">Vercel</p>
                    <p className="text-xs text-muted-foreground">
                      Best when you want shared preview projects and per-customer
                      dedicated projects managed fully inside Vercel.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vercelToken">Token</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="vercelToken"
                          type={showKeys.vercelToken ? "text" : "password"}
                          value={settings.deployments.vercel.token}
                          onChange={(e) => updateVercel("token", e.target.value)}
                          placeholder="Enter a Vercel access token"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleKeyVisibility("vercelToken")}
                      >
                        {showKeys.vercelToken ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vercelTeamId">Team ID</Label>
                    <Input
                      id="vercelTeamId"
                      value={settings.deployments.vercel.teamId}
                      onChange={(e) => updateVercel("teamId", e.target.value)}
                      placeholder="Optional for personal accounts"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vercelPreviewProjectId">
                      Preview Project ID
                    </Label>
                    <Input
                      id="vercelPreviewProjectId"
                      value={settings.deployments.vercel.previewProjectId}
                      onChange={(e) =>
                        updateVercel("previewProjectId", e.target.value)
                      }
                      placeholder="Existing shared preview project"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vercelPreviewRootDomain">
                      Preview Root Domain
                    </Label>
                    <Input
                      id="vercelPreviewRootDomain"
                      value={settings.deployments.vercel.previewRootDomain}
                      onChange={(e) =>
                        updateVercel("previewRootDomain", e.target.value)
                      }
                      placeholder="preview.example.com"
                    />
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border p-4">
                  <div className="space-y-1">
                    <p className="font-medium">Cloudflare Pages</p>
                    <p className="text-xs text-muted-foreground">
                      Uses direct uploads through a pinned local Wrangler binary
                      and can create dedicated customer projects automatically.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cloudflareApiToken">API Token</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="cloudflareApiToken"
                          type={showKeys.cloudflareApiToken ? "text" : "password"}
                          value={settings.deployments.cloudflare.apiToken}
                          onChange={(e) =>
                            updateCloudflare("apiToken", e.target.value)
                          }
                          placeholder="Enter a Cloudflare API token"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleKeyVisibility("cloudflareApiToken")}
                      >
                        {showKeys.cloudflareApiToken ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cloudflareAccountId">Account ID</Label>
                    <Input
                      id="cloudflareAccountId"
                      value={settings.deployments.cloudflare.accountId}
                      onChange={(e) =>
                        updateCloudflare("accountId", e.target.value)
                      }
                      placeholder="Cloudflare account id"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cloudflareAccountsJson">
                      Optional Account Pool JSON
                    </Label>
                    <Textarea
                      id="cloudflareAccountsJson"
                      value={settings.deployments.cloudflare.accountsJson}
                      onChange={(e) =>
                        updateCloudflare("accountsJson", e.target.value)
                      }
                      placeholder={`[
  {
    "label": "pool-east",
    "accountId": "cf-account-id",
    "apiToken": "cf-api-token",
    "previewProjectName": "curb-previews",
    "customerProductionBranch": "production"
  }
]`}
                      rows={8}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional. When set, Curb hashes customer sites across
                      these Cloudflare accounts and reuses the same account for
                      future redeploys. The single-account fields above remain
                      the fallback.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cloudflarePreviewProjectName">
                      Preview Project Name
                    </Label>
                    <Input
                      id="cloudflarePreviewProjectName"
                      value={settings.deployments.cloudflare.previewProjectName}
                      onChange={(e) =>
                        updateCloudflare("previewProjectName", e.target.value)
                      }
                      placeholder="curb-previews"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cloudflareCustomerProductionBranch">
                      Customer Production Branch
                    </Label>
                    <Input
                      id="cloudflareCustomerProductionBranch"
                      value={
                        settings.deployments.cloudflare.customerProductionBranch
                      }
                      onChange={(e) =>
                        updateCloudflare(
                          "customerProductionBranch",
                          e.target.value
                        )
                      }
                      placeholder="production"
                    />
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border p-4">
                  <div className="space-y-1">
                    <p className="font-medium">Shared Server</p>
                    <p className="text-xs text-muted-foreground">
                      Uploads versioned releases over SSH/SCP, swaps a `current`
                      symlink, and can run your own post-deploy hook to wire
                      routing or TLS.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="sharedServerHost">Host</Label>
                      <Input
                        id="sharedServerHost"
                        value={settings.deployments.sharedServer.host}
                        onChange={(e) => updateSharedServer("host", e.target.value)}
                        placeholder="deploy.example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sharedServerPort">Port</Label>
                      <Input
                        id="sharedServerPort"
                        type="number"
                        value={settings.deployments.sharedServer.port}
                        onChange={(e) =>
                          updateSharedServer(
                            "port",
                            Number.parseInt(e.target.value, 10) || 22
                          )
                        }
                        placeholder="22"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerUser">User</Label>
                    <Input
                      id="sharedServerUser"
                      value={settings.deployments.sharedServer.user}
                      onChange={(e) => updateSharedServer("user", e.target.value)}
                      placeholder="deploy"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerPrivateKey">Private Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Textarea
                          id="sharedServerPrivateKey"
                          value={settings.deployments.sharedServer.privateKey}
                          onChange={(e) =>
                            updateSharedServer("privateKey", e.target.value)
                          }
                          placeholder="Optional if your SSH agent already has the key loaded"
                          rows={5}
                          className={showKeys.sshPrivateKey ? "" : "[text-security:disc]"}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => toggleKeyVisibility("sshPrivateKey")}
                      >
                        {showKeys.sshPrivateKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerKnownHosts">Known Hosts</Label>
                    <Textarea
                      id="sharedServerKnownHosts"
                      value={settings.deployments.sharedServer.knownHosts}
                      onChange={(e) =>
                        updateSharedServer("knownHosts", e.target.value)
                      }
                      placeholder="Optional. Paste a known_hosts entry to pin the server host key."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerRemoteBasePath">
                      Remote Base Path
                    </Label>
                    <Input
                      id="sharedServerRemoteBasePath"
                      value={settings.deployments.sharedServer.remoteBasePath}
                      onChange={(e) =>
                        updateSharedServer("remoteBasePath", e.target.value)
                      }
                      placeholder="/var/www/curb"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerPreviewUrlTemplate">
                      Preview URL Template
                    </Label>
                    <Input
                      id="sharedServerPreviewUrlTemplate"
                      value={settings.deployments.sharedServer.previewUrlTemplate}
                      onChange={(e) =>
                        updateSharedServer("previewUrlTemplate", e.target.value)
                      }
                      placeholder="https://preview.example.com/{slug}"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerCustomerUrlTemplate">
                      Customer URL Template
                    </Label>
                    <Input
                      id="sharedServerCustomerUrlTemplate"
                      value={settings.deployments.sharedServer.customerUrlTemplate}
                      onChange={(e) =>
                        updateSharedServer("customerUrlTemplate", e.target.value)
                      }
                      placeholder="https://sites.example.com/{slug}"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerPreviewPostDeployCommand">
                      Preview Post-Deploy Command
                    </Label>
                    <Textarea
                      id="sharedServerPreviewPostDeployCommand"
                      value={
                        settings.deployments.sharedServer.previewPostDeployCommand
                      }
                      onChange={(e) =>
                        updateSharedServer(
                          "previewPostDeployCommand",
                          e.target.value
                        )
                      }
                      placeholder="Optional. Supports placeholders like {slug}, {deployment_dir}, {current_dir}, and {deployment_url}."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedServerCustomerPostDeployCommand">
                      Customer Post-Deploy Command
                    </Label>
                    <Textarea
                      id="sharedServerCustomerPostDeployCommand"
                      value={
                        settings.deployments.sharedServer.customerPostDeployCommand
                      }
                      onChange={(e) =>
                        updateSharedServer(
                          "customerPostDeployCommand",
                          e.target.value
                        )
                      }
                      placeholder="Optional. Use this to provision vhosts, reload Caddy/Nginx, or request certificates."
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                Active preview target:{" "}
                {
                  DEPLOYMENT_PROVIDER_LABELS[
                    settings.deployments.previewProvider
                  ]
                }
                . Active customer target:{" "}
                {
                  DEPLOYMENT_PROVIDER_LABELS[
                    settings.deployments.customerProvider
                  ]
                }
                .
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("deployments")}
                  disabled={saving === "deployments"}
                >
                  {saving === "deployments" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Deployment Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forms" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4" />
                Shared Lead Form Service
              </CardTitle>
              <CardDescription>
                Generated sites now submit contact forms to one shared endpoint
                instead of using `mailto`. Deploy the Cloudflare worker, then
                paste its public URL and credentials here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4 rounded-xl border p-4">
                  <div className="space-y-1">
                    <p className="font-medium">Endpoint</p>
                    <p className="text-xs text-muted-foreground">
                      Public HTTPS URL for the shared form handler. Example:
                      `https://forms.example.com/submit`
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedFormEndpointUrl">Endpoint URL</Label>
                    <Input
                      id="sharedFormEndpointUrl"
                      value={settings.forms.endpointUrl}
                      onChange={(e) =>
                        updateForms("endpointUrl", e.target.value)
                      }
                      placeholder="https://forms.example.com/submit"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharedFormSigningSecret">
                      Signing Secret
                    </Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="sharedFormSigningSecret"
                          type={
                            showKeys.sharedFormSigningSecret
                              ? "text"
                              : "password"
                          }
                          value={settings.forms.signingSecret}
                          onChange={(e) =>
                            updateForms("signingSecret", e.target.value)
                          }
                          placeholder="Long random secret shared with the Cloudflare worker"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          toggleKeyVisibility("sharedFormSigningSecret")
                        }
                      >
                        {showKeys.sharedFormSigningSecret ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border p-4">
                  <div className="space-y-1">
                    <p className="font-medium">Turnstile</p>
                    <p className="text-xs text-muted-foreground">
                      Public site key is embedded into generated sites. Secret
                      key stays only in Curb and the Cloudflare worker.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="turnstileSiteKey">Site Key</Label>
                    <Input
                      id="turnstileSiteKey"
                      value={settings.forms.turnstileSiteKey}
                      onChange={(e) =>
                        updateForms("turnstileSiteKey", e.target.value)
                      }
                      placeholder="0x4AAAA..."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="turnstileSecretKey">Secret Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="turnstileSecretKey"
                          type={
                            showKeys.turnstileSecretKey ? "text" : "password"
                          }
                          value={settings.forms.turnstileSecretKey}
                          onChange={(e) =>
                            updateForms("turnstileSecretKey", e.target.value)
                          }
                          placeholder="Cloudflare Turnstile secret"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleKeyVisibility("turnstileSecretKey")}
                      >
                        {showKeys.turnstileSecretKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border p-4 xl:col-span-2">
                  <div className="space-y-1">
                    <p className="font-medium">Email Delivery</p>
                    <p className="text-xs text-muted-foreground">
                      Resend is used to deliver the shared form submission to
                      the business recipient stored in each site bundle.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="resendApiKey">Resend API Key</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="resendApiKey"
                            type={showKeys.resendApiKey ? "text" : "password"}
                            value={settings.forms.resendApiKey}
                            onChange={(e) =>
                              updateForms("resendApiKey", e.target.value)
                            }
                            placeholder="re_..."
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => toggleKeyVisibility("resendApiKey")}
                        >
                          {showKeys.resendApiKey ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="resendFromEmail">From Email</Label>
                      <Input
                        id="resendFromEmail"
                        value={settings.forms.resendFromEmail}
                        onChange={(e) =>
                          updateForms("resendFromEmail", e.target.value)
                        }
                        placeholder="leads@yourdomain.com"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                Generated sites use this service for contact forms. When these
                values are empty, Curb cannot ship a production-ready contact
                pipeline.
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("forms")}
                  disabled={saving === "forms"}
                >
                  {saving === "forms" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Form Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="size-4" />
                Sales Automation
              </CardTitle>
              <CardDescription>
                Configure the public checkout return URL and the Stripe keys
                used for automated payment links and post-payment activation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="appBaseUrl">Public App Base URL</Label>
                <Input
                  id="appBaseUrl"
                  value={settings.sales.appBaseUrl}
                  onChange={(e) => updateSales("appBaseUrl", e.target.value)}
                  placeholder="https://curb.example.com"
                />
                <p className="text-xs text-muted-foreground">
                  This must be the public URL where Stripe should redirect
                  buyers after checkout. Curb uses it for the public purchase
                  status and ZIP download pages.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stripeSecretKey">Stripe Secret Key</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="stripeSecretKey"
                        type={showKeys.stripeSecretKey ? "text" : "password"}
                        value={settings.sales.stripeSecretKey}
                        onChange={(e) =>
                          updateSales("stripeSecretKey", e.target.value)
                        }
                        placeholder="sk_live_..."
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility("stripeSecretKey")}
                    >
                      {showKeys.stripeSecretKey ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stripeWebhookSecret">
                    Stripe Webhook Secret
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="stripeWebhookSecret"
                        type={showKeys.stripeWebhookSecret ? "text" : "password"}
                        value={settings.sales.stripeWebhookSecret}
                        onChange={(e) =>
                          updateSales("stripeWebhookSecret", e.target.value)
                        }
                        placeholder="whsec_..."
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility("stripeWebhookSecret")}
                    >
                      {showKeys.stripeWebhookSecret ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                Point Stripe at <code>{settings.sales.appBaseUrl || "https://your-app.example.com"}/api/stripe/webhook</code> for
                <code className="ml-1">checkout.session.completed</code>.
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => saveSection("sales")}
                  disabled={saving === "sales"}
                >
                  {saving === "sales" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Sales Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credentials" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="size-4" />
                Credentials
              </CardTitle>
              <CardDescription>
                Google Places powers discovery. Choose the AI provider Curb
                should use for audits, site generation, and outreach.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="googlePlaces">Google Places API Key</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="googlePlaces"
                      type={showKeys.googlePlaces ? "text" : "password"}
                      value={settings.credentials.googlePlaces}
                      onChange={(e) =>
                        updateCredential("googlePlaces", e.target.value)
                      }
                      placeholder="Enter your Google Places API key"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => toggleKeyVisibility("googlePlaces")}
                  >
                    {showKeys.googlePlaces ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <Label>AI Provider</Label>
                    <p className="text-xs text-muted-foreground">
                      Each provider keeps its own API key and model ID.
                      Anthropic also supports the existing OAuth flow.
                    </p>
                  </div>
                  <Badge variant="outline">{activeProviderLabel}</Badge>
                </div>

                <Tabs
                  value={settings.credentials.provider}
                  onValueChange={(value) => {
                    if (
                      value === "anthropic" ||
                      value === "openai" ||
                      value === "google" ||
                      value === "openrouter"
                    ) {
                      updateCredential("provider", value);
                    }
                  }}
                >
                  <TabsList className="h-auto flex-wrap">
                    {AI_PROVIDER_ORDER.map((provider) => (
                      <TabsTrigger key={provider} value={provider}>
                        {AI_PROVIDER_LABELS[provider]}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="anthropic" className="space-y-4 pt-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label>Anthropic Authentication</Label>
                        <p className="text-xs text-muted-foreground">
                          Use a standard API key or Anthropic&apos;s
                          Claude-account OAuth flow.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {settings.credentials.anthropicAuthMode === "oauth"
                          ? "Using OAuth"
                          : "Using API key"}
                      </Badge>
                    </div>

                    <Tabs
                      value={settings.credentials.anthropicAuthMode}
                      onValueChange={(value) => {
                        if (value === "apiKey" || value === "oauth") {
                          updateAnthropicAuthMode(value);
                        }
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value="apiKey">API Key</TabsTrigger>
                        <TabsTrigger value="oauth">Anthropic OAuth</TabsTrigger>
                      </TabsList>

                      <TabsContent value="apiKey" className="space-y-3 pt-2">
                        <div className="space-y-2">
                          <Label htmlFor="anthropicApiKey">
                            Anthropic API Key
                          </Label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                id="anthropicApiKey"
                                type={
                                  showKeys.anthropicApiKey
                                    ? "text"
                                    : "password"
                                }
                                value={settings.credentials.anthropicApiKey}
                                onChange={(e) =>
                                  updateCredential(
                                    "anthropicApiKey",
                                    e.target.value
                                  )
                                }
                                placeholder="Enter your Anthropic API key"
                              />
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                toggleKeyVisibility("anthropicApiKey")
                              }
                            >
                              {showKeys.anthropicApiKey ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="oauth" className="space-y-3 pt-2">
                        <div className="rounded-lg border bg-muted/30 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Anthropic OAuth
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Authorize in the browser, then paste the full
                                `code#state` value back here.
                              </p>
                            </div>
                            {settings.anthropicOAuth.connected ? (
                              <Badge variant="secondary">
                                <CheckCircle2 className="size-3" />
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="outline">Not connected</Badge>
                            )}
                          </div>

                          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                            {oauthExpiryLabel ? (
                              <p>Current token expires: {oauthExpiryLabel}</p>
                            ) : null}
                            {settings.anthropicOAuth.hasRefreshToken ? (
                              <p>
                                Refresh token is available for automatic
                                renewal.
                              </p>
                            ) : null}
                          </div>

                          {oauthError ? (
                            <p className="mt-3 text-xs text-destructive">
                              {oauthError}
                            </p>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2">
                            {oauthViewState === "disconnecting" ? (
                              <Button variant="outline" disabled>
                                <Loader2 className="size-4 animate-spin" />
                                Disconnecting
                              </Button>
                            ) : settings.anthropicOAuth.connected ? (
                              <Button
                                variant="outline"
                                onClick={() => void disconnectAnthropicOAuth()}
                              >
                                <Unplug className="size-4" />
                                Disconnect OAuth
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                onClick={() => void startAnthropicOAuth()}
                                disabled={
                                  oauthViewState === "waiting" ||
                                  oauthViewState === "exchanging"
                                }
                              >
                                {oauthViewState === "waiting" ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <ExternalLink className="size-4" />
                                )}
                                Connect Anthropic
                              </Button>
                            )}

                            {oauthAuthorizeUrl ? (
                              <a
                                href={oauthAuthorizeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-muted"
                              >
                                <ExternalLink className="mr-1.5 size-4" />
                                Open auth page
                              </a>
                            ) : null}
                          </div>

                          {(oauthViewState === "waiting" ||
                            oauthViewState === "exchanging") && (
                            <div className="mt-4 space-y-3 rounded-lg border border-dashed bg-background p-3">
                              <div className="space-y-1">
                                <Label htmlFor="anthropic-oauth-code">
                                  Paste the Anthropic authorization code
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Anthropic returns a single value in the format
                                  `code#state`. Paste it exactly as shown.
                                </p>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  id="anthropic-oauth-code"
                                  value={oauthCode}
                                  onChange={(e) => setOauthCode(e.target.value)}
                                  placeholder="code#state"
                                />
                                <Button
                                  onClick={() =>
                                    void exchangeAnthropicOAuth()
                                  }
                                  disabled={
                                    !oauthCode.trim() ||
                                    oauthViewState === "exchanging"
                                  }
                                >
                                  {oauthViewState === "exchanging" ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Link2 className="size-4" />
                                  )}
                                  Connect
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>

                    {renderProviderModelField(
                      "anthropic",
                      "Anthropic Model",
                      "Use a vision-capable model for screenshot audits."
                    )}
                  </TabsContent>

                  <TabsContent value="openai" className="space-y-4 pt-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label>OpenAI Authentication</Label>
                        <p className="text-xs text-muted-foreground">
                          Use a standard Platform API key or connect the same
                          OpenAI OAuth flow used in your other local tools.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {settings.credentials.openaiAuthMode === "oauth"
                          ? "Using OAuth"
                          : "Using API key"}
                      </Badge>
                    </div>

                    <Tabs
                      value={settings.credentials.openaiAuthMode}
                      onValueChange={(value) => {
                        if (value === "apiKey" || value === "oauth") {
                          updateOpenAIAuthMode(value);
                        }
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value="apiKey">API Key</TabsTrigger>
                        <TabsTrigger value="oauth">OpenAI OAuth</TabsTrigger>
                      </TabsList>

                      <TabsContent value="apiKey" className="space-y-3 pt-2">
                        <div className="space-y-2">
                          <Label htmlFor="openaiApiKey">OpenAI API Key</Label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                id="openaiApiKey"
                                type={
                                  showKeys.openaiApiKey
                                    ? "text"
                                    : "password"
                                }
                                value={settings.credentials.openaiApiKey}
                                onChange={(e) =>
                                  updateCredential(
                                    "openaiApiKey",
                                    e.target.value
                                  )
                                }
                                placeholder="Enter your OpenAI API key"
                              />
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                toggleKeyVisibility("openaiApiKey")
                              }
                            >
                              {showKeys.openaiApiKey ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Standard OpenAI Platform access for models like
                            `gpt-4.1`.
                          </p>
                        </div>
                      </TabsContent>

                      <TabsContent value="oauth" className="space-y-3 pt-2">
                        <div className="rounded-lg border bg-muted/30 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                OpenAI OAuth
                              </p>
                              <p className="text-xs text-muted-foreground">
                                This opens the OpenAI browser flow and completes
                                the callback on `localhost:1455`.
                              </p>
                            </div>
                            {settings.openaiOAuth.connected ? (
                              <Badge variant="secondary">
                                <CheckCircle2 className="size-3" />
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="outline">Not connected</Badge>
                            )}
                          </div>

                          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                            {settings.openaiOAuth.mode ===
                            "platformApiKey" ? (
                              <p>
                                OAuth produced a Platform API key, so OpenAI
                                runs on the standard API path.
                              </p>
                            ) : settings.openaiOAuth.mode ===
                              "chatgptBackend" ? (
                              <p>
                                OAuth is connected in ChatGPT/Codex backend
                                mode. Use a codex-compatible model for best
                                results.
                              </p>
                            ) : null}
                            {openAIOauthExpiryLabel ? (
                              <p>
                                Current token expires: {openAIOauthExpiryLabel}
                              </p>
                            ) : null}
                            {settings.openaiOAuth.hasRefreshToken ? (
                              <p>
                                Refresh token is available for automatic
                                renewal.
                              </p>
                            ) : null}
                            {settings.openaiOAuth.hasAccountId ? (
                              <p>ChatGPT account metadata is available.</p>
                            ) : null}
                          </div>

                          {openAIOauthError ? (
                            <p className="mt-3 text-xs text-destructive">
                              {openAIOauthError}
                            </p>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2">
                            {openAIOauthViewState === "disconnecting" ? (
                              <Button variant="outline" disabled>
                                <Loader2 className="size-4 animate-spin" />
                                Disconnecting
                              </Button>
                            ) : settings.openaiOAuth.connected ? (
                              <Button
                                variant="outline"
                                onClick={() => void disconnectOpenAIOAuth()}
                              >
                                <Unplug className="size-4" />
                                Disconnect OAuth
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                onClick={() => void startOpenAIOAuth()}
                                disabled={openAIOauthViewState === "waiting"}
                              >
                                {openAIOauthViewState === "waiting" ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <ExternalLink className="size-4" />
                                )}
                                Connect OpenAI
                              </Button>
                            )}

                            {openAIOauthAuthorizeUrl ? (
                              <a
                                href={openAIOauthAuthorizeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-muted"
                              >
                                <ExternalLink className="mr-1.5 size-4" />
                                Open auth page
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>

                    {renderProviderModelField(
                      "openai",
                      "OpenAI Model",
                      "If OpenAI OAuth falls back to ChatGPT/Codex backend mode, the list is still fetched from the connected OpenAI account."
                    )}
                  </TabsContent>

                  <TabsContent value="google" className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="googleApiKey">Google AI API Key</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="googleApiKey"
                            type={
                              showKeys.googleApiKey ? "text" : "password"
                            }
                            value={settings.credentials.googleApiKey}
                            onChange={(e) =>
                              updateCredential("googleApiKey", e.target.value)
                            }
                            placeholder="Enter your Google AI API key"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => toggleKeyVisibility("googleApiKey")}
                        >
                          {showKeys.googleApiKey ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {renderProviderModelField(
                      "google",
                      "Gemini Model",
                      "Only Gemini models that support content generation are shown."
                    )}
                  </TabsContent>

                  <TabsContent value="openrouter" className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="openrouterApiKey">
                        OpenRouter API Key
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="openrouterApiKey"
                            type={
                              showKeys.openrouterApiKey
                                ? "text"
                                : "password"
                            }
                            value={settings.credentials.openrouterApiKey}
                            onChange={(e) =>
                              updateCredential(
                                "openrouterApiKey",
                                e.target.value
                              )
                            }
                            placeholder="Enter your OpenRouter API key"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            toggleKeyVisibility("openrouterApiKey")
                          }
                        >
                          {showKeys.openrouterApiKey ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {renderProviderModelField(
                      "openrouter",
                      "OpenRouter Model",
                      "Models are fetched directly from OpenRouter for the connected account."
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("credentials")}
                  disabled={saving === "credentials"}
                >
                  {saving === "credentials" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Credentials
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="defaults" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-4" />
                Defaults
              </CardTitle>
              <CardDescription>
                Default values for discovery searches
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultLocation">Default Location</Label>
                  <Input
                    id="defaultLocation"
                    value={settings.defaults.location}
                    onChange={(e) => updateDefaults("location", e.target.value)}
                    placeholder="City, Province"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultRadius">Default Radius (km)</Label>
                  <Input
                    id="defaultRadius"
                    type="number"
                    min={1}
                    max={50}
                    value={settings.defaults.radius}
                    onChange={(e) =>
                      updateDefaults("radius", Number(e.target.value))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultCategories">Default Categories</Label>
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of category IDs from the Discover page
                </p>
                <Input
                  id="defaultCategories"
                  value={settings.defaults.categories.join(", ")}
                  onChange={(e) =>
                    updateDefaults(
                      "categories",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    )
                  }
                  placeholder="restaurants, trades, salons"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteBaseUrl">Preview Base URL</Label>
                <p className="text-xs text-muted-foreground">
                  Used when building preview links in outreach emails when no
                  deployed public preview exists yet
                </p>
                <Input
                  id="siteBaseUrl"
                  value={settings.defaults.siteBaseUrl}
                  onChange={(e) =>
                    updateDefaults("siteBaseUrl", e.target.value)
                  }
                  placeholder="http://localhost:3000/sites"
                />
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("defaults")}
                  disabled={saving === "defaults"}
                >
                  {saving === "defaults" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Defaults
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outreach" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-4" />
                Outreach Information
              </CardTitle>
              <CardDescription>
                Your contact details used in outreach emails (required for CASL
                compliance)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="yourName">Your Name</Label>
                  <Input
                    id="yourName"
                    value={settings.outreach.yourName}
                    onChange={(e) => updateOutreach("yourName", e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bizName">Business Name</Label>
                  <Input
                    id="bizName"
                    value={settings.outreach.businessName}
                    onChange={(e) =>
                      updateOutreach("businessName", e.target.value)
                    }
                    placeholder="Curb Digital"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outreachAddress">Address</Label>
                  <Input
                    id="outreachAddress"
                    value={settings.outreach.address}
                    onChange={(e) => updateOutreach("address", e.target.value)}
                    placeholder="123 Main St, Hamilton, ON"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outreachEmail">Email</Label>
                  <Input
                    id="outreachEmail"
                    type="email"
                    value={settings.outreach.email}
                    onChange={(e) => updateOutreach("email", e.target.value)}
                    placeholder="hello@curb.digital"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("outreach")}
                  disabled={saving === "outreach"}
                >
                  {saving === "outreach" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Outreach Info
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="size-4" />
                Pricing
              </CardTitle>
              <CardDescription>
                Pricing information included in outreach emails
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pricingText">Pricing Text</Label>
                <Textarea
                  id="pricingText"
                  value={settings.pricing.text}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      pricing: { text: e.target.value },
                    }))
                  }
                  placeholder="e.g., Starting at $49/month for a professionally designed website with hosting, SSL, and ongoing updates."
                  rows={4}
                />
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveSection("pricing")}
                  disabled={saving === "pricing"}
                >
                  {saving === "pricing" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save Pricing
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
