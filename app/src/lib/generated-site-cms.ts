import fs from "node:fs";
import path from "node:path";

import { load } from "cheerio";

import {
  CMS_SCHEMA_PATH,
  PRODUCTS_DATA_PATH,
  type CmsFieldSchema,
  type CmsSchema,
} from "@/lib/site-pack";

const SITES_ROOT = path.resolve(process.cwd(), "..", "sites");
const SITE_CONFIG_PATH = "assets/curb-site-config.js";
const SITE_CONFIG_ASSIGNMENT = "window.CURB_SITE_CONFIG = ";

export type SiteCmsFieldValue =
  | { value: string }
  | { text: string; href: string }
  | { src: string; alt: string };

export type SiteCmsPageRecord = {
  pageKey: string;
  path: string;
  title: string;
  fields: Array<CmsFieldSchema & { currentValue: SiteCmsFieldValue }>;
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

function readFieldValueFromNode(
  field: CmsFieldSchema,
  rawFileContent: string
): SiteCmsFieldValue {
  const $ = load(rawFileContent);
  const node = $(`[data-curb-key="${field.key}"]`).first();
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
  const siteDir = resolveSiteDir(siteSlug);
  const schemaPath = path.join(siteDir, ...CMS_SCHEMA_PATH.split("/"));
  const schema = readJsonFile<CmsSchema | null>(schemaPath, null);
  if (!schema) {
    throw new Error(`CMS schema was not found for "${siteSlug}".`);
  }

  return schema;
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

    return {
      pageKey: page.pageKey,
      path: page.path,
      title: page.title,
      fields: page.fields.map((field) => ({
        ...field,
        currentValue: readFieldValueFromNode(field, fileContent),
      })),
    };
  });
}

export function writeSiteCmsPage(
  siteSlug: string,
  pageKey: string,
  nextFields: Record<string, SiteCmsFieldValue>
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

    if (field.type === "link") {
      const linkValue = nextValue as Extract<SiteCmsFieldValue, { text: string; href: string }>;
      node.text(linkValue.text ?? "");
      node.attr("href", linkValue.href ?? "");
      continue;
    }

    if (field.type === "image") {
      const imageValue = nextValue as Extract<SiteCmsFieldValue, { src: string; alt: string }>;
      node.attr("src", imageValue.src ?? "");
      node.attr("alt", imageValue.alt ?? "");
      continue;
    }

    const textValue = nextValue as Extract<SiteCmsFieldValue, { value: string }>;
    node.text(textValue.value ?? "");
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
