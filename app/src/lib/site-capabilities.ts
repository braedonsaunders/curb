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

const CAL_COM_CATEGORY_KEYWORDS = [
  "agency",
  "attorney",
  "coach",
  "consultant",
  "lawyer",
  "photographer",
  "studio",
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
    return "storyblok";
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
    return "storyblok";
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

function normalizeProductStrategy(
  value: unknown
): CommerceProductStrategy | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "buy-button" ||
    normalized === "storefront-api"
  ) {
    return normalized;
  }

  if (
    normalized === "payment-links" ||
    normalized === "stripe" ||
    normalized === "stripe payment links" ||
    normalized === "shopify buy button" ||
    normalized === "shopify-buy-button" ||
    normalized === "snipcart-cart"
  ) {
    return "buy-button";
  }

  if (
    normalized === "storefront" ||
    normalized === "storefront api" ||
    normalized === "storefront-api"
  ) {
    return "storefront-api";
  }

  return null;
}

function normalizeBookingProvider(
  value: unknown
): BookingProviderRecommendation | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "none" || !normalized) {
    return "none";
  }

  if (
    normalized === "square" ||
    normalized === "square appointments" ||
    normalized === "square-appointments"
  ) {
    return "square-appointments";
  }

  if (
    normalized === "cal" ||
    normalized === "cal.com" ||
    normalized === "cal-com"
  ) {
    return "cal-com";
  }

  return null;
}

