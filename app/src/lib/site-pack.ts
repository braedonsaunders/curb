import { load } from "cheerio";

import {
  includeCmsPack,
  includeStorePack,
  resolveStoreCommerceProvider,
  type SiteCapabilityProfile,
  type StoreCommerceProvider,
} from "./site-capabilities";

export interface StaticSiteFile {
  path: string;
  content: string;
}

export interface ManagedSiteContext {
  businessName: string;
  siteSlug: string;
  siteCapabilityProfile: SiteCapabilityProfile;
}

export interface CmsFieldSchema {
  key: string;
  label: string;
  type: "text" | "textarea" | "link" | "image";
  defaultValue?: string;
  defaultHref?: string;
  defaultAlt?: string;
}

export interface CmsPageSchema {
  pageKey: string;
  path: string;
  title: string;
  fields: CmsFieldSchema[];
}

export interface CmsSchema {
  version: 1;
  businessName: string;
  siteSlug: string;
  pages: CmsPageSchema[];
  commerceProvider: SiteCapabilityProfile["commerce"]["provider"];
  storePagePath: string | null;
}

export interface ManagedSiteBundle {
  files: StaticSiteFile[];
  cmsSchema: CmsSchema | null;
}

export const CMS_SCHEMA_PATH = "assets/curb-cms-schema.json";
export const PUBLIC_PACK_RUNTIME_PATH = "assets/curb-public-pack.js";
export const ADMIN_PACK_RUNTIME_PATH = "assets/curb-admin-pack.js";
export const ADMIN_PACK_STYLE_PATH = "assets/curb-admin-pack.css";
export const ADMIN_PAGE_PATH = "admin/index.html";
export const STORE_PAGE_PATH = "shop/index.html";
export const STORE_ALIAS_PATH = "products/index.html";
export const HANDOFF_README_PATH = "handoff/README.md";
export const HANDOFF_FIREBASE_CONFIG_PATH = "handoff/firebase.json";
export const HANDOFF_FIRESTORE_RULES_PATH = "handoff/firestore.rules";
export const HANDOFF_FIRESTORE_INDEXES_PATH =
  "handoff/firestore.indexes.json";
export const HANDOFF_OWNERSHIP_PATH = "handoff/OWNER_SETUP.md";

const MAX_TEXT_FIELDS_PER_PAGE = 24;
const MAX_LINK_FIELDS_PER_PAGE = 12;
const MAX_IMAGE_FIELDS_PER_PAGE = 12;

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getStoreCommerceProvider(
  profile: SiteCapabilityProfile
): StoreCommerceProvider {
  return resolveStoreCommerceProvider(profile.commerce.provider);
}

function formatStoreCommerceProvider(
  provider: StoreCommerceProvider
): string {
  return provider === "shopify"
    ? "Shopify checkout links"
    : "Stripe Payment Links";
}

function formatStoreCommerceAccount(provider: StoreCommerceProvider): string {
  return provider === "shopify" ? "A Shopify account" : "A Stripe account";
}

function formatStoreCommerceSetup(provider: StoreCommerceProvider): string {
  return provider === "shopify"
    ? "Shopify configuration"
    : "Stripe configuration";
}

function relativeHrefBetweenFiles(fromFilePath: string, toFilePath: string): string {
  const fromSegments = fromFilePath.split("/").filter(Boolean);
  const toSegments = toFilePath.split("/").filter(Boolean);
  const fromDirSegments = fromSegments.slice(0, -1);

  while (
    fromDirSegments.length > 0 &&
    toSegments.length > 0 &&
    fromDirSegments[0] === toSegments[0]
  ) {
    fromDirSegments.shift();
    toSegments.shift();
  }

  const upward = fromDirSegments.map(() => "..");
  const relativeSegments = [...upward, ...toSegments];
  return relativeSegments.length > 0 ? relativeSegments.join("/") : ".";
}

function pathToPageTitle(filePath: string): string {
  if (filePath === "index.html") {
    return "Homepage";
  }

  const cleaned = filePath
    .replace(/\/index\.html$/i, "")
    .replace(/\.html$/i, "")
    .replace(/[-_/]+/g, " ")
    .trim();

  return cleaned
    .split(/\s+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function ensureDoctype(content: string, renderedHtml: string): string {
  const doctypeMatch = content.match(/^\s*<!DOCTYPE[^>]*>/i);
  return doctypeMatch ? `${doctypeMatch[0]}\n${renderedHtml}` : renderedHtml;
}

function shouldIgnoreLink(href: string): boolean {
  return (
    !href ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("javascript:") ||
    href.startsWith("data:")
  );
}

function createStorePageMarkup(
  businessName: string,
  filePath: string
): string {
  const homeHref = relativeHrefBetweenFiles(filePath, "index.html");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${businessName} Shop</title>
    <style>
      :root {
        color-scheme: light;
        --pack-bg: #f5f7fb;
        --pack-text: #0f172a;
        --pack-muted: #475569;
        --pack-panel: #ffffff;
        --pack-border: rgba(15, 23, 42, 0.08);
        --pack-accent: #0f766e;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        background: linear-gradient(180deg, #f8fafc, var(--pack-bg));
        color: var(--pack-text);
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 3rem 1.25rem 5rem;
      }
      .shop-shell {
        display: grid;
        gap: 2rem;
      }
      .shop-hero {
        background: var(--pack-panel);
        border: 1px solid var(--pack-border);
        border-radius: 1.5rem;
        padding: 2rem;
        box-shadow: 0 20px 45px -32px rgba(15, 23, 42, 0.4);
      }
      .shop-hero p {
        max-width: 40rem;
        color: var(--pack-muted);
        line-height: 1.6;
      }
      .shop-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: 1.25rem;
      }
      .shop-actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.75rem;
        padding: 0.75rem 1rem;
        border-radius: 999px;
        border: 1px solid var(--pack-border);
        text-decoration: none;
        color: inherit;
      }
      .shop-actions a.primary {
        background: var(--pack-accent);
        color: #fff;
        border-color: transparent;
      }
      .shop-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .shop-card {
        background: var(--pack-panel);
        border: 1px solid var(--pack-border);
        border-radius: 1.25rem;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }
      .shop-card img {
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
        background: #e2e8f0;
      }
      .shop-card-body {
        padding: 1rem;
        display: grid;
        gap: 0.75rem;
      }
      .shop-card p {
        color: var(--pack-muted);
        line-height: 1.5;
        margin: 0;
      }
      .shop-card-price {
        font-weight: 700;
      }
      .shop-card a {
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.6rem;
        border-radius: 999px;
        background: var(--pack-accent);
        color: #fff;
        padding: 0.7rem 1rem;
      }
      .shop-empty {
        padding: 1.5rem;
        border: 1px dashed rgba(15, 23, 42, 0.18);
        border-radius: 1rem;
        color: var(--pack-muted);
        background: rgba(255, 255, 255, 0.72);
      }
    </style>
  </head>
  <body data-curb-page-key="${filePath}">
    <main>
      <div class="shop-shell">
        <section class="shop-hero">
          <p class="shop-brow">Customer-owned storefront</p>
          <h1 data-curb-key="shop-heading" data-curb-type="text">Shop ${businessName}</h1>
          <p data-curb-key="shop-intro" data-curb-type="textarea">
            Products are managed from the built-in owner portal. Each item can point directly to a checkout link, so the public storefront stays static and cheap to host.
          </p>
          <div class="shop-actions">
            <a class="primary" href="${homeHref}">Back to homepage</a>
            <a href="../admin/">Open owner portal</a>
          </div>
        </section>
        <section>
          <div class="shop-grid" data-curb-products="true"></div>
          <div class="shop-empty" data-curb-products-empty="true">
            No live products have been published yet. Add products in the owner portal and they will appear here automatically.
          </div>
        </section>
      </div>
    </main>
  </body>
</html>
`;
}

function createStoreAliasPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=../shop/">
    <link rel="canonical" href="../shop/">
    <title>Redirecting to shop</title>
  </head>
  <body>
    <p>Redirecting to <a href="../shop/">shop</a>...</p>
  </body>
</html>
`;
}

