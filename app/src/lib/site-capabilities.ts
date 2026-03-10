import path from "path";

import type { WebsiteSourceSnapshot } from "./website-source";
import type { WebsitePageSignals } from "./website-screenshot";

export type SiteCapabilityNeed =
  | "none"
  | "optional"
  | "recommended"
  | "required";

export type SiteCapabilityConfidence = "low" | "medium" | "high";

export type SiteOperatingModel =
  | "static-only"
  | "static-plus-cms"
  | "static-plus-cms-and-store"
  | "custom-app";

export type CmsProviderRecommendation = "none" | "firebase-auth-firestore";
export type StoreCommerceProvider = "stripe-payment-links" | "shopify";
export type CommerceProviderRecommendation =
  | "none"
  | StoreCommerceProvider
  | "snipcart";
export type CommerceProductStrategy =
  | "none"
  | "payment-links"
  | "snipcart-cart";

export interface SiteCapabilityProfile {
  profileVersion: 1;
  operatingModel: SiteOperatingModel;
  confidence: SiteCapabilityConfidence;
  cms: {
    need: SiteCapabilityNeed;
    provider: CmsProviderRecommendation;
    editableAreas: string[];
  };
  commerce: {
    need: SiteCapabilityNeed;
    provider: CommerceProviderRecommendation;
    productStrategy: CommerceProductStrategy;
  };
  reasons: string[];
  packageSummary: string;
}

export interface SiteCapabilityInferenceContext {
  category?: string | null;
  advancedFeatures?: string[];
  sourceSiteSnapshot?: WebsiteSourceSnapshot | null;
  sourceSiteVisualSignals?: WebsitePageSignals[];
}

export interface SiteCapabilityPackOverride {
  includeCmsPack?: boolean;
  includeStorePack?: boolean;
  commerceProvider?: StoreCommerceProvider;
}

export const SITE_CAPABILITY_MANIFEST_PATH = "assets/curb-site-package.json";

const CMS_FREQUENT_UPDATE_PAGE_HINTS = new Set([
  "blog",
  "event",
  "events",
  "menu",
  "news",
  "product",
  "products",
  "resource",
  "resources",
  "seasonal",
  "shop",
  "special",
  "specials",
]);

const CMS_HEAVY_CATEGORY_KEYWORDS = [
  "bakery",
  "bar",
  "brewery",
  "cafe",
  "church",
  "community",
  "event",
  "museum",
  "pub",
  "restaurant",
  "school",
  "venue",
];

const COMMERCE_CATEGORY_KEYWORDS = [
  "apparel",
  "bookstore",
  "boutique",
  "clothing",
  "furniture",
  "gift",
  "jewelry",
  "market",
  "pet store",
  "retail",
  "shop",
  "store",
];

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
}

function normalizeCategory(category: string | null | undefined): string {
  return String(category ?? "").trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function localPathToSlug(localPath: string): string {
  if (localPath === "index.html") {
    return "";
  }

  return localPath
    .replace(/\/index\.html$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function normalizeNeed(value: unknown): SiteCapabilityNeed | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "optional" ||
    normalized === "recommended" ||
    normalized === "required"
  ) {
    return normalized;
  }

  if (normalized === "yes") {
    return "recommended";
  }

  return null;
}

function normalizeConfidence(value: unknown): SiteCapabilityConfidence | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }

  return null;
}

function normalizeOperatingModel(value: unknown): SiteOperatingModel | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "static-only" ||
    normalized === "static-plus-cms" ||
    normalized === "static-plus-cms-and-store" ||
    normalized === "custom-app"
  ) {
    return normalized;
  }

  if (
    normalized === "static+cms" ||
    normalized === "static-plus-admin" ||
    normalized === "static with cms"
  ) {
    return "static-plus-cms";
  }

  if (
    normalized === "static+cms+store" ||
    normalized === "static-plus-store" ||
    normalized === "static-plus-admin-and-store" ||
    normalized === "static with cms and store"
  ) {
    return "static-plus-cms-and-store";
  }

  if (
    normalized === "app" ||
    normalized === "custom" ||
    normalized === "custom application"
  ) {
    return "custom-app";
  }

  return null;
}