function normalizeMembershipProvider(
  value: unknown
): MembershipProviderRecommendation | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "none" || !normalized) {
    return "none";
  }

  if (normalized === "memberstack") {
    return "memberstack";
  }

  if (normalized === "clerk") {
    return "clerk";
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

function buildEditableAreas(
  pageSlugs: string[],
  wantsCms: boolean,
  wantsStore: boolean
): string[] {
  if (!wantsCms) {
    return wantsStore ? ["products"] : [];
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
  if (!wantsCms) {
    return wantsStore ? ["products"] : [];
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

function selectCmsProvider(
  pageSlugs: string[],
  sourcePageEstimate: number
): CmsProviderRecommendation {
  const hasEditorialSignals = pageSlugs.some((slug) =>
    /blog|news|journal|resource|resources|insight|insights/.test(slug)
  );

  if (hasEditorialSignals && sourcePageEstimate >= 12) {
    return "sanity";
  }

  return "storyblok";
}

function selectBookingProvider(category: string): BookingProviderRecommendation {
  return includesAny(category, CAL_COM_CATEGORY_KEYWORDS)
    ? "cal-com"
    : "square-appointments";
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
      "Do not fake authenticated dashboards, portals, or member flows in the brochure bundle.",
      profile.memberships.provider === "clerk"
        ? "If the advanced customer flow moves forward, run it as a separate app with Clerk-managed auth."
        : "Scope the advanced customer flow as a separate app or specialist integration.",
    ].join(" ");
  }

  if (profile.operatingModel === "static-only") {
    return [
      "Keep the generated site fully static on Cloudflare Pages.",
      "Do not attach a fake admin, login, cart, or dashboard inside the site bundle.",
    ].join(" ");
  }

  const packLines = ["Keep the public site static on Cloudflare Pages."];

  if (includeCmsPack(profile)) {
    packLines.push(
      `Use ${profile.cms.provider === "sanity" ? "Sanity" : "Storyblok"} as the end-user content admin instead of an in-site /admin portal.`
    );
  }

  if (includeStorePack(profile)) {
    packLines.push(
      `Use Shopify as the end-user store admin and ${
        profile.commerce.productStrategy === "storefront-api"
          ? "wire the generated site to Shopify Storefront API after the sale."
          : "start with Shopify Buy Button embeds or checkout links after the sale."
      }`
    );
  }

  if (includeBookingPack(profile)) {
    packLines.push(
      `Use ${
        profile.booking.provider === "cal-com"
          ? "Cal.com"
          : "Square Appointments"
      } for booking and appointment management.`
    );
  }

  if (includeMembershipPack(profile)) {
    packLines.push(
      `Use ${
        profile.memberships.provider === "clerk" ? "Clerk" : "Memberstack"
      } for member access instead of generating a custom login flow.`
    );
  }

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
    reasons.push(
      "The current site appears to sell products online, so the replacement should point to a real store admin instead of a fake cart."
    );
  } else if (hasCommerceCategory) {
    commerceNeed = sourcePageEstimate >= 4 ? "recommended" : "optional";
    reasons.push(
      "The business looks retail-oriented, so a Shopify-backed catalog or store pack is likely useful after the sale."
    );
  }

  if (hasBooking) {
    bookingNeed = "required";
    reasons.push(
      "The current site already signals booking behavior, so the replacement should hook into a real booking system."
    );
  } else if (hasBookingCategory) {
    bookingNeed = "optional";
    reasons.push(
      "This service category often benefits from appointment booking, even if the first outreach preview can stay brochure-first."
    );
  }

  if (commerceNeed === "required" || commerceNeed === "recommended") {
    cmsNeed = withNeedStrength(cmsNeed, "recommended");
    reasons.push(
      "If products, collections, or merchandising change over time, an external content admin keeps the static site handoff clean."
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

  if (
    operatingModel !== "custom-app" &&
    (cmsNeed !== "none" ||
      commerceNeed !== "none" ||
      bookingNeed !== "none" ||
      membershipsNeed !== "none")
  ) {
    operatingModel = "static-plus-packs";
  }

  if (
    operatingModel !== "custom-app" &&
    commerceNeed === "required" &&
    sourcePageEstimate >= 16
  ) {
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
      editableAreas: buildEditableAreas(
        pageSlugs,
        cmsNeed !== "none",
        commerceNeed !== "none"
      ),
    },
    commerce: {
      need: commerceNeed,
      provider: commerceNeed === "none" ? "none" : "shopify",
      productStrategy:
        commerceNeed === "none"
          ? "none"
          : sourcePageEstimate >= 16
            ? "storefront-api"
            : "buy-button",
    },
    booking: {
      need: bookingNeed,
      provider:
        bookingNeed === "none" ? "none" : selectBookingProvider(category),
    },
    memberships: {
      need: membershipsNeed,
      provider:
        membershipsNeed === "none"
          ? "none"
          : operatingModel === "custom-app"
            ? "clerk"
            : "memberstack",
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
  const commerceSource =
    source.commerce && typeof source.commerce === "object"
      ? (source.commerce as Record<string, unknown>)
      : null;
  const bookingSource =
    source.booking && typeof source.booking === "object"
      ? (source.booking as Record<string, unknown>)
      : null;
  const membershipsSource =
    source.memberships && typeof source.memberships === "object"
      ? (source.memberships as Record<string, unknown>)
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
      need: normalizeNeed(commerceSource?.need) ?? fallback.commerce.need,
      provider:
        normalizeCommerceProvider(commerceSource?.provider) ??
        fallback.commerce.provider,
      productStrategy:
        normalizeProductStrategy(commerceSource?.productStrategy) ??
        fallback.commerce.productStrategy,
    },
    booking: {
      need: normalizeNeed(bookingSource?.need) ?? fallback.booking.need,
      provider:
        normalizeBookingProvider(bookingSource?.provider) ??
        fallback.booking.provider,
    },
    memberships: {
      need:
        normalizeNeed(membershipsSource?.need) ?? fallback.memberships.need,
      provider:
        normalizeMembershipProvider(membershipsSource?.provider) ??
        fallback.memberships.provider,
    },
    reasons: dedupeStrings(
      Array.isArray(source.reasons)
        ? source.reasons.map((reason) => String(reason))
        : fallback.reasons
    ).slice(0, 7),
    packageSummary: "",
  };

  if (fallback.operatingModel === "custom-app") {
    candidate.operatingModel = "custom-app";
    candidate.memberships = fallback.memberships;
    candidate.confidence = "high";
  } else if (
    candidate.operatingModel === "static-only" &&
    (candidate.cms.need !== "none" ||
      candidate.commerce.need !== "none" ||
      candidate.booking.need !== "none" ||
      candidate.memberships.need !== "none")
  ) {
    candidate.operatingModel = "static-plus-packs";
  }

  if (candidate.cms.need !== "none" && candidate.cms.provider === "none") {
    candidate.cms.provider = fallback.cms.provider;
  }

  if (
    candidate.commerce.need !== "none" &&
    candidate.commerce.provider === "none"
  ) {
    candidate.commerce.provider = "shopify";
  }

  if (
    candidate.commerce.need !== "none" &&
    candidate.commerce.productStrategy === "none"
  ) {
    candidate.commerce.productStrategy = fallback.commerce.productStrategy;
  }

  if (
    candidate.booking.need !== "none" &&
    candidate.booking.provider === "none"
  ) {
    candidate.booking.provider = fallback.booking.provider;
  }

  if (
    candidate.memberships.need !== "none" &&
    candidate.memberships.provider === "none"
  ) {
    candidate.memberships.provider = fallback.memberships.provider;
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
  const includeStore =
    override.includeStorePack !== undefined
      ? override.includeStorePack
      : includeStorePack(profile);

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
        provider: profile.cms.provider === "none" ? "storyblok" : profile.cms.provider,
        editableAreas: buildDefaultEditableAreasForPack(
          true,
          includeStore,
          profile.cms.editableAreas
        ),
      }
    : {
        need: "none",
        provider: "none",
        editableAreas: [],
      };

  nextProfile.commerce = includeStore
    ? {
        need:
          profile.commerce.need === "none"
            ? "recommended"
            : profile.commerce.need,
        provider:
          normalizeManagedCommerceProvider(
            override.commerceProvider ?? profile.commerce.provider
          ) ?? "shopify",
        productStrategy:
          profile.commerce.productStrategy === "none"
            ? "buy-button"
            : profile.commerce.productStrategy,
      }
    : {
        need: "none",
        provider: "none",
        productStrategy: "none",
      };

  nextProfile.operatingModel =
    nextProfile.cms.need !== "none" ||
    nextProfile.commerce.need !== "none" ||
    nextProfile.booking.need !== "none" ||
    nextProfile.memberships.need !== "none"
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

  if (
    override.includeStorePack !== undefined &&
    override.includeStorePack !== includeStorePack(profile)
  ) {
    overrideReasons.push(
      override.includeStorePack
        ? "A Curb operator manually enabled the Shopify store pack for this generation run."
        : "A Curb operator manually disabled the Shopify store pack for this generation run."
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
    `Commerce need: ${profile.commerce.need}`,
    `Commerce provider: ${profile.commerce.provider}`,
    `Commerce strategy: ${profile.commerce.productStrategy}`,
    `Booking need: ${profile.booking.need}`,
    `Booking provider: ${profile.booking.provider}`,
    `Membership need: ${profile.memberships.need}`,
    `Membership provider: ${profile.memberships.provider}`,
    ...profile.reasons.map((reason) => `- ${reason}`),
    `Packaging guidance: ${profile.packageSummary}`,
    "- Recommend real provider back offices only. Do not invent /admin/ screens, fake account portals, or fake checkout flows inside the static bundle.",
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
  return (
    profile.commerce.need !== "none" && profile.commerce.provider !== "none"
  );
}

export function includeBookingPack(profile: SiteCapabilityProfile): boolean {
  return profile.booking.need !== "none" && profile.booking.provider !== "none";
}

export function includeMembershipPack(
  profile: SiteCapabilityProfile
): boolean {
  return (
    profile.memberships.need !== "none" &&
    profile.memberships.provider !== "none"
  );
}