function annotateManagedHtmlFile(
  file: StaticSiteFile,
  shopHref: string | null
): { file: StaticSiteFile; page: CmsPageSchema } {
  const $ = load(file.content);
  const title = normalizeText($("title").first().text()) || pathToPageTitle(file.path);
  const body = $("body").first();
  if (body.length > 0) {
    body.attr("data-curb-page-key", file.path);
    if (shopHref) {
      body.attr("data-curb-shop-path", shopHref);
    }
  }

  const fields: CmsFieldSchema[] = [];
  let textIndex = 0;
  let linkIndex = 0;
  let imageIndex = 0;

  $("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, element) => {
    if (textIndex >= MAX_TEXT_FIELDS_PER_PAGE) {
      return;
    }

    const node = $(element);
    if (node.attr("data-curb-key")) {
      return;
    }

    const text = normalizeText(node.text());
    if (!text || text.length < 3) {
      return;
    }

    const key = `text-${textIndex + 1}`;
    const labelBase = node[0]?.tagName?.toUpperCase() ?? "TEXT";
    const fieldType =
      text.length > 120 || /^(P|BLOCKQUOTE|LI)$/i.test(labelBase)
        ? "textarea"
        : "text";
    node.attr("data-curb-key", key);
    node.attr("data-curb-type", fieldType);
    fields.push({
      key,
      label: `${labelBase}: ${text.slice(0, 60)}`,
      type: fieldType,
      defaultValue: text,
    });
    textIndex += 1;
  });

  $("a[href]").each((_, element) => {
    if (linkIndex >= MAX_LINK_FIELDS_PER_PAGE) {
      return;
    }

    const node = $(element);
    if (node.attr("data-curb-key")) {
      return;
    }

    const href = String(node.attr("href") ?? "").trim();
    if (shouldIgnoreLink(href)) {
      return;
    }

    const text = normalizeText(node.text()) || href;
    const key = `link-${linkIndex + 1}`;
    node.attr("data-curb-key", key);
    node.attr("data-curb-type", "link");
    fields.push({
      key,
      label: `LINK: ${text.slice(0, 60)}`,
      type: "link",
      defaultValue: text,
      defaultHref: href,
    });
    linkIndex += 1;
  });

  $("img[src]").each((_, element) => {
    if (imageIndex >= MAX_IMAGE_FIELDS_PER_PAGE) {
      return;
    }

    const node = $(element);
    if (node.attr("data-curb-key")) {
      return;
    }

    const src = String(node.attr("src") ?? "").trim();
    if (!src) {
      return;
    }

    const alt = normalizeText(node.attr("alt"));
    const key = `image-${imageIndex + 1}`;
    node.attr("data-curb-key", key);
    node.attr("data-curb-type", "image");
    fields.push({
      key,
      label: `IMAGE: ${alt || src.slice(0, 60)}`,
      type: "image",
      defaultValue: src,
      defaultAlt: alt,
    });
    imageIndex += 1;
  });

  const renderedHtml = $.html();

  return {
    file: {
      ...file,
      content: ensureDoctype(file.content, renderedHtml),
    },
    page: {
      pageKey: file.path,
      path: file.path,
      title,
      fields,
    },
  };
}

function buildCmsSchema(
  context: ManagedSiteContext,
  pages: CmsPageSchema[]
): CmsSchema {
  const schemaPages = [...pages];

  if (includeStorePack(context.siteCapabilityProfile)) {
    schemaPages.push({
      pageKey: STORE_PAGE_PATH,
      path: STORE_PAGE_PATH,
      title: "Shop",
      fields: [
        {
          key: "shop-heading",
          label: "Shop heading",
          type: "text",
          defaultValue: `Shop ${context.businessName}`,
        },
        {
          key: "shop-intro",
          label: "Shop intro",
          type: "textarea",
          defaultValue:
            "Products are managed from the built-in owner portal. Each item can point directly to a checkout link, so the public storefront stays static and cheap to host.",
        },
      ],
    });
  }

  return {
    version: 1,
    businessName: context.businessName,
    siteSlug: context.siteSlug,
    pages: schemaPages,
    commerceProvider: context.siteCapabilityProfile.commerce.provider,
    storePagePath: includeStorePack(context.siteCapabilityProfile)
      ? STORE_PAGE_PATH
      : null,
  };
}

function buildHandoffReadme(context: ManagedSiteContext): string {
  const commerceProvider = getStoreCommerceProvider(
    context.siteCapabilityProfile
  );
  return `# Customer-Owned Handoff

This site was packaged for customer-owned hosting and customer-owned billing.

## Stack

- Public site: static files
- Owner portal: \`/admin/\`
- Content store: Firebase Auth + Firestore
- Commerce: ${
    includeStorePack(context.siteCapabilityProfile)
      ? formatStoreCommerceProvider(commerceProvider)
      : "Not included"
  }

## What You Should Hand Off

1. A Firebase project owned by the customer
2. A Firebase Hosting site owned by the customer
3. ${
    includeStorePack(context.siteCapabilityProfile)
      ? formatStoreCommerceAccount(commerceProvider)
      : "A Stripe or Shopify account"
  } owned by the customer${
    includeStorePack(context.siteCapabilityProfile) ? "" : " (optional)"
  }
4. The customer's domain account or DNS access

## Files In This Folder

- \`firebase.json\`: Hosting config
- \`firestore.rules\`: Firestore security rules template
- \`firestore.indexes.json\`: Firestore indexes file
- \`OWNER_SETUP.md\`: Exact customer setup checklist

## Ownership Model

The goal is one sale, one setup, then the customer runs their own stack.
Do not leave this running on your own Firebase, Stripe, or Shopify account unless you
intentionally want recurring hosting/support responsibility.
`;
}

function buildFirebaseJson(): string {
  return `${JSON.stringify(
    {
      hosting: {
        public: ".",
        ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
        cleanUrls: true,
        trailingSlash: true,
      },
      firestore: {
        rules: "handoff/firestore.rules",
        indexes: "handoff/firestore.indexes.json",
      },
    },
    null,
    2
  )}\n`;
}

function buildFirestoreRules(): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sites/{siteId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.ownerEmail == request.auth.token.email;
      allow update, delete: if request.auth != null
        && resource.data.ownerEmail == request.auth.token.email;

      match /pages/{pageId} {
        allow read: if true;
        allow write: if request.auth != null
          && get(/databases/$(database)/documents/sites/$(siteId)).data.ownerEmail == request.auth.token.email;
      }

      match /products/{productId} {
        allow read: if true;
        allow write: if request.auth != null
          && get(/databases/$(database)/documents/sites/$(siteId)).data.ownerEmail == request.auth.token.email;
      }
    }
  }
}
`;
}

function buildFirestoreIndexes(): string {
  return `${JSON.stringify(
    {
      indexes: [
        {
          collectionGroup: "products",
          queryScope: "COLLECTION",
          fields: [
            { fieldPath: "position", order: "ASCENDING" },
            { fieldPath: "__name__", order: "ASCENDING" },
          ],
        },
      ],
      fieldOverrides: [],
    },
    null,
    2
  )}\n`;
}

function buildOwnerSetupGuide(context: ManagedSiteContext): string {
  const commerceProvider = getStoreCommerceProvider(
    context.siteCapabilityProfile
  );
  return `# Owner Setup Checklist

