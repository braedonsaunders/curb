import { getConfig, type Config } from "@/lib/config";
import {
  includeBookingPack,
  includeCmsPack,
  includeMembershipPack,
  includeStorePack,
  type SiteCapabilityProfile,
} from "@/lib/site-capabilities";

export type ProviderActivationStatus =
  | "not-started"
  | "in-progress"
  | "configured"
  | "live"
  | "not-needed";

export type ProviderActivationOwner = "curb" | "client" | "shared";

export type ProviderActivationEntry = {
  provider: string;
  status: ProviderActivationStatus;
  owner: ProviderActivationOwner;
  accountLabel: string;
  dashboardUrl: string;
  notes: string;
  lastUpdatedAt: string | null;
};

export type FormsActivationEntry = ProviderActivationEntry & {
  endpointUrl: string;
  publicSiteKey: string;
};

export type ProviderActivationState = {
  booking: ProviderActivationEntry;
  cms: ProviderActivationEntry;
  commerce: ProviderActivationEntry;
  forms: FormsActivationEntry;
  hosting: ProviderActivationEntry;
  memberships: ProviderActivationEntry;
};

type ProviderActivationKey = keyof ProviderActivationState;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown): ProviderActivationStatus {
  const normalized = text(value).toLowerCase();

  if (
    normalized === "in-progress" ||
    normalized === "configured" ||
    normalized === "live" ||
    normalized === "not-needed"
  ) {
    return normalized;
  }

  return "not-started";
}

function normalizeOwner(value: unknown): ProviderActivationOwner {
  const normalized = text(value).toLowerCase();

  if (normalized === "client" || normalized === "shared") {
    return normalized;
  }

  return "curb";
}

function buildEntry(
  provider: string,
  status: ProviderActivationStatus
): ProviderActivationEntry {
  return {
    provider,
    status,
    owner: "curb",
    accountLabel: "",
    dashboardUrl: "",
    notes: "",
    lastUpdatedAt: null,
  };
}

function buildProviderLabel(
  category: ProviderActivationKey,
  profile: SiteCapabilityProfile | null
): string {
  if (category === "hosting") {
    return "Cloudflare Pages";
  }

  if (category === "forms") {
    return "Shared Cloudflare Form Service";
  }

  if (category === "cms") {
    if (!profile || !includeCmsPack(profile)) {
      return "Not needed";
    }

    return profile.cms.provider === "sanity" ? "Sanity" : "Storyblok";
  }

  if (category === "commerce") {
    return profile && includeStorePack(profile) ? "Shopify" : "Not needed";
  }

  if (category === "booking") {
    if (!profile || !includeBookingPack(profile)) {
      return "Not needed";
    }

    return profile.booking.provider === "cal-com"
      ? "Cal.com"
      : "Square Appointments";
  }

  if (!profile || !includeMembershipPack(profile)) {
    return "Not needed";
  }

  return profile.memberships.provider === "clerk" ? "Clerk" : "Memberstack";
}

function buildDefaultProviderActivationState(
  profile: SiteCapabilityProfile | null,
  config: Config
): ProviderActivationState {
  const formsConfigured =
    text(config.sharedFormEndpointUrl) &&
    text(config.sharedFormSigningSecret) &&
    text(config.resendApiKey) &&
    text(config.resendFromEmail);

  return {
    hosting: buildEntry("Cloudflare Pages", "not-started"),
    forms: {
      ...buildEntry(
        "Shared Cloudflare Form Service",
        formsConfigured ? "configured" : "not-started"
      ),
      endpointUrl: text(config.sharedFormEndpointUrl),
      publicSiteKey: text(config.turnstileSiteKey),
    },
    cms: buildEntry(
      buildProviderLabel("cms", profile),
      profile && includeCmsPack(profile) ? "not-started" : "not-needed"
    ),
    commerce: buildEntry(
      buildProviderLabel("commerce", profile),
      profile && includeStorePack(profile) ? "not-started" : "not-needed"
    ),
    booking: buildEntry(
      buildProviderLabel("booking", profile),
      profile && includeBookingPack(profile) ? "not-started" : "not-needed"
    ),
    memberships: buildEntry(
      buildProviderLabel("memberships", profile),
      profile && includeMembershipPack(profile) ? "not-started" : "not-needed"
    ),
  };
}

function normalizeEntry(
  value: unknown,
  fallback: ProviderActivationEntry
): ProviderActivationEntry {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const source = value as Record<string, unknown>;

  return {
    provider: text(source.provider) || fallback.provider,
    status:
      fallback.status === "not-needed" &&
      normalizeStatus(source.status) === "not-started"
        ? "not-needed"
        : normalizeStatus(source.status),
    owner: normalizeOwner(source.owner),
    accountLabel: text(source.accountLabel).slice(0, 200),
    dashboardUrl: text(source.dashboardUrl).slice(0, 500),
    notes: text(source.notes).slice(0, 4000),
    lastUpdatedAt: text(source.lastUpdatedAt) || null,
  };
}

function normalizeFormsEntry(
  value: unknown,
  fallback: FormsActivationEntry
): FormsActivationEntry {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  const normalized = normalizeEntry(source, fallback);

  return {
    ...normalized,
    endpointUrl: text(source.endpointUrl) || fallback.endpointUrl,
    publicSiteKey: text(source.publicSiteKey) || fallback.publicSiteKey,
  };
}

export function normalizeProviderActivationState(
  value: unknown,
  profile: SiteCapabilityProfile | null,
  config = getConfig()
): ProviderActivationState {
  const defaults = buildDefaultProviderActivationState(profile, config);
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : (() => {
          try {
            const parsed = JSON.parse(text(value));
            return parsed && typeof parsed === "object"
              ? (parsed as Record<string, unknown>)
              : {};
          } catch {
            return {};
          }
        })();

  return {
    hosting: normalizeEntry(source.hosting, defaults.hosting),
    forms: normalizeFormsEntry(source.forms, defaults.forms),
    cms: normalizeEntry(source.cms, defaults.cms),
    commerce: normalizeEntry(source.commerce, defaults.commerce),
    booking: normalizeEntry(source.booking, defaults.booking),
    memberships: normalizeEntry(source.memberships, defaults.memberships),
  };
}

export function serializeProviderActivationState(
  value: ProviderActivationState
): string {
  return JSON.stringify(value);
}

