import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "..");
const SITES_DIR = path.join(WORKSPACE_ROOT, "sites");
const DB_PATH = path.join(WORKSPACE_ROOT, "curb.db");

const LEGACY_ARTIFACT_PATHS = [
  "admin",
  "assets/curb-admin-pack.css",
  "assets/curb-admin-pack.js",
  "assets/curb-cms-schema.json",
  "assets/curb-products.json",
  "assets/curb-public-pack.js",
  "assets/vendor/tabler.min.css",
  "assets/vendor/tabler.min.js",
  "handoff/OWNER_SETUP.md",
  "handoff/firebase.json",
  "handoff/firestore.indexes.json",
  "handoff/firestore.rules",
];

const DEFAULT_SETTINGS = {
  businessEmail: "",
  resendFromEmail: "",
  resendApiKey: "",
  sharedFormEndpointUrl: "",
  sharedFormSigningSecret: "",
  turnstileSiteKey: "",
};

function text(value) {
  return String(value ?? "").trim();
}

function loadSettings() {
  if (!fs.existsSync(DB_PATH)) {
    return { ...DEFAULT_SETTINGS };
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    const settings = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      const key = text(row.key);
      if (Object.hasOwn(settings, key)) {
        settings[key] = String(row.value ?? "");
      }
    }

    return settings;
  } finally {
    db.close();
  }
}

function loadSiteBusinessLookup() {
  if (!fs.existsSync(DB_PATH)) {
    return new Map();
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT
           gs.slug AS slug,
           b.name AS business_name,
           b.email AS business_email
         FROM generated_sites gs
         INNER JOIN businesses b
           ON b.id = gs.business_id
         INNER JOIN (
           SELECT slug, MAX(version) AS latest_version
           FROM generated_sites
           GROUP BY slug
         ) latest
           ON latest.slug = gs.slug
          AND latest.latest_version = gs.version`
      )
      .all();

    return new Map(
      rows.map((row) => [
        text(row.slug),
        {
          businessName: text(row.business_name),
          businessEmail: text(row.business_email),
        },
      ])
    );
  } finally {
    db.close();
  }
}

function loadPortableContactRuntime() {
  const runtimeSource = fs.readFileSync(
    path.join(APP_ROOT, "src", "lib", "contact-runtime.ts"),
    "utf8"
  );
  const match = runtimeSource.match(
    /export const PORTABLE_CONTACT_RUNTIME = `([\s\S]*?)`;\s*$/
  );

  if (!match) {
    throw new Error("Could not read the portable contact runtime source.");
  }

  // This evaluates the trusted local template literal exactly as the app does.
  return Function(`"use strict"; return \`${match[1]}\`;`)();
}