Use this when handing the site to the customer.

## 1. Customer-Owned Accounts

Ask the customer to create and own:

1. A Firebase project
2. ${
    includeStorePack(context.siteCapabilityProfile)
      ? formatStoreCommerceAccount(commerceProvider)
      : "A Stripe or Shopify account"
  }${includeStorePack(context.siteCapabilityProfile) ? "" : " if they want online payments"}
3. Their domain or DNS records

## 2. Firebase

1. Enable Firebase Hosting
2. Enable Firestore in production mode
3. Enable Authentication with Email Link sign-in
4. Add the final site domain and preview domain to Authentication authorized domains
5. Deploy \`handoff/firestore.rules\` and \`handoff/firestore.indexes.json\`

## 3. Site Config

Update \`assets/curb-site-config.js\` with:

- Firebase API key
- Auth domain
- Project ID
- App ID
- Storage bucket if used
- Messaging sender ID if used
- Owner email
${
  includeStorePack(context.siteCapabilityProfile)
    ? `- ${formatStoreCommerceProvider(commerceProvider)} for each product`
    : ""
}

## 4. First Login

1. Customer visits \`/admin/\`
2. Customer signs in with their owner email
3. The owner portal creates the site record automatically on first login
4. Customer edits page content and publishes products

## 5. Recommended Commercial Offer

- One-time design/build fee
- Optional launch/setup fee for Firebase + DNS + ${
    includeStorePack(context.siteCapabilityProfile)
      ? formatStoreCommerceSetup(commerceProvider)
      : "commerce configuration"
  }
- Optional monthly support plan only if the customer explicitly wants ongoing help

Default positioning: customer-owned stack, not agency-owned hosting.
`;
}

function buildPublicPackRuntime(): string {
  return `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var firebaseReady = false;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hasLocalStorage() {
    try {
      return typeof window.localStorage !== "undefined";
    } catch (error) {
      void error;
      return false;
    }
  }

  function hasFirebaseConfig() {
    return !!(
      text(firebaseConfig.apiKey) &&
      text(firebaseConfig.authDomain) &&
      text(firebaseConfig.projectId) &&
      text(firebaseConfig.appId)
    );
  }

  function ensureFirebase() {
    if (firebaseReady || !window.firebase || !hasFirebaseConfig()) {
      return;
    }

    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp({
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        appId: firebaseConfig.appId,
        storageBucket: firebaseConfig.storageBucket || undefined,
        messagingSenderId: firebaseConfig.messagingSenderId || undefined
      });
    }

    firebaseReady = true;
  }

  function getDb() {
    ensureFirebase();
    return window.firebase && firebaseReady ? window.firebase.firestore() : null;
  }

  function getSiteSlug() {
    return text(siteConfig.site && siteConfig.site.slug);
  }

  function getPageKey() {
    var body = document.body;
    return body ? text(body.getAttribute("data-curb-page-key")) || "index.html" : "index.html";
  }

  function getPreviewStorageNamespace() {
    return text(previewConfig.storageNamespace) || "curb-preview-admin";
  }

  function getPreviewStorageKey(suffix) {
    return getPreviewStorageNamespace() + ":" + getSiteSlug() + ":" + suffix;
  }

  function getPreviewSessionKey() {
    return getPreviewStorageKey("session");
  }

  function getPreviewQueryParam() {
    return text(previewConfig.queryParam) || "curb-preview-admin";
  }

  function isPreviewConfigured() {
    return !!(previewConfig && previewConfig.enabled && text(previewConfig.token));
  }

  function readStoredJson(key, fallback) {
    if (!hasLocalStorage()) {
      return fallback;
    }

    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw);
    } catch (error) {
      void error;
      return fallback;
    }
  }

  function activatePreviewSessionFromUrl() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      var url = new URL(window.location.href);
      var incomingToken = text(url.searchParams.get(getPreviewQueryParam()));
      if (incomingToken && incomingToken === text(previewConfig.token)) {
        window.localStorage.setItem(getPreviewSessionKey(), "active");
        url.searchParams.delete(getPreviewQueryParam());
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        return true;
      }
    } catch (error) {
      void error;
    }

    return hasPreviewSession();
  }

  function hasPreviewSession() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      return window.localStorage.getItem(getPreviewSessionKey()) === "active";
    } catch (error) {
      void error;
      return false;
    }
  }

  function readPreviewPageFields() {
    var fields = readStoredJson(getPreviewStorageKey("page:" + getPageKey()), {});
    return fields && typeof fields === "object" ? fields : {};
  }

  function readPreviewProducts() {
    var products = readStoredJson(getPreviewStorageKey("products"), []);
    return Array.isArray(products) ? products : [];
  }

  function applyFieldOverride(node, type, value) {
    if (!node || !value || typeof value !== "object") {
      return;
    }

    if (type === "text" || type === "textarea") {
      if (typeof value.value === "string") {
        node.textContent = value.value;
      }
      return;
    }

    if (type === "link") {
      if (typeof value.text === "string") {
        node.textContent = value.text;
      }
      if (typeof value.href === "string" && value.href.trim()) {
        node.setAttribute("href", value.href.trim());
      }
      return;
    }

    if (type === "image") {
      if (typeof value.src === "string" && value.src.trim()) {
        node.setAttribute("src", value.src.trim());
      }
      if (typeof value.alt === "string") {
        node.setAttribute("alt", value.alt);
      }
    }
  }

  function applyPageOverrides(fields) {
    Object.keys(fields || {}).forEach(function (key) {
      var node = document.querySelector('[data-curb-key="' + key + '"]');
      if (!node) {
        return;
      }

      var type = text(node.getAttribute("data-curb-type"));
      applyFieldOverride(node, type, fields[key]);
    });
  }

  function renderProducts(products) {
    var container = document.querySelector("[data-curb-products]");
    var emptyState = document.querySelector("[data-curb-products-empty]");
    if (!container) {
      return;
    }

    container.innerHTML = "";
    if (!products.length) {
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    products.forEach(function (product) {
      var card = document.createElement("article");
      card.className = "shop-card";
      var image = product.imageUrl
        ? '<img src="' + escapeHtml(product.imageUrl) + '" alt="' + escapeHtml(product.imageAlt || product.title || "Product") + '">'
        : "";
      card.innerHTML =
        image +
        '<div class="shop-card-body">' +
        '<h2>' + escapeHtml(product.title || "Untitled product") + '</h2>' +
        (product.description ? '<p>' + escapeHtml(product.description) + '</p>' : "") +
        (product.priceLabel ? '<p class="shop-card-price">' + escapeHtml(product.priceLabel) + '</p>' : "") +
        (product.checkoutUrl
          ? '<a href="' + escapeHtml(product.checkoutUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(product.actionLabel || "Buy now") + '</a>'
          : '<p>Set a checkout link in the owner portal to enable checkout.</p>') +
        "</div>";
      container.appendChild(card);
    });
  }

  function ensureShopLink() {
    if (!commerceConfig.enabled) {
      return;
    }

    var hasShopLink = document.querySelector('a[href*="shop"], a[href*="products"]');
    if (hasShopLink) {
      return;
    }

    var footer = document.querySelector("footer") || document.body;
    if (!footer) {
      return;
    }

    var body = document.body;
    var shopPath = body ? text(body.getAttribute("data-curb-shop-path")) : "";

    var wrapper = document.createElement("p");
    wrapper.style.marginTop = "1rem";
    wrapper.innerHTML = '<a href="' + (shopPath || text(commerceConfig.shopPath) || "./shop/") + '">Shop</a>';
    footer.appendChild(wrapper);
  }

  async function loadPageContent() {
    activatePreviewSessionFromUrl();

    if (hasPreviewSession()) {
      applyPageOverrides(readPreviewPageFields());
      ensureShopLink();
      return;
    }

    if (!cmsConfig.enabled || !hasFirebaseConfig()) {
      ensureShopLink();
      return;
    }

    var db = getDb();
    if (!db) {
      ensureShopLink();
      return;
    }

    try {
      var slug = getSiteSlug();
      if (!slug) {
        ensureShopLink();
        return;
      }

      var pageSnapshot = await db
        .collection("sites")
        .doc(slug)
        .collection("pages")
        .doc(getPageKey())
        .get();

      if (pageSnapshot.exists) {
        var data = pageSnapshot.data() || {};
        if (data.fields && typeof data.fields === "object") {
          applyPageOverrides(data.fields);
        }
      }

      ensureShopLink();
    } catch (error) {
      console.error("Failed to load managed page content", error);
      ensureShopLink();
    }
  }

  async function loadProducts() {
    activatePreviewSessionFromUrl();

    if (hasPreviewSession()) {
      renderProducts(readPreviewProducts());
      return;
    }

    if (!commerceConfig.enabled || !hasFirebaseConfig()) {
      return;
    }

    var container = document.querySelector("[data-curb-products]");
    if (!container) {
      return;
    }

    var db = getDb();
    if (!db) {
      return;
    }

    try {
      var slug = getSiteSlug();
      if (!slug) {
        return;
      }

      var snapshot = await db
        .collection("sites")
        .doc(slug)
        .collection("products")
        .orderBy("position")
        .get();

      var products = [];
      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        products.push(data);
      });
      renderProducts(products);
    } catch (error) {
      console.error("Failed to load managed products", error);
    }
  }

  function boot() {
    activatePreviewSessionFromUrl();
    loadPageContent();
    loadProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();`;
}

