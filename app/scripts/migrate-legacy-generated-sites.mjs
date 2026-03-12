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

  return "sanity";
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

  const lines = [
    "Keep the public site static on Cloudflare Pages.",
    "Use the shared Cloudflare form endpoint and Stripe for the default operating model.",
  ];

  if (profile.cms.need !== "none" && profile.cms.provider !== "none") {
    lines.push(
      "Use Sanity as the only standard external content admin instead of an in-site /admin portal."
    );
  }

  lines.push(
    "Treat store, booking, and membership requests as custom managed upsells, not default provider packs."
  );

  return lines.join(" ");
}

function normalizeCapabilityProfile(rawProfile, siteConfig) {
  const source = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const legacyCmsEnabled =
    Boolean(siteConfig?.cms?.enabled) ||
    text(source.cms?.provider) !== "none" ||
    text(source.cms?.need) !== "none";
  const cmsProvider = legacyCmsEnabled
    ? normalizeCmsProvider(source.cms?.provider || siteConfig?.cms?.provider)
    : "none";
  const cmsNeed = legacyCmsEnabled
    ? normalizeNeed(source.cms?.need, "recommended")
    : "none";
  const editableAreas = uniqueStrings(
    Array.isArray(source.cms?.editableAreas) ? source.cms.editableAreas : []
  );

  const operatingModel = normalizeOperatingModel(
    source.operatingModel,
    false,
    cmsNeed !== "none"
  );

  const reasons = uniqueStrings(
    Array.isArray(source.reasons) ? source.reasons : []
  );

  if (cmsNeed !== "none" && reasons.length === 0) {
    reasons.push(
      "This site needs occasional operator-managed content changes without embedding a fake in-site admin."
    );
  }

  if (
    text(source.commerce?.need) !== "none" ||
    text(source.booking?.need) !== "none" ||
    text(source.memberships?.need) !== "none"
  ) {
    reasons.push(
      "Advanced workflows are now custom managed add-ons instead of standard provider packs."
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
      need: "none",
      provider: "none",
      productStrategy: "none",
    },
    booking: {
      need: "none",
      provider: "none",
    },
    memberships: {
      need: "none",
      provider: "none",
    },
    reasons,
    packageSummary: buildPackageSummary({
      operatingModel,
      cms: {
        need: cmsNeed,
        provider: cmsNeed === "none" ? "none" : cmsProvider,
      },
      commerce: {
        need: "none",
        provider: "none",
        productStrategy: "none",
      },
      booking: {
        need: "none",
        provider: "none",
      },
      memberships: {
        need: "none",
        provider: "none",
      },
    }),
  };
}

function includeCmsPack(profile) {
  return profile.cms.need !== "none" && profile.cms.provider !== "none";
}

function buildRecommendedPacks(profile) {
  return {
    hosting: {
      provider: "cloudflare-pages",
    },
    cms: {
      enabled: includeCmsPack(profile),
      provider: includeCmsPack(profile) ? "sanity" : profile.cms.provider,
      editableAreas: profile.cms.editableAreas,
    },
    managedAddOns: {
      customOnly: ["commerce", "booking", "memberships"],
      note: "Advanced workflows are sold separately and are not part of the standard Curb stack.",
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
    lines.push("- CMS: Sanity");
  }

  lines.push(
    "- Advanced workflows: store, booking, and memberships are custom managed add-ons"
  );

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
    "3. After the sale, activate only the standard stack pieces you actually sold.",
    "4. Scope store, booking, and membership requests as separate managed add-ons.",
    "",
  ].join("\n");
}

function buildProviderSetupGuide(profile) {
  const lines = [
    "# Provider Activation Checklist",
    "",
    "Use this after the customer buys. The public site stays static, and the standard stack stays narrow: Cloudflare, shared forms, Stripe, and optional Sanity.",
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
      "1. Create a Sanity project owned by the customer or your agency workspace.",
      "2. Model the editable sections listed in `assets/curb-site-package.json`.",
      "3. Connect preview and publishing workflows to the static site.",
      "4. Train the customer in the provider UI instead of a custom /admin portal."
    );
  }

  lines.push(
    "",
    "## Custom Add-Ons",
    "",
    "If the customer wants ecommerce, booking, memberships, or other app-like behavior, sell and scope it as a separate managed add-on instead of extending the static site with fake UI."
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
    "This is a static storefront preview. If ecommerce is sold later, scope it as a separate managed add-on instead of restoring the retired in-site store runtime."
  );
  next = next.replace(
    /No live products have been published yet\. Add products in the owner portal and they will appear here automatically\./gi,
    "This preview does not ship with a live in-site catalog. Treat ecommerce as a custom managed add-on if the client later needs it."
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
