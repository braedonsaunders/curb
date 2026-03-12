import fs from "node:fs";
import path from "node:path";

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

export interface CmsCollectionFieldSchema extends CmsFieldSchema {
  role?:
    | "title"
    | "subtitle"
    | "tag"
    | "details"
    | "author"
    | "source"
    | "date"
    | "time"
    | "link"
    | "image";
}

export interface CmsCollectionSchema {
  key: string;
  label: string;
  kind: "generic" | "events" | "services" | "reviews" | "menu" | "team";
  itemLabel: string;
  itemNameFieldKey?: string;
  itemTemplateHtml: string;
  fields: CmsCollectionFieldSchema[];
}

export interface CmsPageSchema {
  pageKey: string;
  path: string;
  title: string;
  fields: CmsFieldSchema[];
  collections?: CmsCollectionSchema[];
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
export const PRODUCTS_DATA_PATH = "assets/curb-products.json";
export const PUBLIC_PACK_RUNTIME_PATH = "assets/curb-public-pack.js";
export const ADMIN_PACK_RUNTIME_PATH = "assets/curb-admin-pack.js";
export const ADMIN_PACK_STYLE_PATH = "assets/curb-admin-pack.css";
export const ADMIN_VENDOR_STYLE_PATH = "assets/vendor/tabler.min.css";
export const ADMIN_VENDOR_SCRIPT_PATH = "assets/vendor/tabler.min.js";
export const ADMIN_PAGE_PATH = "admin/index.html";
export const ADMIN_ACCESS_PAGE_PATH = "admin/access/index.html";
export const ADMIN_CONTENT_PAGE_PATH = "admin/content/index.html";
export const ADMIN_STORE_PAGE_PATH = "admin/store/index.html";
export const ADMIN_PRODUCTS_PAGE_PATH = "admin/products/index.html";
export const STORE_PAGE_PATH = "shop/index.html";
export const STORE_ALIAS_PATH = "products/index.html";
export const HANDOFF_README_PATH = "handoff/README.md";
export const HANDOFF_FIREBASE_CONFIG_PATH = "handoff/firebase.json";
export const HANDOFF_FIRESTORE_RULES_PATH = "handoff/firestore.rules";
export const HANDOFF_FIRESTORE_INDEXES_PATH =
  "handoff/firestore.indexes.json";
export const HANDOFF_OWNERSHIP_PATH = "handoff/OWNER_SETUP.md";

type SiteErrorPageSpec = {
  path: string;
  statusCode: number;
  title: string;
  message: string;
};

const STANDARD_ERROR_PAGES: SiteErrorPageSpec[] = [
  {
    path: "401.html",
    statusCode: 401,
    title: "Sign-in required",
    message: "This page needs valid access before it can be viewed.",
  },
  {
    path: "403.html",
    statusCode: 403,
    title: "Access restricted",
    message: "This page is unavailable with the permissions currently in use.",
  },
  {
    path: "404.html",
    statusCode: 404,
    title: "Page not found",
    message: "The page you requested could not be found in this site.",
  },
  {
    path: "500.html",
    statusCode: 500,
    title: "Something went wrong",
    message: "An unexpected error prevented this page from loading correctly.",
  },
  {
    path: "503.html",
    statusCode: 503,
    title: "Temporarily unavailable",
    message: "This page is unavailable right now. Please try again shortly.",
  },
];

const MAX_TEXT_FIELDS_PER_PAGE = 24;
const MAX_LINK_FIELDS_PER_PAGE = 12;
const MAX_IMAGE_FIELDS_PER_PAGE = 12;
const MAX_COLLECTIONS_PER_PAGE = 6;
const MAX_COLLECTION_FIELDS_PER_ITEM = 5;
const TABLER_DIST_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@tabler",
  "core",
  "dist"
);
const vendorAssetCache = new Map<string, string>();
type AdminView = "overview" | "access" | "content" | "store" | "products";
type HtmlDoc = ReturnType<typeof load>;
type HtmlNode = ReturnType<HtmlDoc>;

function readVendorAsset(relativePath: string): string {
  const cached = vendorAssetCache.get(relativePath);
  if (cached) {
    return cached;
  }

  const assetPath = path.resolve(TABLER_DIST_DIR, relativePath);
  const content = fs.readFileSync(assetPath, "utf8");
  vendorAssetCache.set(relativePath, content);
  return content;
}

function relativeHrefForIndexPage(fromFilePath: string, toFilePath: string): string {
  const href = relativeHrefBetweenFiles(fromFilePath, toFilePath);

  if (href === "index.html") {
    return ".";
  }

  if (href.endsWith("/index.html")) {
    return href.slice(0, -"index.html".length);
  }

  return href;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const COLLECTION_CONTAINER_HINT_RE =
  /(grid|cards?|list|items?|features?|services?|reviews?|testimonials?|events?|schedule|lineup|menu|team|members?|staff|offerings?|highlights?|packages?|pricing|plans|faq|questions)/i;
const COLLECTION_EXCLUDED_HINT_RE =
  /(nav|navigation|header|footer|breadcrumbs?|pagination|social|toolbar|filters?|tabs?|accordion|form|actions?)/i;
const COLLECTION_ITEM_HINT_RE =
  /(card|item|service|review|testimonial|member|team|event|schedule|menu|feature|plan|package|faq|question|story|info|highlight)/i;
const EVENT_HINT_RE = /(event|events|schedule|lineup|calendar|music|show|gig)/i;
const SERVICE_HINT_RE =
  /(service|services|offering|offerings|repair|repairs|treatment|treatments)/i;
const REVIEW_HINT_RE = /(review|reviews|testimonial|testimonials|quote|quotes)/i;
const MENU_HINT_RE = /(menu|dish|food|drink|drinks|special|specials)/i;
const TEAM_HINT_RE = /(team|staff|member|members|people|crew)/i;
const FAQ_HINT_RE = /(faq|question|questions)/i;
const TAG_HINT_RE =
  /(tag|label|eyebrow|kicker|badge|pill|category|overline|meta|price)/i;
const AUTHOR_HINT_RE = /(author|byline)/i;
const SOURCE_HINT_RE = /(source|company|location|venue)/i;
const SUBTITLE_HINT_RE = /(subtitle|subheading|role|position|location|venue|price)/i;
const MEDIA_HINT_RE = /(image|media|photo|thumb|logo|avatar|artwork|icon|emoji)/i;
const HEADER_LOGO_CONTEXT_RE =
  /(header|nav|navbar|masthead|topbar|top-bar|brand|logo|wordmark)/i;
const HEADER_LOGO_EXCLUDED_RE =
  /(footer|sidebar|drawer|offcanvas|modal|dialog|popup|banner-ad|ad-)/i;
const HEADER_LOGO_ASSET_RE = /(source-logo|logo|brand|wordmark)/i;
const DATE_TEXT_RE =
  /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b\d{1,2}(?:st|nd|rd|th)?\b/i;
const TIME_TEXT_RE =
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:noon|midnight)\b/i;
const DECORATIVE_TEXT_RE = /^[^A-Za-z0-9]+$/;
const ITEM_CLASS_NOISE_RE = /^(?:reveal|rd\d+|wow|animate(?:__\w+)?|aos-\w+|active|current|selected|open)$/i;
const SHARED_TOKEN_IGNORE_RE =
  /^(?:container|grid|list|cards?|items?|content|wrapper|inner|row|column|col)$/i;

type CollectionFieldCandidate = {
  node: HtmlNode;
  key: string;
  label: string;
  type: CmsCollectionFieldSchema["type"];
  role?: CmsCollectionFieldSchema["role"];
  defaultValue?: string;
  defaultHref?: string;
  defaultAlt?: string;
};

function clearExistingCmsFieldAnnotations($: HtmlDoc): void {
  $("[data-curb-key], [data-curb-type]").each((_, element) => {
    const node = $(element);
    node.removeAttr("data-curb-key");
    node.removeAttr("data-curb-type");
  });
}