function buildAdminPackStyles(): string {
  return `:root {
  color-scheme: light;
  --admin-bg: #f4f7fb;
  --admin-panel: #ffffff;
  --admin-border: rgba(15, 23, 42, 0.08);
  --admin-text: #0f172a;
  --admin-muted: #475569;
  --admin-accent: #0f766e;
  --admin-danger: #b42318;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--admin-text);
  background: linear-gradient(180deg, #f8fafc, var(--admin-bg));
}
a { color: inherit; }
button, input, textarea, select {
  font: inherit;
}
.admin-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}
.admin-sidebar {
  background: #0f172a;
  color: #fff;
  padding: 1.5rem;
  display: grid;
  gap: 1.5rem;
}
.admin-sidebar p {
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.6;
  margin: 0;
}
.admin-main {
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
}
.admin-card {
  background: var(--admin-panel);
  border: 1px solid var(--admin-border);
  border-radius: 1.25rem;
  padding: 1.25rem;
  box-shadow: 0 16px 40px -30px rgba(15, 23, 42, 0.35);
}
.admin-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.admin-row > * {
  flex: 1 1 240px;
}
.admin-list {
  display: grid;
  gap: 0.5rem;
}
.admin-list button,
.admin-button {
  border: 1px solid var(--admin-border);
  background: var(--admin-panel);
  color: inherit;
  padding: 0.8rem 1rem;
  border-radius: 0.9rem;
  cursor: pointer;
}
.admin-button.primary {
  background: var(--admin-accent);
  color: #fff;
  border-color: transparent;
}
.admin-button.danger {
  background: #fff5f5;
  color: var(--admin-danger);
}
.admin-list button.active {
  background: rgba(15, 118, 110, 0.1);
  border-color: rgba(15, 118, 110, 0.3);
}
.admin-field {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.admin-field label {
  font-weight: 600;
}
.admin-field input,
.admin-field textarea {
  width: 100%;
  border: 1px solid var(--admin-border);
  border-radius: 0.85rem;
  padding: 0.85rem 0.95rem;
  background: #fff;
}
.admin-field textarea {
  min-height: 120px;
  resize: vertical;
}
.admin-settings-form {
  display: grid;
  gap: 0.75rem;
  min-width: min(24rem, 100%);
}
.admin-meta {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.admin-meta span {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: var(--admin-muted);
  font-size: 0.92rem;
}
.admin-status {
  color: var(--admin-muted);
  line-height: 1.6;
}
.admin-status.error {
  color: var(--admin-danger);
}
.admin-products {
  display: grid;
  gap: 1rem;
}
.admin-product-card {
  border: 1px solid var(--admin-border);
  border-radius: 1rem;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}
@media (max-width: 960px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }
}
`;
}

function buildAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Owner Portal</title>
    <link rel="stylesheet" href="../${ADMIN_PACK_STYLE_PATH}">
  </head>
  <body>
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div>
          <p class="admin-eyebrow">Customer-owned editor</p>
          <h1>Owner Portal</h1>
          <p>
            Sign in with the owner email. This portal edits the live Firebase
            content store without rebuilding the static site.
          </p>
        </div>
        <div class="admin-card">
          <div id="adminAuthPanel"></div>
        </div>
        <div class="admin-card">
          <p><strong>What this controls</strong></p>
          <p>Page copy, links, images, and product cards connected to direct checkout links.</p>
        </div>
      </aside>
      <main class="admin-main">
        <section class="admin-card">
          <div class="admin-row">
            <div>
              <h2 id="adminSiteTitle">Owner Portal</h2>
              <div id="adminMeta" class="admin-meta"></div>
            </div>
            <div>
              <p id="adminStatus" class="admin-status">Loading owner portal...</p>
            </div>
          </div>
        </section>

        <section class="admin-card">
          <div class="admin-row">
            <div>
              <h2>Store settings</h2>
              <p class="admin-status">
                Choose whether product checkout URLs point to Stripe or Shopify.
              </p>
            </div>
            <form id="adminCommerceForm" class="admin-settings-form">
              <div class="admin-field">
                <label for="adminCommerceProvider">Checkout provider</label>
                <select id="adminCommerceProvider" name="commerceProvider">
                  <option value="stripe-payment-links">Stripe Payment Links</option>
                  <option value="shopify">Shopify checkout links</option>
                </select>
              </div>
              <button class="admin-button primary" type="submit">Save store settings</button>
            </form>
          </div>
        </section>

        <section class="admin-card">
          <div class="admin-row">
            <div>
              <h2>Pages</h2>
              <div id="adminPageList" class="admin-list"></div>
            </div>
            <div>
              <h2 id="adminPageTitle">Page content</h2>
              <form id="adminPageForm"></form>
            </div>
          </div>
        </section>

        <section class="admin-card">
          <div class="admin-row">
            <div>
              <h2>Products</h2>
              <p class="admin-status">
                Use this only when the site includes the lightweight store pack.
              </p>
            </div>
            <div>
              <button id="adminAddProduct" class="admin-button primary" type="button">Add product</button>
            </div>
          </div>
          <div id="adminProducts" class="admin-products"></div>
        </section>
      </main>
    </div>

    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore-compat.js"></script>
    <script src="../assets/curb-site-config.js"></script>
    <script src="../${ADMIN_PACK_RUNTIME_PATH}"></script>
  </body>
