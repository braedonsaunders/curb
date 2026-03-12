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
  | "static-plus-packs"
  | "custom-app";

export type CmsProviderRecommendation = "none" | "storyblok" | "sanity";
export type StoreCommerceProvider = "shopify";
export type CommerceProviderRecommendation = "none" | StoreCommerceProvider;
export type CommerceProductStrategy =
  | "none"
  | "buy-button"
  | "storefront-api";
export type BookingProviderRecommendation =
  | "none"
  | "square-appointments"
  | "cal-com";
export type MembershipProviderRecommendation =
  | "none"
  | "memberstack"
  | "clerk";

export interface SiteCapabilityProfile {
  profileVersion: 2;
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
  booking: {
    need: SiteCapabilityNeed;
    provider: BookingProviderRecommendation;
  };
  memberships: {
    need: SiteCapabilityNeed;
    provider: MembershipProviderRecommendation;
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
  "faq",
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
  "team",
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

const BOOKING_CATEGORY_KEYWORDS = [
  "barber",
  "beauty",
  "chiropractor",
  "clinic",
  "coach",
  "consultant",
  "dental",
  "dentist",
  "fitness",
  "gym",
  "hair",
  "massage",
  "medical",
  "nail",
  "physio",
  "pilates",
  "salon",
  "spa",
  "therapy",
  "trainer",
  "wellness",
  "yoga",
];

const MEMBERSHIP_PAGE_HINTS = [
  "account",
  "community",
  "dashboard",
  "login",
  "member",
  "members",
  "portal",
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
    normalized === "static-plus-packs" ||
    normalized === "custom-app"
  ) {
    return normalized;
  }

  if (
    normalized === "static-plus-cms" ||
    normalized === "static-plus-cms-and-store" ||
    normalized === "static+cms" ||
    normalized === "static+cms+store" ||
    normalized === "static-plus-store" ||
    normalized === "static-plus-admin" ||
    normalized === "static-plus-admin-and-store" ||
    normalized === "static with cms" ||
    normalized === "static with cms and store"
  ) {
    return "static-plus-packs";
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

  if (normalized === "storyblok") {
    return "sanity";
  }

  if (normalized === "sanity") {
    return "sanity";
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
    return "sanity";
  }

  return null;
}

export function normalizeManagedCommerceProvider(
  value: unknown
): StoreCommerceProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "shopify" ||
    normalized === "shopify-buy-button" ||
    normalized === "shopify buy button" ||
    normalized === "shopify-checkout-links" ||
    normalized === "shopify checkout links" ||
    normalized === "stripe" ||
    normalized === "stripe-payment-links" ||
    normalized === "stripe payment links" ||
    normalized === "payment-links" ||
    normalized === "snipcart"
  ) {
    return "shopify";
  }

  return null;
}

