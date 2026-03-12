import fs from "node:fs";
import path from "node:path";

import { load } from "cheerio";

import {
  CMS_SCHEMA_PATH,
  PRODUCTS_DATA_PATH,
  STORE_ALIAS_PATH,
  STORE_PAGE_PATH,
  annotateManagedHtmlFile,
  type CmsCollectionFieldSchema,
  type CmsCollectionSchema,
  type CmsFieldSchema,
  type CmsSchema,
} from "@/lib/site-pack";

const SITES_ROOT = path.resolve(process.cwd(), "..", "sites");
const SITE_CONFIG_PATH = "assets/curb-site-config.js";
const SITE_CONFIG_ASSIGNMENT = "window.CURB_SITE_CONFIG = ";
type HtmlDoc = ReturnType<typeof load>;
type HtmlNode = ReturnType<HtmlDoc>;

export type SiteCmsFieldValue =
  | { value: string }
  | { text: string; href: string }
  | { src: string; alt: string };

export type SiteCmsPageRecord = {
  pageKey: string;
  path: string;
  title: string;
  fields: Array<CmsFieldSchema & { currentValue: SiteCmsFieldValue }>;
  collections: SiteCmsCollectionRecord[];
};

export type SiteCmsCollectionItemRecord = {
  id: string;
  fields: Array<CmsCollectionFieldSchema & { currentValue: SiteCmsFieldValue }>;
};

export type SiteCmsCollectionRecord = CmsCollectionSchema & {
  items: SiteCmsCollectionItemRecord[];
};

export type SiteCmsCollectionItemInput = {
  id?: string;
  fields: Record<string, SiteCmsFieldValue>;
};

export type SiteCmsProductRecord = {
  id: string;
  title: string;
  priceLabel: string;
  position: number;
  description: string;
  imageUrl: string;
  imageAlt: string;
  actionLabel: string;
  checkoutUrl: string;
};

export type SiteCmsSettings = {
  businessName: string;
  ownerEmail: string;
  commerceEnabled: boolean;
  commerceProvider: "none" | "stripe-payment-links" | "shopify";
};

export type SiteCmsBootstrap = {
  siteSlug: string;
  pages: SiteCmsPageRecord[];
  products: SiteCmsProductRecord[];
  settings: SiteCmsSettings;
};

function isExistingFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isWithinDirectory(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function resolveSiteDir(siteSlug: string): string {
  const trimmedSlug = String(siteSlug).trim();
  if (!trimmedSlug) {
    throw new Error("A site slug is required.");
  }

  const siteDir = path.resolve(SITES_ROOT, trimmedSlug);
  if (!isWithinDirectory(siteDir, SITES_ROOT)) {
    throw new Error("Invalid site slug.");
  }

  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new Error(`Generated site "${trimmedSlug}" was not found.`);
  }

  return siteDir;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function ensureDoctype(originalContent: string, nextHtml: string): string {
  if (/^\s*<!doctype/i.test(nextHtml)) {
    return `${nextHtml}\n`;
  }

  const originalDoctype = originalContent.match(/^\s*<!doctype[^>]*>/i)?.[0];
  if (!originalDoctype) {
    return `${nextHtml}\n`;
  }

  return `${originalDoctype}\n${nextHtml}\n`;
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

function normalizeCommerceProvider(
  value: unknown
): SiteCmsSettings["commerceProvider"] {
  const normalized = String(value ?? "").trim().toLowerCase();
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

function parseSiteConfigScript(content: string): {
  beforeAssignment: string;
  config: Record<string, unknown>;
  afterAssignment: string;
} | null {
  const assignmentIndex = content.indexOf(SITE_CONFIG_ASSIGNMENT);
  if (assignmentIndex < 0) {
    return null;
  }

  const jsonStart = assignmentIndex + SITE_CONFIG_ASSIGNMENT.length;
  const assignmentEnd = content.indexOf(";", jsonStart);
  if (assignmentEnd < 0) {
    return null;
  }

  try {
    return {
      beforeAssignment: content.slice(0, assignmentIndex),
      config: JSON.parse(content.slice(jsonStart, assignmentEnd).trim()) as Record<
        string,
        unknown
      >,
      afterAssignment: content.slice(assignmentEnd + 1),
    };
  } catch {
    return null;
  }
}

function serializeSiteConfigScript(parsed: NonNullable<ReturnType<typeof parseSiteConfigScript>>): string {
  return `${parsed.beforeAssignment}${SITE_CONFIG_ASSIGNMENT}${JSON.stringify(
    parsed.config,
    null,
    2
  )};${parsed.afterAssignment}`;
}

function fallbackFieldValue(field: CmsFieldSchema): SiteCmsFieldValue {
  if (field.type === "link") {
    return {
      text: field.defaultValue || "",
      href: field.defaultHref || "",
    };
  }

  if (field.type === "image") {
    return {
      src: field.defaultValue || "",
      alt: field.defaultAlt || "",
    };
  }

  return {
    value: field.defaultValue || "",
  };
}

function readFieldValueFromSelection(
  field: CmsFieldSchema,
  node: HtmlNode
): SiteCmsFieldValue {
  if (!node.length) {
    return fallbackFieldValue(field);
  }

  if (field.type === "link") {
    return {
      text: node.text().trim(),
      href: String(node.attr("href") ?? "").trim(),
    };
  }

  if (field.type === "image") {
    return {
      src: String(node.attr("src") ?? "").trim(),
      alt: String(node.attr("alt") ?? "").trim(),
    };
  }

  return {
    value: node.text().trim(),
  };
}

function writeFieldValueToSelection(
  field: CmsFieldSchema,
  node: HtmlNode,
  nextValue: SiteCmsFieldValue
): void {
  if (!node.length) {
    return;
  }

  if (field.type === "link") {
    const linkValue = nextValue as Extract<SiteCmsFieldValue, { text: string; href: string }>;
    node.text(linkValue.text ?? "");
    node.attr("href", linkValue.href ?? "");
    return;
  }

  if (field.type === "image") {
    const imageValue = nextValue as Extract<SiteCmsFieldValue, { src: string; alt: string }>;
    node.attr("src", imageValue.src ?? "");
    node.attr("alt", imageValue.alt ?? "");
    return;
  }

  const textValue = nextValue as Extract<SiteCmsFieldValue, { value: string }>;
  node.text(textValue.value ?? "");
}

function findCollectionFieldNode(itemNode: HtmlNode, fieldKey: string): HtmlNode {
  if (itemNode.is(`[data-curb-collection-field="${fieldKey}"]`)) {
    return itemNode;
  }

  return itemNode.find(`[data-curb-collection-field="${fieldKey}"]`).first();
}

function normalizeCollectionItemId(
  collectionKey: string,
  candidateId: unknown,
  index: number
): string {
  const normalized = String(candidateId ?? "").trim();
  return normalized || `${collectionKey}-item-${index + 1}`;
}

function readCollectionItemsFromDocument(
  $: HtmlDoc,
  collection: CmsCollectionSchema
): SiteCmsCollectionItemRecord[] {
  return $(`[data-curb-collection-item="${collection.key}"]`)
    .toArray()
    .map((element, index: number) => {
      const itemNode = $(element);

      return {
        id: normalizeCollectionItemId(
          collection.key,
          itemNode.attr("data-curb-collection-item-id"),
          index
        ),
        fields: collection.fields.map((field) => ({
          ...field,
          currentValue: readFieldValueFromSelection(
            field,
            findCollectionFieldNode(itemNode, field.key)
          ),
        })),
      };
    });
}

function ensureSiteCmsSchema(siteSlug: string): CmsSchema {
  const siteDir = resolveSiteDir(siteSlug);
  const schemaPath = path.join(siteDir, ...CMS_SCHEMA_PATH.split("/"));
  const currentSchema = readJsonFile<CmsSchema | null>(schemaPath, null);
  if (!currentSchema) {
    throw new Error(`CMS schema was not found for "${siteSlug}".`);
  }

  let didChange = false;
  const nextPages = currentSchema.pages.map((page) => {
    if (
      !/\.html$/i.test(page.path) ||
      page.path === STORE_PAGE_PATH ||
      page.path === STORE_ALIAS_PATH
    ) {
      return page;
    }

    const filePath = path.join(siteDir, ...page.path.split("/"));
    if (!isExistingFile(filePath)) {
      return page;
    }

    const originalContent = fs.readFileSync(filePath, "utf8");
    const annotated = annotateManagedHtmlFile(
      {
        path: page.path,
        content: originalContent,
      },
      currentSchema.storePagePath
        ? relativeHrefBetweenFiles(page.path, currentSchema.storePagePath)
        : null
    );

    if (annotated.file.content !== originalContent) {
      fs.writeFileSync(filePath, annotated.file.content, "utf8");
      didChange = true;
    }

    if (JSON.stringify(annotated.page) !== JSON.stringify(page)) {
      didChange = true;
    }

    return annotated.page;
  });

  if (!didChange) {
    return currentSchema;
  }

  const nextSchema: CmsSchema = {
    ...currentSchema,
    pages: nextPages,
  };

  fs.writeFileSync(schemaPath, `${JSON.stringify(nextSchema, null, 2)}\n`, "utf8");
  return nextSchema;
}

function normalizeProductRecord(
  product: Partial<SiteCmsProductRecord> | null | undefined,
  index: number
): SiteCmsProductRecord {
  return {
    id: String(product?.id ?? "").trim(),
    title: String(product?.title ?? "").trim(),
    priceLabel: String(product?.priceLabel ?? "").trim(),
    position: Math.max(1, Number(product?.position ?? index + 1) || index + 1),
    description: String(product?.description ?? "").trim(),
    imageUrl: String(product?.imageUrl ?? "").trim(),
    imageAlt: String(product?.imageAlt ?? "").trim(),
    actionLabel: String(product?.actionLabel ?? "").trim() || "Buy now",
    checkoutUrl: String(product?.checkoutUrl ?? "").trim(),
  };
}

export function readSiteCmsSchema(siteSlug: string): CmsSchema {
  return ensureSiteCmsSchema(siteSlug);
}

export function readSiteCmsSettings(siteSlug: string): SiteCmsSettings {
  const siteDir = resolveSiteDir(siteSlug);
  const configPath = path.join(siteDir, ...SITE_CONFIG_PATH.split("/"));
  const rawConfig = fs.readFileSync(configPath, "utf8");
  const parsed = parseSiteConfigScript(rawConfig);
  if (!parsed) {
    throw new Error(`Site config could not be parsed for "${siteSlug}".`);
  }

  const cmsConfig = (parsed.config.cms ?? {}) as Record<string, unknown>;
  const commerceConfig = (parsed.config.commerce ?? {}) as Record<string, unknown>;

  return {
    businessName: String(parsed.config.businessName ?? siteSlug).trim(),
    ownerEmail: String(cmsConfig.ownerEmail ?? "").trim(),
    commerceEnabled: Boolean(commerceConfig.enabled),
    commerceProvider: normalizeCommerceProvider(commerceConfig.provider),
  };
}

export function hasSiteCms(siteSlug: string): boolean {
  try {
    const siteDir = resolveSiteDir(siteSlug);
    const configPath = path.join(siteDir, ...SITE_CONFIG_PATH.split("/"));
    const rawConfig = fs.readFileSync(configPath, "utf8");
    const parsed = parseSiteConfigScript(rawConfig);
    if (!parsed) {
      return false;
    }

    const cmsConfig = (parsed.config.cms ?? {}) as Record<string, unknown>;
    if (!Boolean(cmsConfig.enabled)) {
      return false;
    }

    const schemaPath = path.join(siteDir, ...CMS_SCHEMA_PATH.split("/"));
    return isExistingFile(schemaPath);
  } catch {
    return false;
  }
}

export function writeSiteCmsSettings(
  siteSlug: string,
  nextSettings: Pick<SiteCmsSettings, "ownerEmail" | "commerceProvider">
): SiteCmsSettings {
  const siteDir = resolveSiteDir(siteSlug);
  const configPath = path.join(siteDir, ...SITE_CONFIG_PATH.split("/"));
  const rawConfig = fs.readFileSync(configPath, "utf8");
  const parsed = parseSiteConfigScript(rawConfig);
  if (!parsed) {
    throw new Error(`Site config could not be parsed for "${siteSlug}".`);
  }

  const config = parsed.config;
  const cmsConfig = ((config.cms ?? {}) as Record<string, unknown>);
  const commerceConfig = ((config.commerce ?? {}) as Record<string, unknown>);

  cmsConfig.ownerEmail = String(nextSettings.ownerEmail ?? "").trim();
  commerceConfig.provider = normalizeCommerceProvider(nextSettings.commerceProvider);

  config.cms = cmsConfig;
  config.commerce = commerceConfig;

  fs.writeFileSync(
    configPath,
    serializeSiteConfigScript({
      ...parsed,
      config,
    }),
    "utf8"
  );

  return readSiteCmsSettings(siteSlug);
}

export function readSiteCmsPages(siteSlug: string): SiteCmsPageRecord[] {
  const siteDir = resolveSiteDir(siteSlug);
  const schema = readSiteCmsSchema(siteSlug);

  return schema.pages.map((page) => {
    const filePath = path.join(siteDir, ...page.path.split("/"));
    const fileContent = fs.readFileSync(filePath, "utf8");
    const doc = load(fileContent);

    return {
      pageKey: page.pageKey,
      path: page.path,
      title: page.title,
      fields: page.fields.map((field) => ({
        ...field,
        currentValue: readFieldValueFromSelection(
          field,
          doc(`[data-curb-key="${field.key}"]`).first()
        ),
      })),
      collections: (page.collections ?? []).map((collection) => ({
        ...collection,
        items: readCollectionItemsFromDocument(doc, collection),
      })),
    };
  });
}

export function writeSiteCmsPage(
  siteSlug: string,
  pageKey: string,
  nextFields: Record<string, SiteCmsFieldValue>,
  nextCollections?: Record<string, SiteCmsCollectionItemInput[]>
): SiteCmsPageRecord {
  const siteDir = resolveSiteDir(siteSlug);
  const schema = readSiteCmsSchema(siteSlug);
  const page = schema.pages.find((entry) => entry.pageKey === pageKey);

  if (!page) {
    throw new Error(`Page "${pageKey}" was not found.`);
  }

  const filePath = path.join(siteDir, ...page.path.split("/"));
  const originalContent = fs.readFileSync(filePath, "utf8");
  const $ = load(originalContent);

  for (const field of page.fields) {
    const node = $(`[data-curb-key="${field.key}"]`).first();
    if (!node.length) {
      continue;
    }

    const nextValue = nextFields[field.key];
    if (!nextValue) {
      continue;
    }

    writeFieldValueToSelection(field, node, nextValue);
  }

  for (const collection of page.collections ?? []) {
    if (!nextCollections || !Array.isArray(nextCollections[collection.key])) {
      continue;
    }

    const container = $(`[data-curb-collection="${collection.key}"]`).first();
    if (!container.length) {
      continue;
    }

    container.children(`[data-curb-collection-item="${collection.key}"]`).remove();

    nextCollections[collection.key].forEach((itemInput, index) => {
      const template = load(collection.itemTemplateHtml);
      const itemNode = template.root().children().first();
      if (!itemNode.length) {
        return;
      }

      itemNode.attr("data-curb-collection-item", collection.key);
      itemNode.attr(
        "data-curb-collection-item-id",
        normalizeCollectionItemId(collection.key, itemInput?.id, index)
      );

      for (const field of collection.fields) {
        const fieldNode = findCollectionFieldNode(itemNode, field.key);
        if (!fieldNode.length) {
          continue;
        }

        writeFieldValueToSelection(
          field,
          fieldNode,
          itemInput?.fields?.[field.key] ?? fallbackFieldValue(field)
        );
      }

      container.append(itemNode);
    });
  }

  fs.writeFileSync(filePath, ensureDoctype(originalContent, $.html()), "utf8");

  return readSiteCmsPages(siteSlug).find((entry) => entry.pageKey === pageKey)!;
}

export function readSiteCmsProducts(siteSlug: string): SiteCmsProductRecord[] {
  const siteDir = resolveSiteDir(siteSlug);
  const productsPath = path.join(siteDir, ...PRODUCTS_DATA_PATH.split("/"));
  const products = readJsonFile<Array<Partial<SiteCmsProductRecord>>>(
    productsPath,
    []
  );

  return products
    .map((product, index) => normalizeProductRecord(product, index))
    .sort((left, right) => left.position - right.position);
}

export function writeSiteCmsProducts(
  siteSlug: string,
  nextProducts: Array<Partial<SiteCmsProductRecord>>
): SiteCmsProductRecord[] {
  const siteDir = resolveSiteDir(siteSlug);
  const productsPath = path.join(siteDir, ...PRODUCTS_DATA_PATH.split("/"));
  const normalizedProducts = nextProducts
    .map((product, index) => normalizeProductRecord(product, index))
    .filter((product) => product.id && product.title)
    .sort((left, right) => left.position - right.position);

  fs.mkdirSync(path.dirname(productsPath), { recursive: true });
  fs.writeFileSync(
    productsPath,
    `${JSON.stringify(normalizedProducts, null, 2)}\n`,
    "utf8"
  );

  return normalizedProducts;
}

export function getSiteCmsBootstrap(siteSlug: string): SiteCmsBootstrap {
  const settings = readSiteCmsSettings(siteSlug);

  return {
    siteSlug,
    pages: readSiteCmsPages(siteSlug),
    products: readSiteCmsProducts(siteSlug),
    settings,
  };
}