</html>
`;
}

function buildAdminPackRuntime(schemaPath: string): string {
  return `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var authPanel = document.getElementById("adminAuthPanel");
  var statusNode = document.getElementById("adminStatus");
  var metaNode = document.getElementById("adminMeta");
  var siteTitleNode = document.getElementById("adminSiteTitle");
  var pageListNode = document.getElementById("adminPageList");
  var pageTitleNode = document.getElementById("adminPageTitle");
  var pageFormNode = document.getElementById("adminPageForm");
  var commerceFormNode = document.getElementById("adminCommerceForm");
  var commerceProviderInput = document.getElementById("adminCommerceProvider");
  var productsNode = document.getElementById("adminProducts");
  var addProductButton = document.getElementById("adminAddProduct");
  var schema = null;
  var db = null;
  var auth = null;
  var currentUser = null;
  var currentCommerceProvider = "none";
  var selectedPageKey = null;
  var previewSession = false;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCommerceProvider(value) {
    var normalized = text(value).toLowerCase();
    if (
      normalized === "stripe" ||
      normalized === "stripe-payment-links" ||
      normalized === "payment-links"
    ) {
      return "stripe-payment-links";
    }

    if (normalized === "shopify") {
      return "shopify";
    }

    return "none";
  }

  function configuredCommerceProvider() {
    if (!commerceConfig.enabled) {
      return "none";
    }

    var provider = normalizeCommerceProvider(commerceConfig.provider);
    return provider === "none" ? "stripe-payment-links" : provider;
  }

  function commerceProviderLabel(provider) {
    if (provider === "shopify") {
      return "Shopify checkout links";
    }

    if (provider === "stripe-payment-links") {
      return "Stripe Payment Links";
    }

    return "No store";
  }

  function checkoutUrlLabel(provider) {
    if (provider === "shopify") {
      return "Shopify product or checkout URL";
    }

    if (provider === "stripe-payment-links") {
      return "Stripe Payment Link";
    }

    return "Checkout URL";
  }

  function checkoutUrlPlaceholder(provider) {
    if (provider === "shopify") {
      return "https://your-store.myshopify.com/...";
    }

    if (provider === "stripe-payment-links") {
      return "https://buy.stripe.com/...";
    }

    return "https://...";
  }

  currentCommerceProvider = configuredCommerceProvider();

  function hasLocalStorage() {
    try {
      return typeof window.localStorage !== "undefined";
    } catch (error) {
      void error;
      return false;
    }
  }

  function setStatus(message, isError) {
    if (!statusNode) {
      return;
    }

    statusNode.textContent = message;
    statusNode.className = isError ? "admin-status error" : "admin-status";
  }

  function hasFirebaseConfig() {
    return !!(
      text(firebaseConfig.apiKey) &&
      text(firebaseConfig.authDomain) &&
      text(firebaseConfig.projectId) &&
      text(firebaseConfig.appId)
    );
  }

  function getSiteSlug() {
    return text(siteConfig.site && siteConfig.site.slug);
  }

  function getOwnerEmail() {
    return text(cmsConfig.ownerEmail || siteConfig.contact && siteConfig.contact.recipientEmail);
  }

  function getPreviewStorageNamespace() {
    return text(previewConfig.storageNamespace) || "curb-preview-admin";
  }

  function getPreviewStorageKey(suffix) {
    return getPreviewStorageNamespace() + ":" + getSiteSlug() + ":" + suffix;
  }

  function getPreviewSessionKey() {
    return getPreviewStorageKey("session");
  }

  function getPreviewQueryParam() {
    return text(previewConfig.queryParam) || "curb-preview-admin";
  }

  function isPreviewConfigured() {
    return !!(previewConfig && previewConfig.enabled && text(previewConfig.token));
  }

  function hasPreviewSession() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      return window.localStorage.getItem(getPreviewSessionKey()) === "active";
    } catch (error) {
      void error;
      return false;
    }
  }

  function activatePreviewSessionFromUrl() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      var url = new URL(window.location.href);
      var incomingToken = text(url.searchParams.get(getPreviewQueryParam()));
      if (incomingToken && incomingToken === text(previewConfig.token)) {
        window.localStorage.setItem(getPreviewSessionKey(), "active");
        url.searchParams.delete(getPreviewQueryParam());
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        return true;
      }
    } catch (error) {
      void error;
    }

    return hasPreviewSession();
  }

  function clearPreviewSession(removeData) {
    if (!hasLocalStorage()) {
      return;
    }

    try {
      var prefix = getPreviewStorageNamespace() + ":" + getSiteSlug() + ":";
      for (var index = window.localStorage.length - 1; index >= 0; index -= 1) {
        var key = window.localStorage.key(index);
        if (!key || key.indexOf(prefix) !== 0) {
          continue;
        }

        if (removeData || key === getPreviewSessionKey()) {
          window.localStorage.removeItem(key);
        }
      }
    } catch (error) {
      void error;
    }
  }

  function readStoredJson(key, fallback) {
    if (!hasLocalStorage()) {
      return fallback;
    }

    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw);
    } catch (error) {
      void error;
      return fallback;
    }
  }

  function writeStoredJson(key, value) {
    if (!hasLocalStorage()) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      void error;
    }
  }

  function previewPageStorageKey(pageKey) {
    return getPreviewStorageKey("page:" + pageKey);
  }

  function readPreviewPageFields(pageKey) {
    var fields = readStoredJson(previewPageStorageKey(pageKey), {});
    return fields && typeof fields === "object" ? fields : {};
  }

  function writePreviewPageFields(pageKey, fields) {
    writeStoredJson(previewPageStorageKey(pageKey), fields);
  }

  function readPreviewProducts() {
    var products = readStoredJson(getPreviewStorageKey("products"), []);
    return Array.isArray(products) ? products : [];
  }

  function writePreviewProducts(products) {
    writeStoredJson(getPreviewStorageKey("products"), products);
  }

  function readPreviewCommerceProvider() {
    var provider = normalizeCommerceProvider(
      readStoredJson(
        getPreviewStorageKey("commerce-provider"),
        configuredCommerceProvider()
      )
    );
    return provider === "none" ? configuredCommerceProvider() : provider;
  }

  function writePreviewCommerceProvider(provider) {
    writeStoredJson(getPreviewStorageKey("commerce-provider"), provider);
  }

  function upsertPreviewProduct(product) {
    var products = readPreviewProducts().filter(function (entry) {
      return entry && entry.id !== product.id;
    });
    products.push(product);
    products.sort(function (left, right) {
      return Number(left.position || 0) - Number(right.position || 0);
    });
    writePreviewProducts(products);
  }

  function deletePreviewProduct(productId) {
    writePreviewProducts(
      readPreviewProducts().filter(function (entry) {
        return entry && entry.id !== productId;
      })
    );
  }

  function initializeFirebase() {
    if (!window.firebase) {
      throw new Error("Firebase SDK failed to load.");
    }

    if (!hasFirebaseConfig()) {
      throw new Error("Add Firebase config values in assets/curb-site-config.js before using the owner portal.");
    }

    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp({
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        appId: firebaseConfig.appId,
        storageBucket: firebaseConfig.storageBucket || undefined,
        messagingSenderId: firebaseConfig.messagingSenderId || undefined
      });
    }

    auth = firebase.auth();
    db = firebase.firestore();
  }

  function renderAuthPanel() {
    if (!authPanel) {
      return;
    }

    if (previewSession) {
      authPanel.innerHTML =
        '<p class="admin-status">Preview session active. Changes stay in this browser and never touch customer data.</p>' +
        '<div class="admin-row">' +
        '<button id="exitPreviewButton" class="admin-button primary" type="button">Exit preview</button>' +
        '<button id="resetPreviewButton" class="admin-button" type="button">Reset preview data</button>' +
        "</div>";

      var exitPreviewButton = document.getElementById("exitPreviewButton");
      var resetPreviewButton = document.getElementById("resetPreviewButton");

      if (exitPreviewButton) {
        exitPreviewButton.addEventListener("click", function () {
          clearPreviewSession(false);
          window.location.reload();
        });
      }

      if (resetPreviewButton) {
        resetPreviewButton.addEventListener("click", function () {
          clearPreviewSession(true);
          window.location.reload();
        });
      }

      return;
    }

    var previewHint =
      !hasFirebaseConfig() && isPreviewConfigured()
        ? '<p class="admin-status">Open the dedicated Curb admin preview URL to unlock a browser-only demo session, or add Firebase config for live owner editing.</p>'
        : "";

    authPanel.innerHTML =
      previewHint +
      '<div class="admin-field">' +
      '<label for="ownerEmailInput">Owner email</label>' +
      '<input id="ownerEmailInput" type="email" placeholder="owner@example.com" value="' + escapeHtml(getOwnerEmail() || "") + '">' +
      "</div>" +
      '<div class="admin-row">' +
      '<button id="sendMagicLink" class="admin-button primary" type="button">Send sign-in link</button>' +
      '<button id="signOutButton" class="admin-button" type="button">Sign out</button>' +
      "</div>";

    var emailInput = document.getElementById("ownerEmailInput");
    var sendButton = document.getElementById("sendMagicLink");
    var signOutButton = document.getElementById("signOutButton");

    if (sendButton) {
      sendButton.addEventListener("click", function () {
        sendSignInLink(emailInput && emailInput.value ? emailInput.value : "");
      });
    }

    if (signOutButton) {
      signOutButton.addEventListener("click", async function () {
        if (!auth) {
          return;
        }

        await auth.signOut();
        currentUser = null;
        renderMeta();
        setStatus("Signed out. Send a new sign-in link to continue.", false);
      });
    }
  }

  async function sendSignInLink(email) {
    if (!auth) {
      return;
    }

    var normalizedEmail = text(email).toLowerCase();
    if (!normalizedEmail) {
      setStatus("Enter the owner email address before sending a sign-in link.", true);
      return;
    }

    try {
      await auth.sendSignInLinkToEmail(normalizedEmail, {
        url: window.location.origin + window.location.pathname,
        handleCodeInApp: true
      });
      window.localStorage.setItem("curb-owner-email", normalizedEmail);
      setStatus("Sign-in link sent. Open it from the same email inbox to access the owner portal.", false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send sign-in link.", true);
    }
  }

  async function finishEmailLinkSignIn() {
    if (!auth || !auth.isSignInWithEmailLink(window.location.href)) {
      return;
    }

    var email = window.localStorage.getItem("curb-owner-email") || window.prompt("Confirm your owner email");
    if (!email) {
      setStatus("Email sign-in could not be completed because no owner email was provided.", true);
      return;
    }

    try {
      await auth.signInWithEmailLink(email, window.location.href);
      window.localStorage.setItem("curb-owner-email", text(email).toLowerCase());
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to complete sign-in.", true);
    }
  }

  function siteRef() {
    return db.collection("sites").doc(getSiteSlug());
  }

  function pageRef(pageKey) {
    return siteRef().collection("pages").doc(pageKey);
  }

  function productsCollection() {
    return siteRef().collection("products");
  }

  function renderMeta() {
    if (!metaNode) {
      return;
    }

    if (previewSession) {
      metaNode.innerHTML =
        '<span>Preview session</span>' +
        '<span>Browser-only demo data</span>' +
        '<span>' + (commerceConfig.enabled ? commerceProviderLabel(currentCommerceProvider) : "CMS preview enabled") + '</span>';
      return;
    }

    metaNode.innerHTML =
      '<span>' + (currentUser && currentUser.email ? currentUser.email : "Signed out") + '</span>' +
      '<span>' + (cmsConfig.provider || "Firebase content pack") + '</span>' +
      '<span>' + (commerceConfig.enabled ? commerceProviderLabel(currentCommerceProvider) : "No store") + '</span>';
  }

  function renderCommerceForm() {
    if (!commerceFormNode || !commerceProviderInput) {
      return;
    }

    var disabled = !commerceConfig.enabled;
    var selectedProvider =
      currentCommerceProvider === "shopify"
        ? "shopify"
        : "stripe-payment-links";
    commerceProviderInput.disabled = disabled;
    commerceProviderInput.value = selectedProvider;

    var submitButton = commerceFormNode.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = disabled;
    }
  }

  async function ensureSiteAccess() {
    if (previewSession) {
      currentCommerceProvider = commerceConfig.enabled
        ? readPreviewCommerceProvider()
        : "none";
      renderCommerceForm();
      renderMeta();
      return;
    }

    var email = currentUser && currentUser.email ? currentUser.email.toLowerCase() : "";
    if (!email) {
      throw new Error("Owner email is not available on this Firebase user.");
    }

    var ref = siteRef();
    var snapshot = await ref.get();
    var configuredOwner = getOwnerEmail();

    if (!snapshot.exists) {
      await ref.set({
        businessName: text(siteConfig.businessName || siteConfig.site && siteConfig.site.businessName || ""),
        ownerEmail: configuredOwner || email,
        cmsProvider: text(cmsConfig.provider || "firebase-auth-firestore"),
        commerceProvider: commerceConfig.enabled
          ? configuredCommerceProvider()
          : "none",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      snapshot = await ref.get();
    }

    var data = snapshot.data() || {};
    var ownerEmail = text(data.ownerEmail).toLowerCase();
    if (ownerEmail && ownerEmail !== email) {
      throw new Error("This Firebase project is locked to a different owner email.");
    }

    currentCommerceProvider = commerceConfig.enabled
      ? normalizeCommerceProvider(data.commerceProvider || configuredCommerceProvider())
      : "none";
    if (currentCommerceProvider === "none" && commerceConfig.enabled) {
      currentCommerceProvider = configuredCommerceProvider();
    }
    renderCommerceForm();
    renderMeta();
  }

  async function loadSchema() {
    var response = await fetch("${schemaPath}", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load the CMS schema manifest.");
    }

    schema = await response.json();
    if (siteTitleNode) {
      siteTitleNode.textContent = schema.businessName + " Owner Portal";
    }
  }

  function renderPageList() {
    if (!pageListNode || !schema) {
      return;
    }

    pageListNode.innerHTML = "";
    schema.pages.forEach(function (page) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = page.title;
      if (page.pageKey === selectedPageKey) {
        button.classList.add("active");
      }
      button.addEventListener("click", function () {
        selectedPageKey = page.pageKey;
        renderPageList();
        loadPageForm(page.pageKey);
      });
      pageListNode.appendChild(button);
    });
  }

  function buildFieldInput(field, value) {
    var wrapper = document.createElement("div");
    wrapper.className = "admin-field";
    var label = document.createElement("label");
    label.textContent = field.label;
    wrapper.appendChild(label);

    if (field.type === "textarea") {
      var textarea = document.createElement("textarea");
      textarea.name = field.key;
      textarea.value = value && typeof value.value === "string" ? value.value : (field.defaultValue || "");
      wrapper.appendChild(textarea);
      return wrapper;
    }

    if (field.type === "link") {
      var textInput = document.createElement("input");
      textInput.name = field.key + "__text";
      textInput.value = value && typeof value.text === "string" ? value.text : (field.defaultValue || "");
      textInput.placeholder = "Link label";
      var hrefInput = document.createElement("input");
      hrefInput.name = field.key + "__href";
      hrefInput.value = value && typeof value.href === "string" ? value.href : (field.defaultHref || "");
      hrefInput.placeholder = "https://example.com";
      wrapper.appendChild(textInput);
      wrapper.appendChild(hrefInput);
      return wrapper;
    }

    if (field.type === "image") {
      var srcInput = document.createElement("input");
      srcInput.name = field.key + "__src";
      srcInput.value = value && typeof value.src === "string" ? value.src : (field.defaultValue || "");
      srcInput.placeholder = "Image URL or local path";
      var altInput = document.createElement("input");
      altInput.name = field.key + "__alt";
      altInput.value = value && typeof value.alt === "string" ? value.alt : (field.defaultAlt || "");
      altInput.placeholder = "Alt text";
      wrapper.appendChild(srcInput);
      wrapper.appendChild(altInput);
      return wrapper;
    }

    var input = document.createElement("input");
    input.name = field.key;
    input.value = value && typeof value.value === "string" ? value.value : (field.defaultValue || "");
    wrapper.appendChild(input);
    return wrapper;
  }

  async function loadPageForm(pageKey) {
    if (!pageFormNode || !schema) {
      return;
    }

    var page = schema.pages.find(function (entry) { return entry.pageKey === pageKey; });
    if (!page) {
      return;
    }

    pageTitleNode.textContent = page.title + " content";
    var values = {};
    if (previewSession) {
      values = readPreviewPageFields(pageKey);
    } else {
      var snapshot = await pageRef(pageKey).get();
      values = snapshot.exists && snapshot.data() && snapshot.data().fields ? snapshot.data().fields : {};
    }

    pageFormNode.innerHTML = "";
    page.fields.forEach(function (field) {
      pageFormNode.appendChild(buildFieldInput(field, values[field.key]));
    });

    var saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "admin-button primary";
    saveButton.textContent = "Save page changes";
    pageFormNode.appendChild(saveButton);

    pageFormNode.onsubmit = async function (event) {
      event.preventDefault();
      var formData = new FormData(pageFormNode);
      var nextFields = {};
      page.fields.forEach(function (field) {
        if (field.type === "link") {
          nextFields[field.key] = {
            text: String(formData.get(field.key + "__text") || "").trim(),
            href: String(formData.get(field.key + "__href") || "").trim()
          };
          return;
        }

        if (field.type === "image") {
          nextFields[field.key] = {
            src: String(formData.get(field.key + "__src") || "").trim(),
            alt: String(formData.get(field.key + "__alt") || "").trim()
          };
          return;
        }

        nextFields[field.key] = {
          value: String(formData.get(field.key) || "").trim()
        };
      });

      try {
        if (previewSession) {
          writePreviewPageFields(pageKey, nextFields);
          setStatus("Saved preview page changes for " + page.title + ".", false);
          return;
        }

        await pageRef(pageKey).set({
          fields: nextFields,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        setStatus("Saved page changes for " + page.title + ".", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to save page changes.", true);
      }
    };
  }

  function makeProductId(title) {
    var base = text(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return base || "product-" + Date.now().toString(36);
  }

  function buildProductCard(product) {
    var card = document.createElement("form");
    card.className = "admin-product-card";
    var checkoutLabel = checkoutUrlLabel(currentCommerceProvider);
    var checkoutPlaceholder = checkoutUrlPlaceholder(currentCommerceProvider);
    card.innerHTML =
      '<div class="admin-row">' +
      '<div class="admin-field"><label>Title</label><input name="title" value="' + escapeHtml(product.title || "") + '"></div>' +
      '<div class="admin-field"><label>Price label</label><input name="priceLabel" value="' + escapeHtml(product.priceLabel || "") + '" placeholder="$49"></div>' +
      '<div class="admin-field"><label>Position</label><input name="position" type="number" value="' + escapeHtml(product.position || 1) + '"></div>' +
      "</div>" +
      '<div class="admin-field"><label>Description</label><textarea name="description">' + escapeHtml(product.description || "") + '</textarea></div>' +
      '<div class="admin-row">' +
      '<div class="admin-field"><label>Image URL</label><input name="imageUrl" value="' + escapeHtml(product.imageUrl || "") + '"></div>' +
      '<div class="admin-field"><label>Image alt</label><input name="imageAlt" value="' + escapeHtml(product.imageAlt || "") + '"></div>' +
      "</div>" +
      '<div class="admin-row">' +
      '<div class="admin-field"><label>Button label</label><input name="actionLabel" value="' + escapeHtml(product.actionLabel || "Buy now") + '"></div>' +
      '<div class="admin-field"><label>' + escapeHtml(checkoutLabel) + '</label><input name="checkoutUrl" value="' + escapeHtml(product.checkoutUrl || "") + '" placeholder="' + escapeHtml(checkoutPlaceholder) + '"></div>' +
      "</div>" +
      '<div class="admin-row">' +
      '<button class="admin-button primary" type="submit">Save product</button>' +
      '<button class="admin-button danger" type="button" data-delete="true">Delete</button>' +
      "</div>";

    card.addEventListener("submit", async function (event) {
      event.preventDefault();
      var formData = new FormData(card);
      var title = String(formData.get("title") || "").trim();
      var id = product.id || makeProductId(title);
      var payload = {
        title: title,
        priceLabel: String(formData.get("priceLabel") || "").trim(),
        position: Number(formData.get("position") || 1),
        description: String(formData.get("description") || "").trim(),
        imageUrl: String(formData.get("imageUrl") || "").trim(),
        imageAlt: String(formData.get("imageAlt") || "").trim(),
        actionLabel: String(formData.get("actionLabel") || "").trim(),
        checkoutUrl: String(formData.get("checkoutUrl") || "").trim()
      };

      if (previewSession) {
        upsertPreviewProduct({
          id: id,
          title: payload.title,
          priceLabel: payload.priceLabel,
          position: payload.position,
          description: payload.description,
          imageUrl: payload.imageUrl,
          imageAlt: payload.imageAlt,
          actionLabel: payload.actionLabel,
          checkoutUrl: payload.checkoutUrl
        });
        setStatus("Saved preview product " + (title || id) + ".", false);
        loadProducts();
        return;
      }

      await productsCollection().doc(id).set({
        ...payload,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      setStatus("Saved product " + (title || id) + ".", false);
      loadProducts();
    });

    card.querySelector("[data-delete]").addEventListener("click", async function () {
      if (!product.id) {
        card.remove();
        return;
      }

      if (previewSession) {
        deletePreviewProduct(product.id);
        setStatus("Deleted preview product " + product.id + ".", false);
        loadProducts();
        return;
      }

      await productsCollection().doc(product.id).delete();
      setStatus("Deleted product " + product.id + ".", false);
      loadProducts();
    });

    return card;
  }

  async function loadProducts() {
    if (!productsNode) {
      return;
    }

    if (!commerceConfig.enabled) {
      if (addProductButton) {
        addProductButton.hidden = true;
      }
      productsNode.innerHTML = '<p class="admin-status">This site does not include the lightweight store pack.</p>';
      return;
    }

    if (addProductButton) {
      addProductButton.hidden = false;
    }

    productsNode.innerHTML = "";

    if (previewSession) {
      var previewProducts = readPreviewProducts();
      if (!previewProducts.length) {
        productsNode.innerHTML = '<p class="admin-status">No preview products have been added yet.</p>';
        return;
      }

      previewProducts.forEach(function (product) {
        productsNode.appendChild(buildProductCard(product));
      });
      return;
    }

    var snapshot = await productsCollection().orderBy("position").get();
    if (snapshot.empty) {
      productsNode.innerHTML = '<p class="admin-status">No products have been added yet.</p>';
    }

    snapshot.forEach(function (doc) {
      var data = doc.data() || {};
      data.id = doc.id;
      productsNode.appendChild(buildProductCard(data));
    });
  }

  function bindAddProduct() {
    if (!addProductButton || !productsNode) {
      return;
    }

    addProductButton.addEventListener("click", function () {
      productsNode.appendChild(buildProductCard({ title: "", priceLabel: "", actionLabel: "Buy now", position: 1 }));
    });
  }

  function bindCommerceForm() {
    if (!commerceFormNode || !commerceProviderInput) {
      return;
    }

    commerceFormNode.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!commerceConfig.enabled) {
        setStatus("This site does not include the lightweight store pack.", true);
        return;
      }

      var nextProvider = normalizeCommerceProvider(commerceProviderInput.value);
      if (nextProvider === "none") {
        setStatus("Choose Stripe or Shopify for product checkout links.", true);
        return;
      }

      if (previewSession) {
        currentCommerceProvider = nextProvider;
        writePreviewCommerceProvider(nextProvider);
        renderCommerceForm();
        renderMeta();
        await loadProducts();
        setStatus("Saved preview store settings.", false);
        return;
      }

      if (!currentUser) {
        setStatus("Sign in before updating store settings.", true);
        return;
      }

      await siteRef().set({
        commerceProvider: nextProvider,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      currentCommerceProvider = nextProvider;
      renderCommerceForm();
      renderMeta();
      await loadProducts();
      setStatus("Saved store settings.", false);
    });
  }

  async function bootAfterLogin() {
    await ensureSiteAccess();
    await loadSchema();
    selectedPageKey = schema.pages[0] ? schema.pages[0].pageKey : null;
    renderPageList();
    if (selectedPageKey) {
      await loadPageForm(selectedPageKey);
    } else if (pageFormNode) {
      pageFormNode.innerHTML = '<p class="admin-status">No editable fields were discovered in the generated pages.</p>';
    }
    await loadProducts();
    setStatus(previewSession ? "Preview owner portal ready." : "Owner portal ready.", false);
  }

  async function boot() {
    try {
      previewSession = activatePreviewSessionFromUrl();
      currentCommerceProvider = previewSession
        ? readPreviewCommerceProvider()
        : configuredCommerceProvider();
      renderAuthPanel();
      renderCommerceForm();
      bindAddProduct();
      bindCommerceForm();

      if (previewSession) {
        setStatus("Loading preview admin...", false);
        await bootAfterLogin();
        return;
      }

      if (!hasFirebaseConfig()) {
        setStatus(
          isPreviewConfigured()
            ? "Open the Curb admin preview URL for a browser-only demo, or add Firebase config to enable live owner editing."
            : "Add Firebase config values in assets/curb-site-config.js before using the owner portal.",
          true
        );
        return;
      }

      initializeFirebase();
      renderAuthPanel();
      await finishEmailLinkSignIn();
      auth.onAuthStateChanged(async function (user) {
        currentUser = user || null;
        if (!user) {
          setStatus("Send a sign-in link to the owner email to begin editing.", false);
          return;
        }

        try {
          setStatus("Loading customer-owned content...", false);
          await bootAfterLogin();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Failed to load owner portal.", true);
        }
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Owner portal failed to start.", true);
    }
  }

  boot();
})();`;
}

function buildCmsSchemaFile(schema: CmsSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function buildManagedSupportFiles(
  context: ManagedSiteContext,
  cmsSchema: CmsSchema
): StaticSiteFile[] {
  const supportFiles: StaticSiteFile[] = [
    {
      path: CMS_SCHEMA_PATH,
      content: buildCmsSchemaFile(cmsSchema),
    },
    {
      path: PUBLIC_PACK_RUNTIME_PATH,
      content: `${buildPublicPackRuntime()}\n`,
    },
    {
      path: HANDOFF_README_PATH,
      content: buildHandoffReadme(context),
    },
    {
      path: HANDOFF_FIREBASE_CONFIG_PATH,
      content: buildFirebaseJson(),
    },
    {
      path: HANDOFF_FIRESTORE_RULES_PATH,
      content: buildFirestoreRules(),
    },
    {
      path: HANDOFF_FIRESTORE_INDEXES_PATH,
      content: buildFirestoreIndexes(),
    },
    {
      path: HANDOFF_OWNERSHIP_PATH,
      content: buildOwnerSetupGuide(context),
    },
  ];

  if (includeCmsPack(context.siteCapabilityProfile)) {
    supportFiles.push(
      {
        path: ADMIN_PACK_RUNTIME_PATH,
        content: `${buildAdminPackRuntime(relativeHrefBetweenFiles(ADMIN_PAGE_PATH, CMS_SCHEMA_PATH))}\n`,
      },
      {
        path: ADMIN_PACK_STYLE_PATH,
        content: `${buildAdminPackStyles()}\n`,
      },
      {
        path: ADMIN_PAGE_PATH,
        content: buildAdminPage(),
      }
    );
  }

  if (includeStorePack(context.siteCapabilityProfile)) {
    supportFiles.push(
      {
        path: STORE_PAGE_PATH,
        content: createStorePageMarkup(context.businessName, STORE_PAGE_PATH),
      },
      {
        path: STORE_ALIAS_PATH,
        content: createStoreAliasPage(),
      }
    );
  }

  return supportFiles;
}

export function prepareManagedSiteBundle(
  inputFiles: StaticSiteFile[],
  context: ManagedSiteContext
): ManagedSiteBundle {
  if (
    !includeCmsPack(context.siteCapabilityProfile) &&
    !includeStorePack(context.siteCapabilityProfile)
  ) {
    return {
      files: inputFiles,
      cmsSchema: null,
    };
  }

  const filesByPath = new Map<string, StaticSiteFile>();
  const pages: CmsPageSchema[] = [];

  for (const inputFile of inputFiles) {
    if (!/\.html$/i.test(inputFile.path) || inputFile.path.startsWith("admin/")) {
      filesByPath.set(inputFile.path, inputFile);
      continue;
    }

    if (
      inputFile.path === STORE_PAGE_PATH ||
      inputFile.path === STORE_ALIAS_PATH
    ) {
      filesByPath.set(inputFile.path, inputFile);
      continue;
    }

    const annotated = annotateManagedHtmlFile(
      inputFile,
      includeStorePack(context.siteCapabilityProfile)
        ? relativeHrefBetweenFiles(inputFile.path, STORE_PAGE_PATH)
        : null
    );
    filesByPath.set(annotated.file.path, annotated.file);
    pages.push(annotated.page);
  }

  const cmsSchema = buildCmsSchema(context, pages);
  for (const supportFile of buildManagedSupportFiles(context, cmsSchema)) {
    filesByPath.set(supportFile.path, supportFile);
  }

  return {
    files: Array.from(filesByPath.values()),
    cmsSchema,
  };
}