function normalizeCmsProvider(
  value: unknown
): CmsProviderRecommendation | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "none" || !normalized) {
    return "none";
  }

  if (
    normalized === "supabase" ||
    normalized === "supabase-magic-link" ||
    normalized === "supabase magic link" ||
    normalized === "firebase" ||
    normalized === "firebase-auth-firestore" ||
    normalized === "firebase auth firestore" ||
    normalized === "firecms"
  ) {
    return "firebase-auth-firestore";
  }

  return null;
}

function normalizeCommerceProvider(
  value: unknown
): CommerceProviderRecommendation | null {
  const managedProvider = normalizeManagedCommerceProvider(value);
  if (managedProvider) {
    return managedProvider;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "none" || !normalized) {
    return "none";
  }

  if (normalized === "snipcart") {
    return "snipcart";
  }

  return null;
}

export function normalizeManagedCommerceProvider(
  value: unknown
): StoreCommerceProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "stripe" ||
    normalized === "stripe-payment-links" ||
    normalized === "stripe payment links" ||
    normalized === "payment-links"
  ) {
    return "stripe-payment-links";
  }

  if (
    normalized === "shopify" ||
    normalized === "shopify-buy-button" ||
    normalized === "shopify buy button" ||
    normalized === "shopify-checkout-links" ||
    normalized === "shopify checkout links"
  ) {
    return "shopify";
  }

  return null;
}

export function resolveStoreCommerceProvider(
  value: CommerceProviderRecommendation | null | undefined
): StoreCommerceProvider {
  return value === "shopify" ? "shopify" : "stripe-payment-links";
}

function normalizeProductStrategy(
  value: unknown
): CommerceProductStrategy | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "payment-links" ||
    normalized === "snipcart-cart"
  ) {
    return normalized;
  }

  if (
    normalized === "stripe" ||
    normalized === "stripe payment links" ||
    normalized === "payment links"
  ) {
    return "payment-links";
  }

  if (
    normalized === "snipcart" ||
    normalized === "snipcart cart"
  ) {
    return "snipcart-cart";
  }

  return null;
}