function getNodeHint(node: HtmlNode): string {
  return [
    node.attr("class"),
    node.attr("id"),
    node.attr("data-section"),
    node.attr("aria-label"),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stripCmsAnnotationAttributes(node: HtmlNode): void {
  node.removeAttr("data-curb-key");
  node.removeAttr("data-curb-type");
  node.removeAttr("data-curb-collection-field");
  node.removeAttr("data-curb-collection-field-type");
}

function clearCollectionFieldValue(
  node: HtmlNode,
  fieldType: CmsCollectionFieldSchema["type"]
): void {
  if (fieldType === "link") {
    node.text("");
    node.attr("href", "");
    return;
  }

  if (fieldType === "image") {
    node.attr("src", "");
    node.attr("alt", "");
    return;
  }

  node.text("");
}

function isWithinMediaBlock(node: HtmlNode, item: HtmlNode): boolean {
  const itemElement = item.get(0);
  let mediaAncestor: unknown = null;
  const ancestors = node.parents();

  for (let index = 0; index < ancestors.length; index += 1) {
    const ancestorNode = ancestors.eq(index);
    const ancestor = ancestorNode.get(0);
    if (ancestor === itemElement) {
      break;
    }

    if (MEDIA_HINT_RE.test(getNodeHint(ancestorNode))) {
      mediaAncestor = ancestor;
      break;
    }
  }

  return Boolean(mediaAncestor);
}

function normalizeClassTokens(node: HtmlNode): string[] {
  return normalizeText(node.attr("class"))
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(
      (token) =>
        token.length > 1 &&
        !ITEM_CLASS_NOISE_RE.test(token) &&
        !/^\d+$/.test(token)
    );
}

function getTagName(node: HtmlNode): string {
  const element = node.get(0);
  if (!element || !("tagName" in element) || typeof element.tagName !== "string") {
    return "";
  }

  return element.tagName.toLowerCase();
}

function inferCollectionKind(
  containerHint: string
): CmsCollectionSchema["kind"] {
  if (EVENT_HINT_RE.test(containerHint)) {
    return "events";
  }

  if (SERVICE_HINT_RE.test(containerHint)) {
    return "services";
  }

  if (REVIEW_HINT_RE.test(containerHint)) {
    return "reviews";
  }

  if (MENU_HINT_RE.test(containerHint)) {
    return "menu";
  }

  if (TEAM_HINT_RE.test(containerHint)) {
    return "team";
  }

  return "generic";
}

function inferCollectionLabels(
  kind: CmsCollectionSchema["kind"],
  containerHint: string
): Pick<CmsCollectionSchema, "label" | "itemLabel"> {
  if (kind === "events") {
    return { label: "Events", itemLabel: "Event" };
  }

  if (kind === "services") {
    return { label: "Services", itemLabel: "Service" };
  }

  if (kind === "reviews") {
    return { label: "Reviews", itemLabel: "Review" };
  }

  if (kind === "menu") {
    return { label: "Highlights", itemLabel: "Item" };
  }

  if (kind === "team") {
    return { label: "Team", itemLabel: "Member" };
  }

  if (FAQ_HINT_RE.test(containerHint)) {
    return { label: "Questions", itemLabel: "Question" };
  }

  return { label: "Items", itemLabel: "Item" };
}

function buildCollectionTemplateHtml(
  item: HtmlNode,
  fields: CmsCollectionFieldSchema[]
): string {
  const template = item.clone();
  template.attr("data-curb-collection-item-id", "__new__");

  for (const field of fields) {
    const fieldNode = template
      .find(`[data-curb-collection-field="${field.key}"]`)
      .first();
    if (!fieldNode.length) {
      continue;
    }

    clearCollectionFieldValue(fieldNode, field.type);
  }

  return template.toString();
}

function isNodeInEditableContext(node: HtmlNode, item: HtmlNode): boolean {
  if (node.parents("script,style,svg,button,label").length > 0) {
    return false;
  }

  if (MEDIA_HINT_RE.test(getNodeHint(node))) {
    return false;
  }

  if (node.attr("aria-hidden") === "true") {
    return false;
  }

  if (isWithinMediaBlock(node, item)) {
    return false;
  }

  const text = normalizeText(node.text());
  if (!text || text.length < 2 || DECORATIVE_TEXT_RE.test(text)) {
    return false;
  }

  return true;
}

function findMeaningfulTextNodes(item: HtmlNode): HtmlNode[] {
  const selector =
    "h1,h2,h3,h4,h5,h6,p,blockquote,cite,a[href],span,small,div,li,strong,em";
  const candidates: HtmlNode[] = [];
  const foundNodes = item.find(selector);

  foundNodes.each((index) => {
    const node = foundNodes.eq(index);
    if (!isNodeInEditableContext(node, item)) {
      return;
    }

    candidates.push(node);
  });

  return candidates.filter((node, index) => {
    const element = node.get(0);
    if (!element) {
      return false;
    }

    return !candidates.some((other, otherIndex) => {
      if (otherIndex === index) {
        return false;
      }

      const otherElement = other.get(0);
      if (!otherElement) {
        return false;
      }

      return (
        other.parents().toArray().some((ancestor) => ancestor === element) &&
        otherElement !== element
      );
    });
  });
}

function inferFieldTypeForTextNode(
  node: HtmlNode,
  text: string
): "text" | "textarea" {
  const tagName = getTagName(node);
  if (
    text.length > 120 ||
    tagName === "p" ||
    tagName === "blockquote" ||
    tagName === "li"
  ) {
    return "textarea";
  }

  return "text";
}

function buildCollectionFieldCandidate(
  node: HtmlNode,
  kind: CmsCollectionSchema["kind"],
  existingRoles: Set<string>,
  fallbackIndex: number
): CollectionFieldCandidate | null {
  const tagName = getTagName(node);
  const hint = getNodeHint(node);
  const text = normalizeText(node.text());

  if (
    tagName === "a" &&
    !existingRoles.has("link") &&
    !shouldIgnoreLink(String(node.attr("href") ?? "").trim())
  ) {
    return {
      node,
      key: "link",
      label: "Link",
      type: "link",
      role: "link",
      defaultValue: text,
      defaultHref: String(node.attr("href") ?? "").trim(),
    };
  }

  if (/^h[1-6]$/.test(tagName) && !existingRoles.has("title")) {
    return {
      node,
      key: "title",
      label:
        kind === "events"
          ? "Event name"
          : kind === "services"
            ? "Service name"
            : kind === "team"
              ? "Name"
              : "Title",
      type: "text",
      role: "title",
      defaultValue: text,
    };
  }

  if (
    (kind === "events" || /date/.test(hint)) &&
    !existingRoles.has("date") &&
    DATE_TEXT_RE.test(text)
  ) {
    return {
      node,
      key: "date",
      label: "Date",
      type: "text",
      role: "date",
      defaultValue: text,
    };
  }

  if (
    (kind === "events" || /time/.test(hint)) &&
    !existingRoles.has("time") &&
    TIME_TEXT_RE.test(text)
  ) {
    return {
      node,
      key: "time",
      label: "Time",
      type: "text",
      role: "time",
      defaultValue: text,
    };
  }

  if (!existingRoles.has("tag") && TAG_HINT_RE.test(hint)) {
    return {
      node,
      key: "tag",
      label: "Tag",
      type: "text",
      role: "tag",
      defaultValue: text,
    };
  }

  if (
    kind === "reviews" &&
    !existingRoles.has("author") &&
    (AUTHOR_HINT_RE.test(hint) || /^[-—–]/.test(text))
  ) {
    return {
      node,
      key: "author",
      label: "Author",
      type: "text",
      role: "author",
      defaultValue: text.replace(/^[-—–]\s*/, ""),
    };
  }

  if (
    kind === "reviews" &&
    !existingRoles.has("source") &&
    SOURCE_HINT_RE.test(hint)
  ) {
    return {
      node,
      key: "source",
      label: "Source",
      type: "text",
      role: "source",
      defaultValue: text,
    };
  }

  if (!existingRoles.has("title") && text.length <= 80) {
    return {
      node,
      key: "title",
      label:
        kind === "team"
          ? "Name"
          : kind === "events"
            ? "Event name"
            : "Title",
      type: "text",
      role: "title",
      defaultValue: text,
    };
  }

  if (
    !existingRoles.has("subtitle") &&
    (SUBTITLE_HINT_RE.test(hint) || (text.length <= 80 && tagName !== "p"))
  ) {
    return {
      node,
      key: "subtitle",
      label: kind === "team" ? "Role" : "Subtitle",
      type: "text",
      role: "subtitle",
      defaultValue: text,
    };
  }

  if (!existingRoles.has("details")) {
    return {
      node,
      key: "details",
      label: kind === "reviews" ? "Quote" : "Description",
      type: inferFieldTypeForTextNode(node, text),
      role: "details",
      defaultValue: text,
    };
  }

  return {
    node,
    key: `text-${fallbackIndex}`,
    label: `Text ${fallbackIndex}`,
    type: inferFieldTypeForTextNode(node, text),
    defaultValue: text,
  };
}

function extractCollectionFieldCandidates(
  item: HtmlNode,
  kind: CmsCollectionSchema["kind"]
): CollectionFieldCandidate[] {
  const candidates: CollectionFieldCandidate[] = [];
  const existingRoles = new Set<string>();
  const imageNode = item.find("img[src]").first();

  if (imageNode.length) {
    candidates.push({
      node: imageNode,
      key: "image",
      label: "Image",
      type: "image",
      role: "image",
      defaultValue: String(imageNode.attr("src") ?? "").trim(),
      defaultAlt: normalizeText(imageNode.attr("alt")),
    });
    existingRoles.add("image");
  }

  const textNodes = findMeaningfulTextNodes(item);
  let fallbackIndex = 1;

  for (const node of textNodes) {
    if (candidates.length >= MAX_COLLECTION_FIELDS_PER_ITEM) {
      break;
    }

    const candidate = buildCollectionFieldCandidate(
      node,
      kind,
      existingRoles,
      fallbackIndex
    );

    if (!candidate) {
      continue;
    }

    candidates.push(candidate);
    existingRoles.add(candidate.role ?? candidate.key);
    fallbackIndex += 1;
  }

  return candidates;
}

function mapCollectionCandidatesToFields(
  candidates: CollectionFieldCandidate[],
  fields: CmsCollectionFieldSchema[]
): Array<{ field: CmsCollectionFieldSchema; node: HtmlNode | null }> {
  const remaining = [...candidates];

  return fields.map((field) => {
    let matchIndex = remaining.findIndex(
      (candidate) => candidate.role && candidate.role === field.role
    );

    if (matchIndex < 0) {
      matchIndex = remaining.findIndex((candidate) => candidate.type === field.type);
    }

    if (matchIndex < 0) {
      matchIndex = 0;
    }

    const match =
      matchIndex >= 0 && matchIndex < remaining.length
        ? remaining.splice(matchIndex, 1)[0]
        : null;

    return {
      field,
      node: match?.node ?? null,
    };
  });
}

function isSimpleLinkListItem(item: HtmlNode): boolean {
  const directLink = item.children("a[href]").first();
  if (!directLink.length || item.find("img, h1, h2, h3, h4, h5, h6, p, blockquote").length) {
    return false;
  }

  return normalizeText(item.text()) === normalizeText(directLink.text());
}

function findCollectionItemNodes(container: HtmlNode): HtmlNode[] {
  const directChildren = container.children("article,div,li,section");
  const children: HtmlNode[] = [];

  directChildren.each((index) => {
    const item = directChildren.eq(index);
    if (!normalizeText(item.text()) && item.find("img[src]").length === 0) {
      return;
    }

    children.push(item);
  });

  if (children.length < 2 || children.length > 18) {
    return [];
  }

  if (children.every((item) => isSimpleLinkListItem(item))) {
    return [];
  }

  const sharedTokens = children.reduce<string[] | null>((common, item) => {
    const tokens = normalizeClassTokens(item);
    if (!common) {
      return tokens;
    }

    return common.filter((token) => tokens.includes(token));
  }, null);
  const containerHint = getNodeHint(container);
  const sharedItemTokens =
    sharedTokens?.filter(
      (token) =>
        !SHARED_TOKEN_IGNORE_RE.test(token) &&
        COLLECTION_ITEM_HINT_RE.test(token)
    ) ?? [];

  if (
    !container.is("ul,ol") &&
    sharedItemTokens.length === 0 &&
    !(
      COLLECTION_CONTAINER_HINT_RE.test(containerHint) &&
      children.length >= 3
    )
  ) {
    return [];
  }

  return children;
}

function detectStructuredCollections($: HtmlDoc): CmsCollectionSchema[] {
  $(
    "[data-curb-collection], [data-curb-collection-item], [data-curb-collection-item-id], [data-curb-collection-field], [data-curb-collection-field-type]"
  ).each((_, element) => {
    const node = $(element);
    node.removeAttr("data-curb-collection");
    node.removeAttr("data-curb-collection-item");
    node.removeAttr("data-curb-collection-item-id");
    node.removeAttr("data-curb-collection-field");
    node.removeAttr("data-curb-collection-field-type");
  });

  const collections: CmsCollectionSchema[] = [];
  let collectionIndex = 0;
  const claimedElements = new Set<unknown>();

  $("section, div, ul, ol").each((_, element) => {
    const container = $(element);
    const containerElement = container.get(0);
    const containerHint = getNodeHint(container);

    if (
      container.parents("header,nav,footer,form").length > 0 ||
      claimedElements.has(containerElement)
    ) {
      return;
    }

    if (
      COLLECTION_EXCLUDED_HINT_RE.test(containerHint) &&
      !COLLECTION_CONTAINER_HINT_RE.test(containerHint)
    ) {
      return;
    }

    const items = findCollectionItemNodes(container);
    if (items.length < 2 || collections.length >= MAX_COLLECTIONS_PER_PAGE) {
      return;
    }

    if (items.some((item) => item.parents("[data-curb-collection-item]").length > 0)) {
      return;
    }

    const kind = inferCollectionKind(
      `${containerHint} ${getNodeHint(items[0])}`.trim()
    );
    const fieldCandidates = extractCollectionFieldCandidates(items[0], kind);
    if (fieldCandidates.length < 2) {
      return;
    }

    const fields: CmsCollectionFieldSchema[] = fieldCandidates.map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      type: candidate.type,
      role: candidate.role,
      defaultValue: candidate.defaultValue,
      defaultHref: candidate.defaultHref,
      defaultAlt: candidate.defaultAlt,
    }));

    if (fields.length < 2) {
      return;
    }

    collectionIndex += 1;
    const collectionKey = `collection-${collectionIndex}`;
    const labels = inferCollectionLabels(kind, containerHint);
    container.attr("data-curb-collection", collectionKey);

    items.forEach((item, itemIndex) => {
      item.attr("data-curb-collection-item", collectionKey);
      item.attr("data-curb-collection-item-id", `${collectionKey}-item-${itemIndex + 1}`);

      const itemCandidates = extractCollectionFieldCandidates(item, kind);
      const fieldNodes = mapCollectionCandidatesToFields(itemCandidates, fields);
      fieldNodes.forEach(({ field, node }) => {
        if (!node?.length) {
          return;
        }

        stripCmsAnnotationAttributes(node);
        node.attr("data-curb-collection-field", field.key);
        node.attr("data-curb-collection-field-type", field.type);
      });
    });

    claimedElements.add(containerElement);
    items.forEach((item) => claimedElements.add(item.get(0)));

    collections.push({
      key: collectionKey,
      label: labels.label,
      kind,
      itemLabel: labels.itemLabel,
      itemNameFieldKey:
        fields.find((field) => field.role === "title")?.key ??
        fields.find((field) => field.role === "author")?.key ??
        fields[0]?.key,
      itemTemplateHtml: buildCollectionTemplateHtml(items[0], fields),
      fields,
    });
  });

  return collections;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildStandardErrorPage(
  businessName: string,
  spec: SiteErrorPageSpec
): string {
  const homeHref = relativeHrefForIndexPage(spec.path, "index.html");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(String(spec.statusCode))} | ${escapeHtml(
      businessName
    )}</title>
    <meta name="robots" content="noindex">
    <style>
      :root {
        color-scheme: light;
        --error-bg: #f6f4ef;
        --error-surface: rgba(255, 255, 255, 0.92);
        --error-border: rgba(15, 23, 42, 0.09);
        --error-text: #1f2937;
        --error-muted: #6b7280;
        --error-accent: #d1d5db;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.85), transparent 38%),
          linear-gradient(180deg, #fbfaf8 0%, var(--error-bg) 100%);
        color: var(--error-text);
      }

      main {
        width: min(100%, 34rem);
      }

      .error-shell {
        background: var(--error-surface);
        border: 1px solid var(--error-border);
        border-radius: 1.4rem;
        padding: 1.75rem;
        box-shadow: 0 22px 55px -40px rgba(15, 23, 42, 0.35);
        backdrop-filter: blur(10px);
      }

      .error-code {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 4.25rem;
        min-height: 2rem;
        padding: 0.35rem 0.8rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(15, 23, 42, 0.08);
        color: var(--error-muted);
        font-size: 0.84rem;
        font-weight: 600;
        letter-spacing: 0.08em;
      }

      h1 {
        margin: 1rem 0 0;
        font-size: clamp(1.8rem, 4vw, 2.5rem);
        letter-spacing: -0.03em;
      }

      p {
        margin: 0.9rem 0 0;
        color: var(--error-muted);
        line-height: 1.65;
        font-size: 1rem;
      }

      .error-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: 1.4rem;
      }

      .error-actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.85rem;
        padding: 0.8rem 1rem;
        border-radius: 999px;
        border: 1px solid var(--error-accent);
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.86);
      }

      .error-actions a:hover {
        background: #fff;
      }

      .error-footnote {
        margin-top: 1.25rem;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="error-shell" aria-labelledby="error-title">
        <div class="error-code">${escapeHtml(String(spec.statusCode))}</div>
        <h1 id="error-title">${escapeHtml(spec.title)}</h1>
        <p>${escapeHtml(spec.message)}</p>
        <div class="error-actions">
          <a href="${escapeHtml(homeHref)}">Back to homepage</a>
        </div>
        <p class="error-footnote">${escapeHtml(
          businessName
        )} static site preview</p>
      </section>
    </main>
  </body>
</html>
`;
}

function buildStandardErrorPageFiles(
  context: ManagedSiteContext
): StaticSiteFile[] {
  return STANDARD_ERROR_PAGES.map((spec) => ({
    path: spec.path,
    content: buildStandardErrorPage(context.businessName, spec),
  }));
}

function buildHeaderLogoAdjustmentStyle(): string {
  return `<style data-curb-header-logo-style="true">
img[data-curb-header-logo="true"] {
  display: block;
  width: auto !important;
  height: clamp(46px, 5vw, 60px) !important;
  max-width: min(320px, 42vw) !important;
  max-height: 60px !important;
  object-fit: contain;
  object-position: left center;
}

@media (max-width: 720px) {
  img[data-curb-header-logo="true"] {
    height: clamp(38px, 9vw, 52px) !important;
    max-width: min(68vw, 240px) !important;
    max-height: 52px !important;
  }
}
</style>`;
}

function collectAncestorHint(node: HtmlNode, depth = 5): string {
  const ancestors = node.parents();
  const parts: string[] = [];

  for (let index = 0; index < Math.min(depth, ancestors.length); index += 1) {
    const ancestor = ancestors.eq(index);
    parts.push(getTagName(ancestor), getNodeHint(ancestor));
  }

  return parts.filter(Boolean).join(" ").toLowerCase();
}

function scoreHeaderLogoCandidate(node: HtmlNode): number {
  const src = normalizeText(node.attr("src")).toLowerCase();
  if (!src) {
    return Number.NEGATIVE_INFINITY;
  }

  const hint = [getNodeHint(node), collectAncestorHint(node)].join(" ").toLowerCase();
  let score = 0;

  if (HEADER_LOGO_ASSET_RE.test(src)) {
    score += src.includes("source-logo") ? 22 : 12;
  }

  if (HEADER_LOGO_CONTEXT_RE.test(hint)) {
    score += 18;
  }

  if (hint.includes("header") || hint.includes("nav") || hint.includes("navbar")) {
    score += 18;
  }

  if (hint.includes("logo") || hint.includes("brand") || hint.includes("wordmark")) {
    score += 12;
  }

  if (HEADER_LOGO_EXCLUDED_RE.test(hint)) {
    score -= 40;
  }

  return score;
}

function normalizePrimaryHeaderLogo(file: StaticSiteFile): StaticSiteFile {
  if (!/\.html$/i.test(file.path) || file.path.startsWith("admin/")) {
    return file;
  }

  const $ = load(file.content);
  const candidates = $("img[src]")
    .toArray()
    .map((element) => $(element))
    .map((node) => ({
      node,
      score: scoreHeaderLogoCandidate(node),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 28)
    .sort((left, right) => right.score - left.score);

  const primaryLogo = candidates[0]?.node;
  if (!primaryLogo || primaryLogo.attr("data-curb-header-logo") === "true") {
    return file;
  }

  primaryLogo.attr("data-curb-header-logo", "true");

  if ($('style[data-curb-header-logo-style="true"]').length === 0) {
    const head = $("head").first();
    if (head.length > 0) {
      head.append(`\n${buildHeaderLogoAdjustmentStyle()}`);
    } else {
      $("html").prepend(buildHeaderLogoAdjustmentStyle());
    }
  }

  return {
    ...file,
    content: ensureDoctype(file.content, $.html()),
  };
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

function isWithinStructuredCollection(node: HtmlNode): boolean {
  return (
    node.attr("data-curb-collection-field") !== undefined ||
    node.parents("[data-curb-collection-item]").length > 0
  );
}

export function annotateManagedHtmlFile(
  file: StaticSiteFile,
  shopHref: string | null
): { file: StaticSiteFile; page: CmsPageSchema } {
  const $ = load(file.content);
  clearExistingCmsFieldAnnotations($);
  const title = normalizeText($("title").first().text()) || pathToPageTitle(file.path);
  const body = $("body").first();
  if (body.length > 0) {
    body.attr("data-curb-page-key", file.path);
    if (shopHref) {
      body.attr("data-curb-shop-path", shopHref);
    }
  }

  const collections = detectStructuredCollections($);
  const fields: CmsFieldSchema[] = [];
  let textIndex = 0;
  let linkIndex = 0;
  let imageIndex = 0;

  $("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, element) => {
    if (textIndex >= MAX_TEXT_FIELDS_PER_PAGE) {
      return;
    }

    const node = $(element);
    if (node.attr("data-curb-key") || isWithinStructuredCollection(node)) {
      return;
    }

    const text = normalizeText(node.text());
    if (!text || text.length < 3) {
      return;
    }

    const key = `text-${textIndex + 1}`;
    const labelBase = getTagName(node).toUpperCase() || "TEXT";
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
    if (node.attr("data-curb-key") || isWithinStructuredCollection(node)) {
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
    if (node.attr("data-curb-key") || isWithinStructuredCollection(node)) {
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
      collections: collections.length > 0 ? collections : undefined,
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
  const productsRuntimeHref = relativeHrefBetweenFiles(
    PUBLIC_PACK_RUNTIME_PATH,
    PRODUCTS_DATA_PATH
  );

  return `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var runtimeBaseUrl = (function () {
    try {
      var currentScript = document.currentScript;
      return currentScript && currentScript.src ? currentScript.src : window.location.href;
    } catch (error) {
      void error;
      return window.location.href;
    }
  })();
  var productsFilePath = "${productsRuntimeHref}";
  var productsFileUrl = (function () {
    try {
      return new URL(productsFilePath, runtimeBaseUrl).toString();
    } catch (error) {
      void error;
      return productsFilePath;
    }
  })();
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

  async function loadStaticProducts() {
    try {
      var response = await fetch(productsFileUrl, { cache: "no-store" });
      if (!response.ok) {
        return false;
      }

      var products = await response.json();
      if (!Array.isArray(products)) {
        return false;
      }

      renderProducts(products);
      return true;
    } catch (error) {
      void error;
      return false;
    }
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

    var container = document.querySelector("[data-curb-products]");
    if (!container) {
      return;
    }

    if (await loadStaticProducts()) {
      return;
    }

    if (!commerceConfig.enabled || !hasFirebaseConfig()) {
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

function buildProductsDataFile(): string {
  return "[]\n";
}

function buildAdminVendorStyle(): string {
  return `${readVendorAsset("css/tabler.min.css")}\n`;
}

function buildAdminVendorScript(): string {
  return `${readVendorAsset("js/tabler.min.js")}\n`;
}

function buildAdminPackStyles(): string {
  return `:root {
  color-scheme: light;
}

body {
  background: var(--tblr-bg-surface-secondary);
}

.page {
  min-height: 100vh;
}

.navbar-vertical .navbar-brand > a {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
}

#adminMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

#adminMeta .badge {
  font-weight: 600;
}

.admin-page-list .list-group-item {
  text-align: left;
}

.admin-page-list .list-group-item.active {
  z-index: 1;
}

.admin-empty-state {
  padding: 1rem;
  border: 1px dashed var(--tblr-border-color);
  border-radius: var(--tblr-border-radius-lg);
  color: var(--tblr-secondary);
  background: var(--tblr-bg-surface);
}

.page-header-actions {
  display: flex;
  justify-content: flex-end;
}

.admin-empty-state-cell {
  padding: 1rem !important;
}

.admin-product-row-active td {
  background: var(--tblr-primary-lt);
}

.btn-list.flex-nowrap {
  flex-wrap: nowrap;
}

@media (max-width: 991.98px) {
  .page-header .card {
    margin-top: 0.5rem;
  }
}
`;
}

function buildAdminPage(pagePath: string, view: AdminView): string {
  const navLinks = {
    overview: relativeHrefForIndexPage(pagePath, ADMIN_PAGE_PATH),
    access: relativeHrefForIndexPage(pagePath, ADMIN_ACCESS_PAGE_PATH),
    content: relativeHrefForIndexPage(pagePath, ADMIN_CONTENT_PAGE_PATH),
    store: relativeHrefForIndexPage(pagePath, ADMIN_STORE_PAGE_PATH),
    products: relativeHrefForIndexPage(pagePath, ADMIN_PRODUCTS_PAGE_PATH),
  };

  const navItems: Array<{ key: AdminView; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "access", label: "Access" },
    { key: "content", label: "Content" },
    { key: "store", label: "Store settings" },
    { key: "products", label: "Products" },
  ];

  const navMarkup = navItems
    .map((item) => {
      const activeClass = item.key === view ? " active" : "";
      return `
              <li class="nav-item">
                <a class="nav-link${activeClass}" href="${navLinks[item.key]}">
                  <span class="nav-link-title">${item.label}</span>
                </a>
              </li>`;
    })
    .join("");

  const pageTitle =
    view === "overview"
      ? "Overview"
      : view === "access"
        ? "Access"
        : view === "content"
          ? "Content"
          : view === "store"
            ? "Store settings"
            : "Products";

  const pageSubtitle =
    view === "overview"
      ? "Serious admin workspace for the generated owner portal."
      : view === "access"
        ? "Preview access and owner sign-in controls."
        : view === "content"
          ? "Edit generated page content one page at a time."
          : view === "store"
            ? "Control checkout provider and store behavior."
            : "Manage products from a proper table and editor.";

  const primaryAction =
    view === "products"
      ? `
              <div class="page-header-actions">
                <button id="adminAddProduct" class="btn btn-primary" type="button">
                  Add product
                </button>
              </div>`
      : "";

  const overviewBody = `
            <div class="row row-cards">
              <div class="col-sm-6 col-xl-4">
                <div class="card">
                  <div class="card-body">
                    <div class="text-uppercase small fw-bold text-secondary">Pages</div>
                    <div class="mt-2 display-6" id="adminPageCount">-</div>
                    <div class="text-secondary">Editable generated pages detected.</div>
                  </div>
                  <div class="card-footer">
                    <a class="btn btn-outline-primary w-100" href="${navLinks.content}">
                      Open content editor
                    </a>
                  </div>
                </div>
              </div>
              <div class="col-sm-6 col-xl-4">
                <div class="card">
                  <div class="card-body">
                    <div class="text-uppercase small fw-bold text-secondary">Store mode</div>
                    <div class="mt-2 h2 mb-1" id="adminStoreProvider">Loading...</div>
                    <div class="text-secondary">Checkout configuration for lightweight commerce.</div>
                  </div>
                  <div class="card-footer">
                    <a class="btn btn-outline-primary w-100" href="${navLinks.store}">
                      Open store settings
                    </a>
                  </div>
                </div>
              </div>
              <div class="col-sm-6 col-xl-4">
                <div class="card">
                  <div class="card-body">
                    <div class="text-uppercase small fw-bold text-secondary">Products</div>
                    <div class="mt-2 display-6" id="adminProductCount">-</div>
                    <div class="text-secondary">Products available in the owner-managed catalog.</div>
                  </div>
                  <div class="card-footer">
                    <a class="btn btn-outline-primary w-100" href="${navLinks.products}">
                      Open products
                    </a>
                  </div>
                </div>
              </div>
              <div class="col-12 col-xl-5">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Access</h3>
                  </div>
                  <div class="card-body">
                    <p class="text-secondary mb-3">
                      Preview mode stays local. Firebase mode lets the owner sign
                      in and edit live content safely.
                    </p>
                    <div id="adminAuthPanel"></div>
                  </div>
                </div>
              </div>
              <div class="col-12 col-xl-7">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Admin sections</h3>
                  </div>
                  <div class="list-group list-group-flush">
                    <a class="list-group-item list-group-item-action" href="${navLinks.access}">
                      <div class="fw-medium">Access</div>
                      <div class="text-secondary">Preview session controls and owner sign-in.</div>
                    </a>
                    <a class="list-group-item list-group-item-action" href="${navLinks.content}">
                      <div class="fw-medium">Content</div>
                      <div class="text-secondary">Page-by-page editing for generated content fields.</div>
                    </a>
                    <a class="list-group-item list-group-item-action" href="${navLinks.store}">
                      <div class="fw-medium">Store settings</div>
                      <div class="text-secondary">Stripe vs Shopify checkout configuration.</div>
                    </a>
                    <a class="list-group-item list-group-item-action" href="${navLinks.products}">
                      <div class="fw-medium">Products</div>
                      <div class="text-secondary">Product table and dedicated editor.</div>
                    </a>
                  </div>
                </div>
              </div>
            </div>`;

  const accessBody = `
            <div class="row row-cards">
              <div class="col-12 col-xl-6">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Portal access</h3>
                  </div>
                  <div class="card-body">
                    <p class="text-secondary mb-3">
                      Use preview mode for browser-only demos, or send a
                      passwordless sign-in link to the owner when Firebase is configured.
                    </p>
                    <div id="adminAuthPanel"></div>
                  </div>
                </div>
              </div>
              <div class="col-12 col-xl-6">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">How this works</h3>
                  </div>
                  <div class="list-group list-group-flush">
                    <div class="list-group-item">
                      <div class="fw-medium">Preview mode</div>
                      <div class="text-secondary">Use the Curb preview admin URL to unlock a browser-only demo session.</div>
                    </div>
                    <div class="list-group-item">
                      <div class="fw-medium">Live owner mode</div>
                      <div class="text-secondary">Add Firebase config and send the owner a sign-in link.</div>
                    </div>
                    <div class="list-group-item">
                      <div class="fw-medium">Security boundary</div>
                      <div class="text-secondary">Preview data stays in the browser. Live edits write to the configured customer project.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

  const contentBody = `
            <div class="row row-cards">
              <div class="col-12 col-xl-4">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Pages</h3>
                  </div>
                  <div class="card-body">
                    <div id="adminPageList" class="list-group list-group-flush admin-page-list"></div>
                  </div>
                </div>
              </div>
              <div class="col-12 col-xl-8">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 id="adminPageTitle" class="card-title">Page content</h3>
                  </div>
                  <div class="card-body">
                    <form id="adminPageForm"></form>
                  </div>
                </div>
              </div>
            </div>`;

  const storeBody = `
            <div class="row row-cards">
              <div class="col-12 col-xl-6">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Checkout provider</h3>
                  </div>
                  <div class="card-body">
                    <p class="text-secondary mb-3">
                      Choose whether product checkout URLs point to Stripe Payment Links or Shopify.
                    </p>
                    <form id="adminCommerceForm">
                      <div class="row g-3 align-items-end">
                        <div class="col-sm-8">
                          <label for="adminCommerceProvider" class="form-label">Checkout provider</label>
                          <select id="adminCommerceProvider" name="commerceProvider" class="form-select">
                            <option value="stripe-payment-links">Stripe Payment Links</option>
                            <option value="shopify">Shopify checkout links</option>
                          </select>
                        </div>
                        <div class="col-sm-4">
                          <button class="btn btn-primary w-100" type="submit">Save settings</button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
              <div class="col-12 col-xl-6">
                <div class="card h-100">
                  <div class="card-header">
                    <h3 class="card-title">Current configuration</h3>
                  </div>
                  <div class="list-group list-group-flush">
                    <div class="list-group-item">
                      <div class="text-uppercase small fw-bold text-secondary">Active provider</div>
                      <div class="mt-1 fw-medium" id="adminStoreProvider">Loading...</div>
                    </div>
                    <div class="list-group-item">
                      <div class="fw-medium">Intent</div>
                      <div class="text-secondary">This setting changes how product checkout links are treated across the generated site.</div>
                    </div>
                    <div class="list-group-item">
                      <div class="fw-medium">Next step</div>
                      <div class="text-secondary">Use the products page to manage catalog rows and checkout URLs.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

  const productsBody = `
            <div class="row row-cards">
              <div class="col-12">
                <div class="card">
                  <div class="card-header">
                    <h3 class="card-title">Catalog</h3>
                  </div>
                  <div class="table-responsive">
                    <table class="table table-vcenter card-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Price</th>
                          <th>Checkout</th>
                          <th>Position</th>
                          <th class="w-1"></th>
                        </tr>
                      </thead>
                      <tbody id="adminProducts"></tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div class="col-12">
                <div class="card">
                  <div class="card-header">
                    <h3 id="adminProductFormTitle" class="card-title">Product editor</h3>
                  </div>
                  <div class="card-body">
                    <form id="adminProductForm"></form>
                  </div>
                </div>
              </div>
            </div>`;

  const bodyContent =
    view === "overview"
      ? overviewBody
      : view === "access"
        ? accessBody
        : view === "content"
          ? contentBody
          : view === "store"
            ? storeBody
            : productsBody;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Owner Portal</title>
    <link rel="stylesheet" href="${relativeHrefBetweenFiles(pagePath, ADMIN_VENDOR_STYLE_PATH)}">
    <link rel="stylesheet" href="${relativeHrefBetweenFiles(pagePath, ADMIN_PACK_STYLE_PATH)}">
  </head>
  <body>
    <div class="page">
      <aside class="navbar navbar-vertical navbar-expand-lg navbar-dark" data-bs-theme="dark">
        <div class="container-fluid">
          <button
            class="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#sidebar-menu"
            aria-controls="sidebar-menu"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span class="navbar-toggler-icon"></span>
          </button>
          <h1 class="navbar-brand navbar-brand-autodark pe-0">
            <a href="${navLinks.overview}">
              <span class="avatar avatar-sm bg-primary-lt text-primary fw-bold rounded-3">C</span>
              <span class="d-flex flex-column lh-sm">
                <span class="fw-bold text-white">Curb Owner</span>
                <span class="small text-secondary">Static site admin</span>
              </span>
            </a>
          </h1>
          <div class="collapse navbar-collapse" id="sidebar-menu">
            <ul class="navbar-nav pt-lg-3">
${navMarkup}
            </ul>
            <div class="mt-auto pt-lg-4">
              <div class="card card-sm bg-primary-lt">
                <div class="card-body">
                  <div class="text-uppercase small fw-bold text-secondary mb-2">
                    Editable surface
                  </div>
                  <div class="text-secondary">
                    Separate admin pages for access, content, store settings, and products.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div class="page-wrapper">
        <div class="page-header d-print-none">
          <div class="container-xl">
            <div class="row g-3 align-items-start">
              <div class="col">
                <div class="page-pretitle">Owner portal</div>
                <h2 id="adminSiteTitle" class="page-title">${pageTitle}</h2>
                <div class="text-secondary mt-1">${pageSubtitle}</div>
                <div id="adminMeta" class="mt-3"></div>
              </div>
              <div class="col-12 col-lg-auto">
                ${primaryAction}
                <div class="card card-sm mt-3 mt-lg-0">
                  <div class="card-body">
                    <div class="text-uppercase small fw-bold text-secondary">
                      Portal status
                    </div>
                    <p id="adminStatus" class="text-secondary mb-0 mt-2">
                      Loading owner portal...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="page-body">
          <div class="container-xl">
${bodyContent}
          </div>
        </div>
      </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore-compat.js"></script>
    <script src="${relativeHrefBetweenFiles(pagePath, "assets/curb-site-config.js")}"></script>
    <script src="${relativeHrefBetweenFiles(pagePath, ADMIN_VENDOR_SCRIPT_PATH)}"></script>
    <script src="${relativeHrefBetweenFiles(pagePath, ADMIN_PACK_RUNTIME_PATH)}"></script>
  </body>
</html>
`;
}

function buildAdminPackRuntime(): string {
  const schemaRuntimeHref = relativeHrefBetweenFiles(
    ADMIN_PACK_RUNTIME_PATH,
    CMS_SCHEMA_PATH
  );

  return `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var authPanel = document.getElementById("adminAuthPanel");
  var statusNode = document.getElementById("adminStatus");
  var metaNode = document.getElementById("adminMeta");
  var pageListNode = document.getElementById("adminPageList");
  var pageTitleNode = document.getElementById("adminPageTitle");
  var pageFormNode = document.getElementById("adminPageForm");
  var commerceFormNode = document.getElementById("adminCommerceForm");
  var commerceProviderInput = document.getElementById("adminCommerceProvider");
  var productsNode = document.getElementById("adminProducts");
  var productFormNode = document.getElementById("adminProductForm");
  var productFormTitleNode = document.getElementById("adminProductFormTitle");
  var addProductButton = document.getElementById("adminAddProduct");
  var pageCountNode = document.getElementById("adminPageCount");
  var productCountNode = document.getElementById("adminProductCount");
  var storeProviderNode = document.getElementById("adminStoreProvider");
  var NEW_PRODUCT_ID = "__new__";
  var runtimeBaseUrl = (function () {
    try {
      var currentScript = document.currentScript;
      return currentScript && currentScript.src ? currentScript.src : window.location.href;
    } catch (error) {
      void error;
      return window.location.href;
    }
  })();
  var schemaPath = "${schemaRuntimeHref}";
  var schemaUrl = (function () {
    try {
      return new URL(schemaPath, runtimeBaseUrl).toString();
    } catch (error) {
      void error;
      return schemaPath;
    }
  })();
  var schema = null;
  var db = null;
  var auth = null;
  var currentUser = null;
  var currentCommerceProvider = "none";
  var selectedPageKey = null;
  var selectedProductId = null;
  var loadedProducts = [];
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
    statusNode.className = isError ? "text-danger mb-0 mt-2" : "text-secondary mb-0 mt-2";
  }

  function badgeMarkup(label, tone) {
    return '<span class="badge bg-' + tone + '-lt text-' + tone + '">' + escapeHtml(label) + "</span>";
  }

  function emptyStateMarkup(message) {
    return '<div class="admin-empty-state">' + escapeHtml(message) + "</div>";
  }

  function emptyStateRowMarkup(message, colspan) {
    return '<tr><td class="admin-empty-state-cell" colspan="' + String(colspan) + '">' + emptyStateMarkup(message) + "</td></tr>";
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

  function sortProducts(products) {
    return products.slice().sort(function (left, right) {
      var positionDelta = Number(left && left.position || 0) - Number(right && right.position || 0);
      if (positionDelta !== 0) {
        return positionDelta;
      }

      return text(left && left.title).localeCompare(text(right && right.title));
    });
  }

  function readPreviewProducts() {
    var products = readStoredJson(getPreviewStorageKey("products"), []);
    return Array.isArray(products) ? sortProducts(products) : [];
  }

  function writePreviewProducts(products) {
    writeStoredJson(getPreviewStorageKey("products"), sortProducts(products));
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
        '<div class="alert alert-azure" role="alert">Preview session active. Changes stay in this browser and never touch customer data.</div>' +
        '<div class="d-grid gap-2">' +
        '<button id="exitPreviewButton" class="btn btn-primary" type="button">Exit preview</button>' +
        '<button id="resetPreviewButton" class="btn btn-outline-secondary" type="button">Reset preview data</button>' +
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
        ? '<div class="alert alert-warning" role="alert">Open the dedicated Curb admin preview URL to unlock a browser-only demo session, or add Firebase config for live owner editing.</div>'
        : "";

    authPanel.innerHTML =
      previewHint +
      '<div class="mb-3">' +
      '<label for="ownerEmailInput" class="form-label">Owner email</label>' +
      '<input id="ownerEmailInput" class="form-control" type="email" placeholder="owner@example.com" value="' + escapeHtml(getOwnerEmail() || "") + '">' +
      "</div>" +
      '<div class="d-grid gap-2">' +
      '<button id="sendMagicLink" class="btn btn-primary" type="button">Send sign-in link</button>' +
      '<button id="signOutButton" class="btn btn-outline-secondary" type="button">Sign out</button>' +
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
        badgeMarkup("Preview session", "azure") +
        badgeMarkup("Browser-only demo data", "blue") +
        badgeMarkup(
          commerceConfig.enabled
            ? commerceProviderLabel(currentCommerceProvider)
            : "CMS preview enabled",
          "green"
        );
      return;
    }

    metaNode.innerHTML =
      badgeMarkup(currentUser && currentUser.email ? currentUser.email : "Signed out", "blue") +
      badgeMarkup(cmsConfig.provider || "Firebase content pack", "purple") +
      badgeMarkup(
        commerceConfig.enabled ? commerceProviderLabel(currentCommerceProvider) : "No store",
        "green"
      );
  }

  function renderStoreProviderSummary() {
    if (!storeProviderNode) {
      return;
    }

    storeProviderNode.textContent = commerceProviderLabel(currentCommerceProvider);
  }

  function setPageCountSummary() {
    if (!pageCountNode) {
      return;
    }

    pageCountNode.textContent =
      schema && Array.isArray(schema.pages) ? String(schema.pages.length) : "0";
  }

  function setProductCountSummary(count) {
    if (!productCountNode) {
      return;
    }

    productCountNode.textContent = String(count);
  }

  function renderCommerceForm() {
    renderStoreProviderSummary();

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
    var response = await fetch(schemaUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load the CMS schema manifest.");
    }

    schema = await response.json();
    document.title = schema.businessName + " Owner Portal";
    setPageCountSummary();
  }

  function renderPageList() {
    if (!pageListNode || !schema) {
      return;
    }

    if (!schema.pages.length) {
      pageListNode.innerHTML = emptyStateMarkup("No editable pages were discovered.");
      return;
    }

    pageListNode.innerHTML = "";
    schema.pages.forEach(function (page) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "list-group-item list-group-item-action";
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
    wrapper.className = "mb-3";
    var label = document.createElement("label");
    label.className = "form-label";
    label.textContent = field.label;
    wrapper.appendChild(label);

    if (field.type === "textarea") {
      var textarea = document.createElement("textarea");
      textarea.className = "form-control";
      textarea.rows = 5;
      textarea.name = field.key;
      textarea.value = value && typeof value.value === "string" ? value.value : (field.defaultValue || "");
      wrapper.appendChild(textarea);
      return wrapper;
    }

    if (field.type === "link") {
      var textInput = document.createElement("input");
      textInput.className = "form-control";
      textInput.name = field.key + "__text";
      textInput.value = value && typeof value.text === "string" ? value.text : (field.defaultValue || "");
      textInput.placeholder = "Link label";
      var hrefInput = document.createElement("input");
      hrefInput.className = "form-control mt-2";
      hrefInput.name = field.key + "__href";
      hrefInput.value = value && typeof value.href === "string" ? value.href : (field.defaultHref || "");
      hrefInput.placeholder = "https://example.com";
      wrapper.appendChild(textInput);
      wrapper.appendChild(hrefInput);
      return wrapper;
    }

    if (field.type === "image") {
      var srcInput = document.createElement("input");
      srcInput.className = "form-control";
      srcInput.name = field.key + "__src";
      srcInput.value = value && typeof value.src === "string" ? value.src : (field.defaultValue || "");
      srcInput.placeholder = "Image URL or local path";
      var altInput = document.createElement("input");
      altInput.className = "form-control mt-2";
      altInput.name = field.key + "__alt";
      altInput.value = value && typeof value.alt === "string" ? value.alt : (field.defaultAlt || "");
      altInput.placeholder = "Alt text";
      wrapper.appendChild(srcInput);
      wrapper.appendChild(altInput);
      return wrapper;
    }

    var input = document.createElement("input");
    input.className = "form-control";
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

    if (pageTitleNode) {
      pageTitleNode.textContent = page.title + " content";
    }

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
    saveButton.className = "btn btn-primary";
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

  function normalizePosition(value, fallback) {
    var parsed = Number(value);
    if (!isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.max(1, Math.round(parsed));
  }

  function nextProductPosition() {
    var highestPosition = 0;
    loadedProducts.forEach(function (product) {
      highestPosition = Math.max(
        highestPosition,
        normalizePosition(product && product.position, 0)
      );
    });
    return highestPosition + 1;
  }

  function makeProductId(title) {
    var base = text(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return base || "product-" + Date.now().toString(36);
  }

  function makeUniqueProductId(baseId, existingId) {
    var candidate = baseId || "product-" + Date.now().toString(36);
    var suffix = 2;
    while (loadedProducts.some(function (product) {
      return product && product.id === candidate && product.id !== existingId;
    })) {
      candidate = baseId + "-" + String(suffix);
      suffix += 1;
    }
    return candidate;
  }

  function buildProductDraft(product) {
    return {
      id: product && product.id ? product.id : "",
      title: product && typeof product.title === "string" ? product.title : "",
      priceLabel: product && typeof product.priceLabel === "string" ? product.priceLabel : "",
      position: normalizePosition(
        product && product.position,
        nextProductPosition()
      ),
      description: product && typeof product.description === "string" ? product.description : "",
      imageUrl: product && typeof product.imageUrl === "string" ? product.imageUrl : "",
      imageAlt: product && typeof product.imageAlt === "string" ? product.imageAlt : "",
      actionLabel: product && typeof product.actionLabel === "string" && product.actionLabel
        ? product.actionLabel
        : "Buy now",
      checkoutUrl: product && typeof product.checkoutUrl === "string" ? product.checkoutUrl : ""
    };
  }

  function findSelectedProduct() {
    if (!selectedProductId || selectedProductId === NEW_PRODUCT_ID) {
      return null;
    }

    return loadedProducts.find(function (product) {
      return product && product.id === selectedProductId;
    }) || null;
  }

  function syncSelectedProduct() {
    if (!commerceConfig.enabled) {
      selectedProductId = null;
      return;
    }

    if (!loadedProducts.length) {
      selectedProductId = NEW_PRODUCT_ID;
      return;
    }

    if (selectedProductId === NEW_PRODUCT_ID) {
      return;
    }

    var selectedProduct = findSelectedProduct();
    if (!selectedProduct) {
      selectedProductId = loadedProducts[0].id;
    }
  }

  function renderProductTable() {
    if (!productsNode) {
      return;
    }

    if (!commerceConfig.enabled) {
      productsNode.innerHTML = emptyStateRowMarkup(
        "This site does not include the lightweight store pack.",
        5
      );
      return;
    }

    if (!loadedProducts.length) {
      productsNode.innerHTML = emptyStateRowMarkup(
        previewSession
          ? "No preview products have been added yet."
          : "No products have been added yet.",
        5
      );
      return;
    }

    productsNode.innerHTML = "";
    loadedProducts.forEach(function (product) {
      var row = document.createElement("tr");
      if (selectedProductId === product.id) {
        row.className = "admin-product-row-active table-active";
      }

      row.innerHTML =
        '<td><div class="fw-medium">' + escapeHtml(product.title || "Untitled product") + '</div><div class="text-secondary small">' + escapeHtml(product.id || "") + "</div></td>" +
        '<td>' + (product.priceLabel ? escapeHtml(product.priceLabel) : '<span class="text-secondary">Not set</span>') + "</td>" +
        '<td>' +
        (product.checkoutUrl
          ? '<a href="' + escapeHtml(product.checkoutUrl) + '" target="_blank" rel="noopener noreferrer">Configured</a>'
          : '<span class="text-secondary">Missing URL</span>') +
        "</td>" +
        '<td>' + escapeHtml(String(normalizePosition(product.position, 1))) + "</td>" +
        '<td><div class="btn-list justify-content-end flex-nowrap">' +
        '<button class="btn btn-outline-primary btn-sm" type="button" data-edit-product="' + escapeHtml(product.id || "") + '">Edit</button>' +
        '<button class="btn btn-outline-danger btn-sm" type="button" data-delete-product="' + escapeHtml(product.id || "") + '">Delete</button>' +
        "</div></td>";

      var editButton = row.querySelector("[data-edit-product]");
      var deleteButton = row.querySelector("[data-delete-product]");

      if (editButton) {
        editButton.addEventListener("click", function () {
          selectedProductId = product.id;
          renderProductTable();
          renderProductEditor(findSelectedProduct());
        });
      }

      if (deleteButton) {
        deleteButton.addEventListener("click", async function () {
          await deleteProduct(product.id);
        });
      }

      productsNode.appendChild(row);
    });
  }

  function renderProductEditor(product) {
    if (!productFormNode || !productFormTitleNode) {
      return;
    }

    if (!commerceConfig.enabled) {
      productFormTitleNode.textContent = "Product editor";
      productFormNode.innerHTML = emptyStateMarkup(
        "This site does not include the lightweight store pack."
      );
      productFormNode.onsubmit = null;
      return;
    }

    var draft = buildProductDraft(product);
    var isExistingProduct = !!(product && product.id);
    productFormTitleNode.textContent = isExistingProduct
      ? "Editing " + (draft.title || draft.id)
      : "New product";
    productFormNode.innerHTML =
      '<div class="row g-3">' +
      '<div class="col-md-5"><label class="form-label">Title</label><input class="form-control" name="title" value="' + escapeHtml(draft.title) + '" placeholder="Signature service"></div>' +
      '<div class="col-md-4"><label class="form-label">Price label</label><input class="form-control" name="priceLabel" value="' + escapeHtml(draft.priceLabel) + '" placeholder="$49"></div>' +
      '<div class="col-md-3"><label class="form-label">Position</label><input class="form-control" name="position" type="number" min="1" value="' + escapeHtml(String(draft.position)) + '"></div>' +
      '<div class="col-12"><label class="form-label">Description</label><textarea class="form-control" name="description" rows="4">' + escapeHtml(draft.description) + "</textarea></div>" +
      '<div class="col-md-6"><label class="form-label">Image URL</label><input class="form-control" name="imageUrl" value="' + escapeHtml(draft.imageUrl) + '" placeholder="https://..."></div>' +
      '<div class="col-md-6"><label class="form-label">Image alt</label><input class="form-control" name="imageAlt" value="' + escapeHtml(draft.imageAlt) + '" placeholder="Product image description"></div>' +
      '<div class="col-md-5"><label class="form-label">Button label</label><input class="form-control" name="actionLabel" value="' + escapeHtml(draft.actionLabel) + '" placeholder="Buy now"></div>' +
      '<div class="col-md-7"><label class="form-label">' + escapeHtml(checkoutUrlLabel(currentCommerceProvider)) + '</label><input class="form-control" name="checkoutUrl" value="' + escapeHtml(draft.checkoutUrl) + '" placeholder="' + escapeHtml(checkoutUrlPlaceholder(currentCommerceProvider)) + '"></div>' +
      '<div class="col-12 text-secondary small">Product checkout links currently use ' + escapeHtml(commerceProviderLabel(currentCommerceProvider)) + ".</div>" +
      '<div class="col-12"><div class="d-flex flex-column flex-sm-row gap-2 justify-content-between">' +
      '<div class="d-flex flex-wrap gap-2">' +
      '<button class="btn btn-primary" type="submit">Save product</button>' +
      (isExistingProduct
        ? '<button class="btn btn-outline-danger" type="button" data-delete-current="true">Delete product</button>'
        : "") +
      "</div>" +
      (isExistingProduct
        ? '<div class="text-secondary small align-self-center">Editing product id ' + escapeHtml(draft.id) + "</div>"
        : '<div class="text-secondary small align-self-center">New products appear in the table after saving.</div>') +
      "</div></div>" +
      "</div>";

    productFormNode.onsubmit = async function (event) {
      event.preventDefault();
      await saveProduct(isExistingProduct ? draft.id : "", new FormData(productFormNode));
    };

    var deleteButton = productFormNode.querySelector("[data-delete-current]");
    if (deleteButton && draft.id) {
      deleteButton.addEventListener("click", async function () {
        await deleteProduct(draft.id);
      });
    }
  }

  function renderProductsView() {
    renderProductTable();
    renderProductEditor(findSelectedProduct());
  }

  async function saveProduct(existingProductId, formData) {
    if (!commerceConfig.enabled) {
      setStatus("This site does not include the lightweight store pack.", true);
      return;
    }

    var title = String(formData.get("title") || "").trim();
    if (!title) {
      setStatus("Enter a product title before saving.", true);
      return;
    }

    var baseProductId = existingProductId || makeProductId(title);
    var productId = existingProductId || makeUniqueProductId(baseProductId, "");
    var existingProduct = loadedProducts.find(function (product) {
      return product && product.id === existingProductId;
    }) || null;
    var payload = {
      title: title,
      priceLabel: String(formData.get("priceLabel") || "").trim(),
      position: normalizePosition(
        formData.get("position"),
        existingProduct ? normalizePosition(existingProduct.position, 1) : nextProductPosition()
      ),
      description: String(formData.get("description") || "").trim(),
      imageUrl: String(formData.get("imageUrl") || "").trim(),
      imageAlt: String(formData.get("imageAlt") || "").trim(),
      actionLabel: String(formData.get("actionLabel") || "").trim() || "Buy now",
      checkoutUrl: String(formData.get("checkoutUrl") || "").trim()
    };

    try {
      if (previewSession) {
        upsertPreviewProduct({
          id: productId,
          title: payload.title,
          priceLabel: payload.priceLabel,
          position: payload.position,
          description: payload.description,
          imageUrl: payload.imageUrl,
          imageAlt: payload.imageAlt,
          actionLabel: payload.actionLabel,
          checkoutUrl: payload.checkoutUrl
        });
      } else {
        await productsCollection().doc(productId).set({
          title: payload.title,
          priceLabel: payload.priceLabel,
          position: payload.position,
          description: payload.description,
          imageUrl: payload.imageUrl,
          imageAlt: payload.imageAlt,
          actionLabel: payload.actionLabel,
          checkoutUrl: payload.checkoutUrl,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      selectedProductId = productId;
      await loadProducts();
      setStatus(
        (previewSession ? "Saved preview product " : "Saved product ") + (title || productId) + ".",
        false
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save product.", true);
    }
  }

  async function deleteProduct(productId) {
    if (!productId) {
      selectedProductId = NEW_PRODUCT_ID;
      renderProductsView();
      return;
    }

    try {
      if (previewSession) {
        deletePreviewProduct(productId);
      } else {
        await productsCollection().doc(productId).delete();
      }

      selectedProductId = null;
      await loadProducts();
      setStatus(
        (previewSession ? "Deleted preview product " : "Deleted product ") + productId + ".",
        false
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete product.", true);
    }
  }

  async function loadProducts() {
    if (addProductButton) {
      addProductButton.hidden = !commerceConfig.enabled;
    }

    if (!commerceConfig.enabled) {
      loadedProducts = [];
      selectedProductId = null;
      setProductCountSummary(0);
      renderProductsView();
      return;
    }

    if (previewSession) {
      loadedProducts = readPreviewProducts();
    } else {
      var snapshot = await productsCollection().orderBy("position").get();
      var products = [];
      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        products.push(data);
      });
      loadedProducts = sortProducts(products);
    }

    syncSelectedProduct();
    setProductCountSummary(loadedProducts.length);
    renderProductsView();
  }

  function bindAddProduct() {
    if (!addProductButton) {
      return;
    }

    addProductButton.addEventListener("click", function () {
      selectedProductId = NEW_PRODUCT_ID;
      renderProductsView();
      if (productFormNode) {
        productFormNode.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
        renderProductsView();
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
      renderProductsView();
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
      pageFormNode.innerHTML = emptyStateMarkup("No editable fields were discovered in the generated pages.");
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
      renderMeta();
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
        renderMeta();
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
  cmsSchema: CmsSchema | null
): StaticSiteFile[] {
  const supportFiles: StaticSiteFile[] = [
    ...buildStandardErrorPageFiles(context),
  ];

  if (!cmsSchema) {
    return supportFiles;
  }

  supportFiles.push(
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
    }
  );

  if (includeCmsPack(context.siteCapabilityProfile)) {
    supportFiles.push(
      {
        path: ADMIN_VENDOR_STYLE_PATH,
        content: buildAdminVendorStyle(),
      },
      {
        path: ADMIN_VENDOR_SCRIPT_PATH,
        content: buildAdminVendorScript(),
      },
      {
        path: ADMIN_PACK_RUNTIME_PATH,
        content: `${buildAdminPackRuntime()}\n`,
      },
      {
        path: ADMIN_PACK_STYLE_PATH,
        content: `${buildAdminPackStyles()}\n`,
      },
      {
        path: ADMIN_PAGE_PATH,
        content: buildAdminPage(ADMIN_PAGE_PATH, "overview"),
      },
      {
        path: ADMIN_ACCESS_PAGE_PATH,
        content: buildAdminPage(ADMIN_ACCESS_PAGE_PATH, "access"),
      },
      {
        path: ADMIN_CONTENT_PAGE_PATH,
        content: buildAdminPage(ADMIN_CONTENT_PAGE_PATH, "content"),
      },
      {
        path: ADMIN_STORE_PAGE_PATH,
        content: buildAdminPage(ADMIN_STORE_PAGE_PATH, "store"),
      },
      {
        path: ADMIN_PRODUCTS_PAGE_PATH,
        content: buildAdminPage(ADMIN_PRODUCTS_PAGE_PATH, "products"),
      }
    );
  }

  if (includeStorePack(context.siteCapabilityProfile)) {
    supportFiles.push(
      {
        path: PRODUCTS_DATA_PATH,
        content: buildProductsDataFile(),
      },
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
  const hasManagedPack =
    includeCmsPack(context.siteCapabilityProfile) ||
    includeStorePack(context.siteCapabilityProfile);

  const filesByPath = new Map<string, StaticSiteFile>();
  const pages: CmsPageSchema[] = [];

  for (const inputFile of inputFiles) {
    const normalizedFile = normalizePrimaryHeaderLogo(inputFile);

    if (
      !hasManagedPack ||
      !/\.html$/i.test(normalizedFile.path) ||
      normalizedFile.path.startsWith("admin/")
    ) {
      filesByPath.set(normalizedFile.path, normalizedFile);
      continue;
    }

    if (
      normalizedFile.path === STORE_PAGE_PATH ||
      normalizedFile.path === STORE_ALIAS_PATH
    ) {
      filesByPath.set(normalizedFile.path, normalizedFile);
      continue;
    }

    const annotated = annotateManagedHtmlFile(
      normalizedFile,
      includeStorePack(context.siteCapabilityProfile)
        ? relativeHrefBetweenFiles(normalizedFile.path, STORE_PAGE_PATH)
        : null
    );
    filesByPath.set(annotated.file.path, annotated.file);
    pages.push(annotated.page);
  }

  const cmsSchema = hasManagedPack ? buildCmsSchema(context, pages) : null;
  for (const supportFile of buildManagedSupportFiles(context, cmsSchema)) {
    filesByPath.set(supportFile.path, supportFile);
  }

  return {
    files: Array.from(filesByPath.values()),
    cmsSchema,
  };
}