function parseSiteConfig(siteConfigPath) {
  if (!fs.existsSync(siteConfigPath)) {
    return null;
  }

  const source = fs.readFileSync(siteConfigPath, "utf8");
  const match = source.match(/window\.CURB_SITE_CONFIG\s*=\s*({[\s\S]*?})\s*;?\s*$/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeNeed(value, fallback = "none") {
  const normalized = text(value).toLowerCase();

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

  return fallback;
}

function normalizeConfidence(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  return "medium";
}

function normalizeOperatingModel(value, hasMemberships, hasAnyPack) {
  const normalized = text(value).toLowerCase();

  if (normalized === "custom-app" || normalized === "custom app") {
    return "custom-app";
  }

  if (
    normalized === "static-plus-packs" ||
    normalized === "static-plus-cms" ||
    normalized === "static-plus-cms-and-store" ||
    normalized === "static-plus-store" ||
    normalized === "static-plus-admin" ||
    normalized === "static-plus-admin-and-store"
  ) {
    return hasMemberships ? "custom-app" : "static-plus-packs";
  }

  if (normalized === "static-only") {
    return "static-only";
  }

  if (hasMemberships) {
    return "custom-app";
  }

  return hasAnyPack ? "static-plus-packs" : "static-only";
}

function normalizeCmsProvider(value) {
  const normalized = text(value).toLowerCase();

  if (!normalized || normalized === "none") {
    return "none";
  }

  if (normalized === "sanity") {
    return "sanity";
  }

  return "storyblok";
}

function normalizeCommerceProvider(value) {
  const normalized = text(value).toLowerCase();

  if (!normalized || normalized === "none") {
    return "none";
  }

  return "shopify";
}

function normalizeProductStrategy(value) {
  const normalized = text(value).toLowerCase();

  if (normalized === "storefront-api") {
    return "storefront-api";
  }

  if (!normalized || normalized === "none") {
    return "none";
  }

  return "buy-button";
}

function normalizeBookingProvider(value) {
  const normalized = text(value).toLowerCase();

  if (
    normalized === "cal-com" ||
    normalized === "cal.com" ||
    normalized === "cal"
  ) {
    return "cal-com";
  }

  if (
    normalized === "square-appointments" ||
    normalized === "square appointments" ||
    normalized === "square"
  ) {
    return "square-appointments";
  }

  return "none";
}

function normalizeMembershipProvider(value) {
  const normalized = text(value).toLowerCase();

  if (normalized === "clerk") {
    return "clerk";
  }

  if (normalized === "memberstack") {
    return "memberstack";
  }

  return "none";
}

function uniqueStrings(values) {
  return Array.from(
    new Set(values.map((value) => text(value)).filter(Boolean))
  );
}

function buildPackageSummary(profile) {
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

  const lines = ["Keep the public site static on Cloudflare Pages."];

  if (profile.cms.need !== "none" && profile.cms.provider !== "none") {
    lines.push(
      `Use ${profile.cms.provider === "sanity" ? "Sanity" : "Storyblok"} as the end-user content admin instead of an in-site /admin portal.`
    );
  }

  if (profile.commerce.need !== "none" && profile.commerce.provider !== "none") {
    lines.push(
      profile.commerce.productStrategy === "storefront-api"
        ? "Use Shopify Storefront API after the sale instead of a generated in-site store runtime."
        : "Use Shopify Buy Button embeds or checkout links after the sale instead of a generated in-site store runtime."
    );
  }

  if (profile.booking.need !== "none" && profile.booking.provider !== "none") {
    lines.push(
      `Use ${
        profile.booking.provider === "cal-com" ? "Cal.com" : "Square Appointments"
      } for booking and appointment management.`
    );
  }

  if (
    profile.memberships.need !== "none" &&
    profile.memberships.provider !== "none"
  ) {
    lines.push(
      `Use ${
        profile.memberships.provider === "clerk" ? "Clerk" : "Memberstack"
      } for member access instead of generating a custom login flow.`
    );
  }

  return lines.join(" ");
}

function normalizeCapabilityProfile(rawProfile, siteConfig) {
  const source = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const legacyCmsEnabled =
    Boolean(siteConfig?.cms?.enabled) ||
    text(source.cms?.provider) !== "none" ||
    text(source.cms?.need) !== "none";
  const legacyCommerceEnabled =
    Boolean(siteConfig?.commerce?.enabled) ||
    text(source.commerce?.provider) !== "none" ||
    text(source.commerce?.need) !== "none" ||
    text(siteConfig?.commerce?.shopPath);

  const cmsProvider = legacyCmsEnabled
    ? normalizeCmsProvider(source.cms?.provider || siteConfig?.cms?.provider)
    : "none";
  const cmsNeed = legacyCmsEnabled
    ? normalizeNeed(source.cms?.need, "recommended")
    : "none";
  const editableAreas = uniqueStrings(
    Array.isArray(source.cms?.editableAreas) ? source.cms.editableAreas : []
  );

  const commerceProvider = legacyCommerceEnabled
    ? normalizeCommerceProvider(
        source.commerce?.provider || siteConfig?.commerce?.provider
      )
    : "none";
  const commerceNeed = legacyCommerceEnabled
    ? normalizeNeed(source.commerce?.need, "recommended")
    : "none";
  const productStrategy = legacyCommerceEnabled
    ? normalizeProductStrategy(source.commerce?.productStrategy || "buy-button")
    : "none";

  const bookingProvider = normalizeBookingProvider(source.booking?.provider);
  const bookingNeed =
    bookingProvider === "none" ? "none" : normalizeNeed(source.booking?.need, "recommended");

  const membershipsProvider = normalizeMembershipProvider(
    source.memberships?.provider
  );
  const membershipsNeed =
    membershipsProvider === "none"
      ? "none"
      : normalizeNeed(source.memberships?.need, "recommended");

  const operatingModel = normalizeOperatingModel(
    source.operatingModel,
    membershipsNeed !== "none",
    cmsNeed !== "none" ||
      commerceNeed !== "none" ||
      bookingNeed !== "none" ||
      membershipsNeed !== "none"
  );

  const reasons = uniqueStrings(
    Array.isArray(source.reasons) ? source.reasons : []
  );

  if (cmsNeed !== "none" && reasons.length === 0) {
    reasons.push(
      "This site needs occasional operator-managed content changes without embedding a fake in-site admin."
    );
  }

  if (commerceNeed !== "none") {
    reasons.push(
      "Commerce should move to Shopify after the sale instead of relying on the retired generated store pack."
    );
  }

  return {
    profileVersion: 2,
    operatingModel,
    confidence: normalizeConfidence(source.confidence),
    cms: {
      need: cmsNeed,
      provider: cmsNeed === "none" ? "none" : cmsProvider,
      editableAreas:
        cmsNeed === "none"
          ? []
          : editableAreas.length > 0
            ? editableAreas
            : ["homepage", "contact"],
    },
    commerce: {
      need: commerceNeed,
      provider: commerceNeed === "none" ? "none" : commerceProvider,
      productStrategy: commerceNeed === "none" ? "none" : productStrategy,
    },
    booking: {
      need: bookingNeed,
      provider: bookingNeed === "none" ? "none" : bookingProvider,
    },
    memberships: {
      need: membershipsNeed,
      provider: membershipsNeed === "none" ? "none" : membershipsProvider,
    },
    reasons,
    packageSummary: buildPackageSummary({
      operatingModel,
      cms: {
        need: cmsNeed,
        provider: cmsNeed === "none" ? "none" : cmsProvider,
      },
      commerce: {
        need: commerceNeed,
        provider: commerceNeed === "none" ? "none" : commerceProvider,
        productStrategy: commerceNeed === "none" ? "none" : productStrategy,
      },
      booking: {
        need: bookingNeed,
        provider: bookingNeed === "none" ? "none" : bookingProvider,
      },
      memberships: {
        need: membershipsNeed,
        provider: membershipsNeed === "none" ? "none" : membershipsProvider,
      },
    }),
  };
}

function includeCmsPack(profile) {
  return profile.cms.need !== "none" && profile.cms.provider !== "none";
}

function includeStorePack(profile) {
  return profile.commerce.need !== "none" && profile.commerce.provider !== "none";
}

function includeBookingPack(profile) {
  return profile.booking.need !== "none" && profile.booking.provider !== "none";
}

function includeMembershipPack(profile) {
  return (
    profile.memberships.need !== "none" && profile.memberships.provider !== "none"
  );
}

function buildRecommendedPacks(profile) {
  return {
    hosting: {
      provider: "cloudflare-pages",
    },
    cms: {
      enabled: includeCmsPack(profile),
      provider: profile.cms.provider,
      editableAreas: profile.cms.editableAreas,
    },
    commerce: {
      enabled: includeStorePack(profile),
      provider: profile.commerce.provider,
      strategy: profile.commerce.productStrategy,
    },
    booking: {
      enabled: includeBookingPack(profile),
      provider: profile.booking.provider,
    },
    memberships: {
      enabled: includeMembershipPack(profile),
      provider: profile.memberships.provider,
    },
  };
}

function buildSharedFormSiteToken(claims, secret) {
  if (!text(secret)) {
    return "";
  }

  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      businessName: text(claims.businessName),
      recipientEmail: text(claims.recipientEmail).toLowerCase(),
      siteSlug: text(claims.siteSlug),
    }),
    "utf8"
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function buildSiteConfig({
  profile,
  settings,
  siteConfig,
  siteSlug,
  businessName,
  businessEmail,
}) {
  const fallbackRecipient = text(settings.businessEmail);
  const directRecipient =
    text(businessEmail) || text(siteConfig?.contact?.recipientEmail);
  const recipientEmail = directRecipient || fallbackRecipient;
  const recipientSource = directRecipient
    ? "business"
    : fallbackRecipient
      ? "fallback"
      : "unset";

  return {
    businessName,
    site: {
      slug: siteSlug,
      businessName,
    },
    contact: {
      recipientEmail,
      recipientSource,
      deliveryMode: "shared-endpoint",
      endpointUrl: text(settings.sharedFormEndpointUrl),
      siteToken: buildSharedFormSiteToken(
        {
          businessName,
          recipientEmail,
          siteSlug,
        },
        text(settings.sharedFormSigningSecret)
      ),
      subjectPrefix: `New website lead for ${businessName}`,
      turnstileSiteKey: text(settings.turnstileSiteKey),
      successMessage: "Thanks. Your message has been sent.",
      errorMessage:
        "We could not send your message right now. Please try again in a moment.",
    },
    recommendedPacks: buildRecommendedPacks(profile),
  };
}

function buildProviderPackSummaryLines(profile) {
  const lines = [
    "- Hosting: Cloudflare Pages",
    "- Forms: Shared Cloudflare form endpoint with Turnstile and Resend",
  ];

  if (includeCmsPack(profile)) {
    lines.push(
      `- CMS: ${profile.cms.provider === "sanity" ? "Sanity" : "Storyblok"}`
    );
  }

  if (includeStorePack(profile)) {
    lines.push("- Store admin: Shopify");
  }

  if (includeBookingPack(profile)) {
    lines.push(
      `- Booking: ${
        profile.booking.provider === "cal-com" ? "Cal.com" : "Square Appointments"
      }`
    );
  }

  if (includeMembershipPack(profile)) {
    lines.push(
      `- Memberships: ${
        profile.memberships.provider === "clerk" ? "Clerk" : "Memberstack"
      }`
    );
  }

  return lines;
}

function buildProviderHandoffReadme(businessName, profile) {
  return [
    "# Provider-Based Handoff",
    "",
    `This bundle was generated for ${businessName}.`,
    "",
    "Curb now treats generated sites as static public experiences.",
    "Do not ship a fake in-site admin, fake account portal, or fake checkout flow inside this bundle.",
    "",
    "## Recommended Stack",
    "",
    ...buildProviderPackSummaryLines(profile),
    "",
    "## Files",
    "",
    "- `assets/curb-site-package.json`: machine-readable capability manifest",
    "- `handoff/PROVIDER_SETUP.md`: provider activation checklist",
    "- `assets/curb-site-config.js`: contact runtime config",
    "",
    "## Launch Model",
    "",
    "1. Deploy the public site to Cloudflare Pages.",
    "2. Keep the outreach preview static and believable.",
    "3. After the sale, activate only the provider packs this business actually needs.",
    "",
  ].join("\n");
}

function buildProviderSetupGuide(profile) {
  const lines = [
    "# Provider Activation Checklist",
    "",
    "Use this after the customer buys. The public site stays static; owner workflows live in provider-managed back offices.",
    "",
    "## Base",
    "",
    "1. Deploy the static bundle to Cloudflare Pages.",
    "2. Connect the customer domain.",
    "3. Update `assets/curb-site-config.js` with the final contact recipient email.",
    "4. Verify the shared Cloudflare form service URL, signing secret, Turnstile keys, and Resend sender are configured in Curb.",
  ];

  if (includeCmsPack(profile)) {
    lines.push(
      "",
      "## CMS",
      "",
      profile.cms.provider === "sanity"
        ? "1. Create a Sanity project owned by the customer or your agency workspace."
        : "1. Create a Storyblok space owned by the customer or your agency workspace.",
      "2. Model the editable sections listed in `assets/curb-site-package.json`.",
      "3. Connect preview and publishing workflows to the static site.",
      "4. Train the customer in the provider UI instead of a custom /admin portal."
    );
  }

  if (includeStorePack(profile)) {
    lines.push(
      "",
      "## Store",
      "",
      "1. Create a Shopify store for the customer.",
      profile.commerce.productStrategy === "storefront-api"
        ? "2. Connect the generated storefront to Shopify Storefront API."
        : "2. Start with Shopify Buy Button embeds or checkout links for the first launch.",
      "3. Manage products, pricing, inventory, and orders inside Shopify admin."
    );
  }

  if (includeBookingPack(profile)) {
    lines.push(
      "",
      "## Booking",
      "",
      profile.booking.provider === "cal-com"
        ? "1. Create a Cal.com account and embed the booking flow on the relevant pages."
        : "1. Create a Square Appointments account and embed the booking flow on the relevant pages.",
      "2. Keep scheduling, staff availability, and confirmations inside the booking provider."
    );
  }

  if (includeMembershipPack(profile)) {
    lines.push(
      "",
      "## Memberships",
      "",
      profile.memberships.provider === "clerk"
        ? "1. Build the authenticated flow as a separate app and use Clerk for auth."
        : "1. Add Memberstack only if a light member area is genuinely required after the sale.",
      "2. Do not simulate member dashboards in the static marketing bundle."
    );
  }

  lines.push(
    "",
    "## Rule",
    "",
    "If a requested feature needs real app logic, scope it as a separate build instead of extending the static site with fake UI."
  );

  return `${lines.join("\n")}\n`;
}

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function removeLegacyArtifacts(siteDir) {
  let removed = 0;

  for (const relativePath of LEGACY_ARTIFACT_PATHS) {
    const absolutePath = path.join(siteDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    fs.rmSync(absolutePath, { recursive: true, force: true });
    removed += 1;
  }

  const vendorDir = path.join(siteDir, "assets", "vendor");
  if (fs.existsSync(vendorDir) && fs.readdirSync(vendorDir).length === 0) {
    fs.rmSync(vendorDir, { recursive: true, force: true });
  }

  return removed;
}

function walkHtmlFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".html") {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteLegacyHtml(content) {
  let next = content;

  next = next.replace(
    /^\s*<script[^>]*src=["']https:\/\/www\.gstatic\.com\/firebasejs\/[^"']+["'][^>]*><\/script>\s*$/gim,
    ""
  );
  next = next.replace(
    /^\s*<script[^>]*src=["'][^"']*curb-public-pack\.js[^"']*["'][^>]*><\/script>\s*$/gim,
    ""
  );
  next = next.replace(
    /<li\b[^>]*>\s*<a\b[^>]*href=["'][^"']*admin\/?[^"']*["'][^>]*>[\s\S]*?<\/a>\s*<\/li>/gi,
    ""
  );
  next = next.replace(
    /<a\b[^>]*href=["'][^"']*admin\/?[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
    ""
  );
  next = next.replace(
    /<a\b(?=[^>]*href=["'][^"']*(?:my-account|create-account|account)[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi,
    ""
  );
  next = next.replace(
    /<span\b[^>]*id=["'][^"']*(?:my-account|create-account|account)[^"']*["'][^>]*><\/span>\s*/gi,
    ""
  );
  next = next.replace(
    /Products are managed from the built-in owner portal\. Each item can point directly to a checkout link, so the public storefront stays static and cheap to host\./gi,
    "This is a static storefront preview. Activate Shopify after the sale to publish products, pricing, and checkout from a real store admin."
  );
  next = next.replace(
    /No live products have been published yet\. Add products in the owner portal and they will appear here automatically\./gi,
    "This preview does not ship with a live in-site catalog. Activate Shopify after the sale to publish products and checkout."
  );

  return next;
}

function migrateSite(siteDir, runtime, settings, businessLookup) {
  const siteSlug = path.basename(siteDir);
  const assetsDir = path.join(siteDir, "assets");
  const handoffDir = path.join(siteDir, "handoff");
  const siteConfigPath = path.join(assetsDir, "curb-site-config.js");
  const packagePath = path.join(assetsDir, "curb-site-package.json");
  const siteConfig = parseSiteConfig(siteConfigPath);
  const rawPackage = parseJsonFile(packagePath);
  const businessRecord = businessLookup.get(siteSlug) ?? {
    businessName: text(siteConfig?.businessName) || siteSlug,
    businessEmail: "",
  };
  const businessName =
    text(siteConfig?.businessName) || text(businessRecord.businessName) || siteSlug;
  const profile = normalizeCapabilityProfile(rawPackage?.capabilityProfile, siteConfig);
  const nextConfig = buildSiteConfig({
    businessEmail: businessRecord.businessEmail,
    businessName,
    profile,
    settings,
    siteConfig,
    siteSlug,
  });

  writeTextFile(
    siteConfigPath,
    [
      "// Update recipientEmail before launch. Configure the shared form service before publishing the live site.",
      `window.CURB_SITE_CONFIG = ${JSON.stringify(nextConfig, null, 2)};`,
      "",
    ].join("\n")
  );
  writeTextFile(path.join(assetsDir, "curb-contact.js"), `${runtime}\n`);
  writeTextFile(
    packagePath,
    `${JSON.stringify(
      {
        businessName,
        capabilityProfile: profile,
      },
      null,
      2
    )}\n`
  );
  writeTextFile(
    path.join(handoffDir, "README.md"),
    `${buildProviderHandoffReadme(businessName, profile)}\n`
  );
  writeTextFile(
    path.join(handoffDir, "PROVIDER_SETUP.md"),
    buildProviderSetupGuide(profile)
  );

  const removedArtifacts = removeLegacyArtifacts(siteDir);
  let updatedHtmlFiles = 0;

  for (const htmlPath of walkHtmlFiles(siteDir)) {
    const before = fs.readFileSync(htmlPath, "utf8");
    const after = rewriteLegacyHtml(before);
    if (after !== before) {
      fs.writeFileSync(htmlPath, after, "utf8");
      updatedHtmlFiles += 1;
    }
  }

  return {
    profile,
    removedArtifacts,
    updatedHtmlFiles,
  };
}

function main() {
  if (!fs.existsSync(SITES_DIR)) {
    throw new Error(`Sites directory not found at ${SITES_DIR}`);
  }

  const runtime = loadPortableContactRuntime();
  const settings = loadSettings();
  const businessLookup = loadSiteBusinessLookup();
  const siteDirs = fs
    .readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(SITES_DIR, entry.name))
    .sort((left, right) => left.localeCompare(right));

  let migrated = 0;
  let removedArtifacts = 0;
  let updatedHtmlFiles = 0;

  for (const siteDir of siteDirs) {
    const indexPath = path.join(siteDir, "index.html");
    const contactConfigPath = path.join(siteDir, "assets", "curb-site-config.js");
    if (!fs.existsSync(indexPath) && !fs.existsSync(contactConfigPath)) {
      continue;
    }

    const result = migrateSite(siteDir, runtime, settings, businessLookup);
    migrated += 1;
    removedArtifacts += result.removedArtifacts;
    updatedHtmlFiles += result.updatedHtmlFiles;
  }

  console.log(
    JSON.stringify(
      {
        migratedSites: migrated,
        removedArtifacts,
        sharedFormEndpointConfigured: Boolean(text(settings.sharedFormEndpointUrl)),
        turnstileConfigured: Boolean(text(settings.turnstileSiteKey)),
        updatedHtmlFiles,
      },
      null,
      2
    )
  );
}

main();