function withNeedStrength(
  current: SiteCapabilityNeed,
  next: SiteCapabilityNeed
): SiteCapabilityNeed {
  const order: SiteCapabilityNeed[] = [
    "none",
    "optional",
    "recommended",
    "required",
  ];

  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

function buildPackageSummary(profile: SiteCapabilityProfile): string {
  if (profile.operatingModel === "custom-app") {
    return [
      "Do not force this business into the lightweight static pack.",
      "Keep the brochure marketing pages static, but plan a separate application or specialist integration for the advanced customer flow.",
    ].join(" ");
  }

  if (profile.operatingModel === "static-plus-cms-and-store") {
    const commerceProvider = resolveStoreCommerceProvider(
      profile.commerce.provider
    );
    return [
      "Keep the public site static for speed and handoff simplicity.",
      `Package the Firebase owner admin for content and product updates, and use ${
        commerceProvider === "shopify"
          ? "Shopify checkout links"
          : "Stripe Payment Links"
      } for lightweight checkout.`,
    ].join(" ");
  }

  if (profile.operatingModel === "static-plus-cms") {
    return [
      "Keep the public site static.",
      "Package the Firebase owner admin only for content updates instead of turning the whole site into an app.",
    ].join(" ");
  }

  return [
    "Keep the generated site fully static.",
    "Do not attach a login CMS or store pack unless a human explicitly asks for it later.",
  ].join(" ");
}

function buildEditableAreas(
  pageSlugs: string[],
  wantsCms: boolean,
  wantsStore: boolean
): string[] {
  if (!wantsCms && !wantsStore) {
    return [];
  }

  const areas = new Set<string>(["homepage", "contact"]);

  if (
    pageSlugs.some((slug) =>
      ["about", "services", "service"].includes(path.posix.basename(slug))
    )
  ) {
    areas.add("services");
  }

  if (
    pageSlugs.some((slug) =>
      CMS_FREQUENT_UPDATE_PAGE_HINTS.has(path.posix.basename(slug))
    )
  ) {
    areas.add("supporting-pages");
  }

  if (pageSlugs.some((slug) => slug.includes("menu"))) {
    areas.add("menu");
  }

  if (wantsStore) {
    areas.add("products");
  }

  return Array.from(areas);
}

function buildDefaultEditableAreasForPack(
  wantsCms: boolean,
  wantsStore: boolean,
  existingAreas: string[]
): string[] {
  if (!wantsCms && !wantsStore) {
    return [];
  }

  const areas = new Set<string>(existingAreas.filter(Boolean));
  if (areas.size === 0) {
    areas.add("homepage");
    areas.add("contact");
  }

  if (wantsStore) {
    areas.add("products");
  }

  return Array.from(areas);
}

export function inferSiteCapabilityProfile(
  context: SiteCapabilityInferenceContext = {}
): SiteCapabilityProfile {
  const category = normalizeCategory(context.category);
  const sourcePages = context.sourceSiteSnapshot?.pages ?? [];
  const pageSlugs = dedupeStrings(
    sourcePages.map((page) => localPathToSlug(page.localPath))
  );
  const detectedFeatures = new Set<string>(
    dedupeStrings([
      ...(context.advancedFeatures ?? []),
      ...sourcePages.flatMap((page) => page.detectedFeatures),
      ...(context.sourceSiteVisualSignals ?? []).flatMap(
        (signals) => signals.detectedFeatures
      ),
    ]).map((feature) => feature.toLowerCase())
  );
  const sourcePageEstimate = Math.max(
    context.sourceSiteSnapshot?.estimatedPageCount ??
      context.sourceSiteSnapshot?.pageCount ??
      0,
    sourcePages.length
  );
  const maxNavLinkCount = Math.max(
    0,
    ...sourcePages.map((page) => page.navLinks.length),
    ...(context.sourceSiteVisualSignals ?? []).map(
      (signals) => signals.navLinkCount
    )
  );
  const hasPortal = detectedFeatures.has("customer portal");
  const hasStore = detectedFeatures.has("online store");
  const hasCmsHeavyCategory = includesAny(category, CMS_HEAVY_CATEGORY_KEYWORDS);
  const hasCommerceCategory = includesAny(category, COMMERCE_CATEGORY_KEYWORDS);
  const hasFrequentUpdatePages = pageSlugs.some((slug) =>
    CMS_FREQUENT_UPDATE_PAGE_HINTS.has(path.posix.basename(slug))
  );

  const reasons: string[] = [];
  let cmsNeed: SiteCapabilityNeed = "none";
  let commerceNeed: SiteCapabilityNeed = "none";
  let operatingModel: SiteOperatingModel = "static-only";
  let confidence: SiteCapabilityConfidence = "medium";

  if (hasPortal) {
    reasons.push(
      "A customer portal or authenticated member flow was detected, which exceeds the lightweight static-pack pattern."
    );
    operatingModel = "custom-app";
    confidence = "high";
  }

  if (hasStore) {
    commerceNeed = "required";
    reasons.push(
      "The current site appears to sell products online, so the replacement should keep a lightweight commerce layer."
    );
  } else if (hasCommerceCategory && pageSlugs.some((slug) => /shop|product/i.test(slug))) {
    commerceNeed = "recommended";
    reasons.push(
      "The business category and page structure suggest a product catalog that benefits from lightweight commerce packaging."
    );
  } else if (hasCommerceCategory) {
    commerceNeed = "optional";
    reasons.push(
      "The business looks retail-oriented, so a simple store pack could be useful later, but it should not be forced into every draft."
    );
  }

  if (commerceNeed === "required") {
    cmsNeed = "required";
    reasons.push(
      "If products need to be updated by the owner, the commerce pack should ship with the same lightweight admin layer."
    );
  }

  if (hasFrequentUpdatePages) {
    cmsNeed = withNeedStrength(cmsNeed, "recommended");
    reasons.push(
      "The source site has pages that usually change over time, such as menus, events, news, specials, or product collections."
    );
  }

  if (sourcePageEstimate >= 6 || maxNavLinkCount >= 8) {
    cmsNeed = withNeedStrength(cmsNeed, "recommended");
    reasons.push(
      "The site has enough page-level complexity that a lightweight owner admin is safer than hard-coding every future edit."
    );
  }

  if (hasCmsHeavyCategory) {
    cmsNeed = withNeedStrength(cmsNeed, "optional");
    reasons.push(
      "This category often needs small ongoing content edits, even when the public experience should remain static."
    );
  }

  if (operatingModel !== "custom-app" && hasStore && sourcePageEstimate >= 12) {
    operatingModel = "custom-app";
    confidence = "high";
    reasons.push(
      "The store looks too content-heavy for a minimal payment-link pack and likely needs a more bespoke application layer."
    );
  }

  if (
    operatingModel !== "custom-app" &&
    (commerceNeed === "required" || commerceNeed === "recommended")
  ) {
    operatingModel = "static-plus-cms-and-store";
    confidence = commerceNeed === "required" ? "high" : "medium";
  } else if (
    operatingModel !== "custom-app" &&
    (cmsNeed === "recommended" || cmsNeed === "required")
  ) {
    operatingModel = "static-plus-cms";
  }

  if (
    operatingModel === "static-only" &&
    commerceNeed === "recommended" &&
    cmsNeed === "none"
  ) {
    cmsNeed = "optional";
  }

  const profile: SiteCapabilityProfile = {
    profileVersion: 1,
    operatingModel,
    confidence,
    cms: {
      need: operatingModel === "custom-app" ? "none" : cmsNeed,
      provider:
        operatingModel === "static-plus-cms" ||
        operatingModel === "static-plus-cms-and-store"
          ? "firebase-auth-firestore"
          : "none",
      editableAreas: buildEditableAreas(
        pageSlugs,
        operatingModel === "static-plus-cms" ||
          operatingModel === "static-plus-cms-and-store",
        operatingModel === "static-plus-cms-and-store"
      ),
    },
    commerce: {
      need:
        operatingModel === "custom-app"
          ? "none"
          : operatingModel === "static-plus-cms-and-store"
            ? commerceNeed === "none"
              ? "recommended"
              : commerceNeed
            : commerceNeed,
      provider:
        operatingModel === "static-plus-cms-and-store"
          ? "stripe-payment-links"
          : "none",
      productStrategy:
        operatingModel === "static-plus-cms-and-store"
          ? "payment-links"
          : "none",
    },
    reasons: dedupeStrings(reasons).slice(0, 5),
    packageSummary: "",
  };

  profile.packageSummary = buildPackageSummary(profile);
  return profile;
}

export function normalizeSiteCapabilityProfile(
  value: unknown,
  context: SiteCapabilityInferenceContext = {}
): SiteCapabilityProfile {
  const fallback = inferSiteCapabilityProfile(context);
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const source = raw as Record<string, unknown>;
  const cmsSource =
    source.cms && typeof source.cms === "object"
      ? (source.cms as Record<string, unknown>)
      : null;
  const commerceSource =
    source.commerce && typeof source.commerce === "object"
      ? (source.commerce as Record<string, unknown>)
      : null;

  const candidate: SiteCapabilityProfile = {
    profileVersion: 1,
    operatingModel:
      normalizeOperatingModel(source.operatingModel) ?? fallback.operatingModel,
    confidence:
      normalizeConfidence(source.confidence) ?? fallback.confidence,
    cms: {
      need: normalizeNeed(cmsSource?.need) ?? fallback.cms.need,
      provider:
        normalizeCmsProvider(cmsSource?.provider) ?? fallback.cms.provider,
      editableAreas: dedupeStrings(
        Array.isArray(cmsSource?.editableAreas)
          ? cmsSource?.editableAreas.map((value) => String(value))
          : fallback.cms.editableAreas
      ),
    },
    commerce: {
      need: normalizeNeed(commerceSource?.need) ?? fallback.commerce.need,
      provider:
        normalizeCommerceProvider(commerceSource?.provider) ??
        fallback.commerce.provider,
      productStrategy:
        normalizeProductStrategy(commerceSource?.productStrategy) ??
        fallback.commerce.productStrategy,
    },
    reasons: dedupeStrings(
      Array.isArray(source.reasons)
        ? source.reasons.map((reason) => String(reason))
        : fallback.reasons
    ).slice(0, 5),
    packageSummary: "",
  };

  if (fallback.operatingModel === "custom-app") {
    candidate.operatingModel = "custom-app";
    candidate.cms = fallback.cms;
    candidate.commerce = fallback.commerce;
    candidate.confidence = "high";
  }

  if (
    fallback.commerce.need === "required" &&
    ["none", "optional"].includes(candidate.commerce.need)
  ) {
    candidate.operatingModel = fallback.operatingModel;
    candidate.commerce = fallback.commerce;
    candidate.cms = fallback.cms;
  }

  if (
    fallback.cms.need === "required" &&
    candidate.cms.need === "none"
  ) {
    candidate.cms = fallback.cms;
  }

  if (
    candidate.operatingModel === "static-plus-cms" &&
    candidate.cms.provider === "none"
  ) {
    candidate.cms.provider = "firebase-auth-firestore";
  }

  if (
    candidate.operatingModel === "static-plus-cms-and-store" &&
    candidate.cms.provider === "none"
  ) {
    candidate.cms.provider = "firebase-auth-firestore";
  }

  if (
    candidate.operatingModel === "static-plus-cms-and-store" &&
    candidate.commerce.provider === "none"
  ) {
    candidate.commerce.provider = "stripe-payment-links";
  }

  if (
    candidate.operatingModel === "static-only" &&
    (candidate.cms.need === "recommended" || candidate.cms.need === "required")
  ) {
    candidate.operatingModel = "static-plus-cms";
  }

  if (
    candidate.operatingModel === "static-plus-cms" &&
    candidate.commerce.need === "required"
  ) {
    candidate.operatingModel = "static-plus-cms-and-store";
  }

  if (candidate.reasons.length === 0) {
    candidate.reasons = fallback.reasons;
  } else {
    candidate.reasons = dedupeStrings([
      ...candidate.reasons,
      ...fallback.reasons.slice(0, 2),
    ]).slice(0, 5);
  }

  candidate.packageSummary = buildPackageSummary(candidate);
  return candidate;
}

export function applySiteCapabilityPackOverride(
  profile: SiteCapabilityProfile,
  override?: SiteCapabilityPackOverride | null
): SiteCapabilityProfile {
  if (!override) {
    return profile;
  }

  const includeStore =
    override.includeStorePack ?? includeStorePack(profile);
  const includeCms =
    includeStore || (override.includeCmsPack ?? includeCmsPack(profile));

  const nextProfile: SiteCapabilityProfile = {
    ...profile,
    cms: {
      ...profile.cms,
    },
    commerce: {
      ...profile.commerce,
    },
    reasons: [...profile.reasons],
  };

  if (!includeCms && !includeStore) {
    nextProfile.operatingModel = "static-only";
    nextProfile.cms = {
      need: "none",
      provider: "none",
      editableAreas: [],
    };
    nextProfile.commerce = {
      need: "none",
      provider: "none",
      productStrategy: "none",
    };
  } else if (includeCms && !includeStore) {
    nextProfile.operatingModel = "static-plus-cms";
    nextProfile.cms = {
      need: profile.cms.need === "none" ? "recommended" : profile.cms.need,
      provider: "firebase-auth-firestore",
      editableAreas: buildDefaultEditableAreasForPack(
        true,
        false,
        profile.cms.editableAreas
      ),
    };
    nextProfile.commerce = {
      need: "none",
      provider: "none",
      productStrategy: "none",
    };
  } else {
    const commerceProvider = resolveStoreCommerceProvider(
      override.commerceProvider ?? profile.commerce.provider
    );
    nextProfile.operatingModel = "static-plus-cms-and-store";
    nextProfile.cms = {
      need: profile.cms.need === "none" ? "recommended" : profile.cms.need,
      provider: "firebase-auth-firestore",
      editableAreas: buildDefaultEditableAreasForPack(
        true,
        true,
        profile.cms.editableAreas
      ),
    };
    nextProfile.commerce = {
      need:
        profile.commerce.need === "none" ? "recommended" : profile.commerce.need,
      provider: commerceProvider,
      productStrategy: "payment-links",
    };
  }

  const overrideReasons: string[] = [];
  if (
    override.includeCmsPack !== undefined &&
    override.includeCmsPack !== includeCmsPack(profile)
  ) {
    overrideReasons.push(
      override.includeCmsPack
        ? "A Curb operator manually enabled the lightweight owner CMS pack for this generation run."
        : "A Curb operator manually disabled the lightweight owner CMS pack for this generation run."
    );
  }
  if (
    override.includeStorePack !== undefined &&
    override.includeStorePack !== includeStorePack(profile)
  ) {
    overrideReasons.push(
      override.includeStorePack
        ? "A Curb operator manually enabled the lightweight store pack for this generation run."
        : "A Curb operator manually disabled the lightweight store pack for this generation run."
    );
  }
  if (
    includeStore &&
    override.commerceProvider &&
    override.commerceProvider !==
      resolveStoreCommerceProvider(profile.commerce.provider)
  ) {
    overrideReasons.push(
      `A Curb operator selected ${override.commerceProvider === "shopify" ? "Shopify" : "Stripe"} as the lightweight store checkout provider for this generation run.`
    );
  }

  nextProfile.reasons = dedupeStrings([
    ...overrideReasons,
    ...nextProfile.reasons,
  ]).slice(0, 5);
  nextProfile.packageSummary = buildPackageSummary(nextProfile);
  return nextProfile;
}

export function buildSiteCapabilityPromptSummary(
  profile: SiteCapabilityProfile
): string {
  return [
    "Capability Recommendation:",
    `Operating model: ${profile.operatingModel}`,
    `Confidence: ${profile.confidence}`,
    `CMS need: ${profile.cms.need}`,
    `CMS provider: ${profile.cms.provider}`,
    `Editable areas: ${
      profile.cms.editableAreas.length > 0
        ? profile.cms.editableAreas.join(", ")
        : "none"
    }`,
    `Commerce need: ${profile.commerce.need}`,
    `Commerce provider: ${profile.commerce.provider}`,
    `Commerce strategy: ${profile.commerce.productStrategy}`,
    ...profile.reasons.map((reason) => `- ${reason}`),
    `Packaging guidance: ${profile.packageSummary}`,
  ].join("\n");
}

export function buildSiteCapabilityManifest(
  businessName: string,
  profile: SiteCapabilityProfile
): string {
  return `${JSON.stringify(
    {
      businessName,
      capabilityProfile: profile,
    },
    null,
    2
  )}\n`;
}

export function includeCmsPack(profile: SiteCapabilityProfile): boolean {
  return (
    profile.operatingModel === "static-plus-cms" ||
    profile.operatingModel === "static-plus-cms-and-store"
  );
}

export function includeStorePack(profile: SiteCapabilityProfile): boolean {
  return profile.operatingModel === "static-plus-cms-and-store";
}