export function resolveStoreCommerceProvider(
  value: CommerceProviderRecommendation | null | undefined
): StoreCommerceProvider {
  void value;
  return "shopify";
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

function buildEditableAreas(pageSlugs: string[], wantsCms: boolean): string[] {
  if (!wantsCms) {
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

  return Array.from(areas);
}

function buildDefaultEditableAreasForPack(
  wantsCms: boolean,
  existingAreas: string[]
): string[] {
  if (!wantsCms) {
    return [];
  }

  const areas = new Set<string>(existingAreas.filter(Boolean));
  if (areas.size === 0) {
    areas.add("homepage");
    areas.add("contact");
  }

  return Array.from(areas);
}

function selectCmsProvider(
  pageSlugs: string[],
  sourcePageEstimate: number
): CmsProviderRecommendation {
  void pageSlugs;
  void sourcePageEstimate;
  return "sanity";
}

function hasMembershipPageSignal(pageSlugs: string[]): boolean {
  return pageSlugs.some((slug) =>
    MEMBERSHIP_PAGE_HINTS.some((token) => slug.includes(token))
  );
}

function buildPackageSummary(profile: SiteCapabilityProfile): string {
  if (profile.operatingModel === "custom-app") {
    return [
      "Keep the public marketing site static on Cloudflare Pages.",
      "Use the shared Cloudflare form endpoint and Stripe for lead capture and payments.",
      "Do not fake storefronts, booking flows, dashboards, portals, or member areas inside the brochure bundle.",
      "Treat advanced workflows as custom managed add-ons instead of standard Curb packs.",
    ].join(" ");
  }

  if (profile.operatingModel === "static-only") {
    return [
      "Keep the generated site fully static on Cloudflare Pages.",
      "Use the shared Cloudflare form endpoint and Stripe sales flow only when needed.",
      "Do not attach a fake admin, login, cart, booking flow, or dashboard inside the site bundle.",
    ].join(" ");
  }

  const packLines = [
    "Keep the public site static on Cloudflare Pages.",
    "Use the shared Cloudflare form endpoint and Stripe for the default operating model.",
  ];

  if (includeCmsPack(profile)) {
    packLines.push(
      "Use Sanity as the only standard external content admin instead of an in-site /admin portal."
    );
  }

  packLines.push(
    "Treat store, booking, and membership requests as custom managed upsells, not default provider packs."
  );

  return packLines.join(" ");
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

  const hasPortal =
    detectedFeatures.has("customer portal") ||
    detectedFeatures.has("member portal") ||
    hasMembershipPageSignal(pageSlugs);
  const hasStore =
    detectedFeatures.has("online store") ||
    pageSlugs.some((slug) => /shop|product|products|catalog|collection/.test(slug));
  const hasBooking =
    detectedFeatures.has("appointment booking") ||
    pageSlugs.some((slug) => /book|booking|appointment|schedule/.test(slug));
  const hasCmsHeavyCategory = includesAny(category, CMS_HEAVY_CATEGORY_KEYWORDS);
  const hasCommerceCategory = includesAny(category, COMMERCE_CATEGORY_KEYWORDS);
  const hasBookingCategory = includesAny(category, BOOKING_CATEGORY_KEYWORDS);
  const hasFrequentUpdatePages = pageSlugs.some((slug) =>
    CMS_FREQUENT_UPDATE_PAGE_HINTS.has(path.posix.basename(slug))
  );

  const reasons: string[] = [];
  let cmsNeed: SiteCapabilityNeed = "none";
  let commerceNeed: SiteCapabilityNeed = "none";
  let bookingNeed: SiteCapabilityNeed = "none";
  let membershipsNeed: SiteCapabilityNeed = "none";
  let operatingModel: SiteOperatingModel = "static-only";
  let confidence: SiteCapabilityConfidence = "medium";

  if (hasPortal) {
    membershipsNeed = "required";
    operatingModel = "custom-app";
    confidence = "high";
    reasons.push(
      "A customer portal, member area, or account-oriented flow was detected, so this should not be faked inside a static brochure bundle."
    );
  }

  if (hasStore) {
    commerceNeed = "required";
    operatingModel = "custom-app";
    confidence = "high";
    reasons.push(
      "The current site appears to sell products online, so ecommerce should be scoped as a custom managed add-on instead of a default pack."
    );
  } else if (hasCommerceCategory) {
    commerceNeed = sourcePageEstimate >= 4 ? "optional" : "none";
    reasons.push(
      "The business looks retail-oriented, but the default Curb stack stays brochure-first unless a custom commerce upsell is explicitly sold."
    );
  }

  if (hasBooking) {
    bookingNeed = "required";
    operatingModel = "custom-app";
    confidence = "high";
    reasons.push(
      "The current site already signals booking behavior, so scheduling should be handled as a custom managed workflow instead of a default pack."
    );
  } else if (hasBookingCategory) {
    bookingNeed = "optional";
    reasons.push(
      "This service category may justify a managed booking upsell later, but booking is not part of the default stack."
    );
  }

  if (hasFrequentUpdatePages) {
    cmsNeed = withNeedStrength(cmsNeed, "recommended");
    reasons.push(
      "The source site has pages that usually change over time, such as menus, events, news, specials, or collections."
    );
  }

  if (sourcePageEstimate >= 6 || maxNavLinkCount >= 8) {
    cmsNeed = withNeedStrength(cmsNeed, "recommended");
    reasons.push(
      "The site has enough page-level complexity that a real external CMS is safer than hard-coded future edits."
    );
  }

  if (hasCmsHeavyCategory) {
    cmsNeed = withNeedStrength(cmsNeed, "optional");
    reasons.push(
      "This category often needs ongoing owner edits, even when the public experience should remain static."
    );
  }

  if (operatingModel !== "custom-app" && cmsNeed !== "none") {
    operatingModel = "static-plus-packs";
  }

  if (operatingModel !== "custom-app" && cmsNeed === "required") {
    confidence = "high";
  }

  const profile: SiteCapabilityProfile = {
    profileVersion: 2,
    operatingModel,
    confidence,
    cms: {
      need: cmsNeed,
      provider:
        cmsNeed === "none"
          ? "none"
          : selectCmsProvider(pageSlugs, sourcePageEstimate),
      editableAreas: buildEditableAreas(pageSlugs, cmsNeed !== "none"),
    },
    commerce: {
      need: commerceNeed,
      provider: "none",
      productStrategy: "none",
    },
    booking: {
      need: bookingNeed,
      provider: "none",
    },
    memberships: {
      need: membershipsNeed,
      provider: "none",
    },
    reasons: dedupeStrings(reasons).slice(0, 7),
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

  const candidate: SiteCapabilityProfile = {
    profileVersion: 2,
    operatingModel:
      normalizeOperatingModel(source.operatingModel) ?? fallback.operatingModel,
    confidence: normalizeConfidence(source.confidence) ?? fallback.confidence,
    cms: {
      need: normalizeNeed(cmsSource?.need) ?? fallback.cms.need,
      provider:
        normalizeCmsProvider(cmsSource?.provider) ?? fallback.cms.provider,
      editableAreas: dedupeStrings(
        Array.isArray(cmsSource?.editableAreas)
          ? cmsSource?.editableAreas.map((entry) => String(entry))
          : fallback.cms.editableAreas
      ),
    },
    commerce: {
      need: fallback.commerce.need,
      provider: fallback.commerce.provider,
      productStrategy: fallback.commerce.productStrategy,
    },
    booking: {
      need: fallback.booking.need,
      provider: fallback.booking.provider,
    },
    memberships: {
      need: fallback.memberships.need,
      provider: fallback.memberships.provider,
    },
    reasons: dedupeStrings(
      Array.isArray(source.reasons)
        ? source.reasons.map((reason) => String(reason))
        : fallback.reasons
    ).slice(0, 7),
    packageSummary: "",
  };

  candidate.operatingModel =
    fallback.operatingModel === "custom-app"
      ? "custom-app"
      : candidate.cms.need !== "none"
        ? "static-plus-packs"
        : "static-only";

  if (fallback.operatingModel === "custom-app") {
    candidate.confidence = "high";
  }

  if (candidate.cms.need !== "none" && candidate.cms.provider === "none") {
    candidate.cms.provider = fallback.cms.provider;
  }

  if (candidate.reasons.length === 0) {
    candidate.reasons = fallback.reasons;
  } else {
    candidate.reasons = dedupeStrings([
      ...candidate.reasons,
      ...fallback.reasons.slice(0, 2),
    ]).slice(0, 7);
  }

  candidate.packageSummary = buildPackageSummary(candidate);
  return candidate;
}

export function applySiteCapabilityPackOverride(
  profile: SiteCapabilityProfile,
  override?: SiteCapabilityPackOverride | null
): SiteCapabilityProfile {
  if (!override || profile.operatingModel === "custom-app") {
    return profile;
  }

  const includeCms =
    override.includeCmsPack !== undefined
      ? override.includeCmsPack
      : includeCmsPack(profile);

  const nextProfile: SiteCapabilityProfile = {
    ...profile,
    cms: { ...profile.cms },
    commerce: { ...profile.commerce },
    booking: { ...profile.booking },
    memberships: { ...profile.memberships },
    reasons: [...profile.reasons],
  };

  nextProfile.cms = includeCms
    ? {
        need: profile.cms.need === "none" ? "recommended" : profile.cms.need,
        provider: "sanity",
        editableAreas: buildDefaultEditableAreasForPack(
          true,
          profile.cms.editableAreas
        ),
      }
    : {
        need: "none",
        provider: "none",
        editableAreas: [],
      };

  nextProfile.commerce = {
    need: "none",
    provider: "none",
    productStrategy: "none",
  };
  nextProfile.booking = {
    need: "none",
    provider: "none",
  };
  nextProfile.memberships = {
    need: "none",
    provider: "none",
  };

  nextProfile.operatingModel =
    nextProfile.cms.need !== "none"
      ? "static-plus-packs"
      : "static-only";

  const overrideReasons: string[] = [];
  if (
    override.includeCmsPack !== undefined &&
    override.includeCmsPack !== includeCmsPack(profile)
  ) {
    overrideReasons.push(
      override.includeCmsPack
        ? "A Curb operator manually enabled the external CMS pack for this generation run."
        : "A Curb operator manually disabled the external CMS pack for this generation run."
    );
  }

  if (override.includeStorePack) {
    overrideReasons.push(
      "Store packs are no longer part of the standard Curb stack. Scope commerce as a separate managed upsell instead."
    );
  }

  nextProfile.reasons = dedupeStrings([
    ...overrideReasons,
    ...nextProfile.reasons,
  ]).slice(0, 7);
  nextProfile.packageSummary = buildPackageSummary(nextProfile);
  return nextProfile;
}

export function buildSiteCapabilityPromptSummary(
  profile: SiteCapabilityProfile
): string {
  return [
    "Capability Recommendation:",
    `Operating model: ${profile.operatingModel}`,
    "Hosting target: cloudflare-pages",
    `Confidence: ${profile.confidence}`,
    `CMS need: ${profile.cms.need}`,
    `CMS provider: ${profile.cms.provider}`,
    `Editable areas: ${
      profile.cms.editableAreas.length > 0
        ? profile.cms.editableAreas.join(", ")
        : "none"
    }`,
    "Standard stack: cloudflare-pages + shared-forms + stripe",
    "Standard managed CMS: sanity",
    `Commerce need: ${profile.commerce.need}`,
    `Commerce provider: ${profile.commerce.provider}`,
    `Commerce strategy: ${profile.commerce.productStrategy}`,
    `Booking need: ${profile.booking.need}`,
    `Booking provider: ${profile.booking.provider}`,
    `Membership need: ${profile.memberships.need}`,
    `Membership provider: ${profile.memberships.provider}`,
    ...profile.reasons.map((reason) => `- ${reason}`),
    `Packaging guidance: ${profile.packageSummary}`,
    "- Recommend real provider back offices only. Do not invent /admin/ screens, fake account portals, fake store checkouts, or fake booking flows inside the static bundle.",
    "- Store, booking, and membership functionality are custom managed add-ons, not default packs.",
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
      deploymentRecommendation: {
        hostingProvider: "cloudflare-pages",
      },
    },
    null,
    2
  )}\n`;
}

export function includeCmsPack(profile: SiteCapabilityProfile): boolean {
  return profile.cms.need !== "none" && profile.cms.provider !== "none";
}

export function includeStorePack(profile: SiteCapabilityProfile): boolean {
  void profile;
  return false;
}

export function includeBookingPack(profile: SiteCapabilityProfile): boolean {
  void profile;
  return false;
}

export function includeMembershipPack(
  profile: SiteCapabilityProfile
): boolean {
  void profile;
  return false;
}
