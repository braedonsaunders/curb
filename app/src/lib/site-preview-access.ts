import crypto from "crypto";

import { getConfig } from "./config";

export const PREVIEW_ADMIN_QUERY_PARAM = "curb-preview-admin";
export const PREVIEW_ADMIN_STORAGE_NAMESPACE = "curb-preview-admin";
const SITE_CONFIG_ASSIGNMENT = "window.CURB_SITE_CONFIG = ";

type PortableSiteConfig = {
  cms?: {
    previewMode?: {
      enabled?: boolean;
      token?: string;
      queryParam?: string;
      storageNamespace?: string;
    };
  };
} & Record<string, unknown>;

function parseSiteConfigScript(content: string): {
  beforeAssignment: string;
  config: PortableSiteConfig;
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
    const config = JSON.parse(
      content.slice(jsonStart, assignmentEnd).trim()
    ) as PortableSiteConfig;

    return {
      beforeAssignment: content.slice(0, assignmentIndex),
      config,
      afterAssignment: content.slice(assignmentEnd + 1),
    };
  } catch {
    return null;
  }
}

function serializeSiteConfigScript(
  parsed: NonNullable<ReturnType<typeof parseSiteConfigScript>>
): string {
  return `${parsed.beforeAssignment}${SITE_CONFIG_ASSIGNMENT}${JSON.stringify(
    parsed.config,
    null,
    2
  )};${parsed.afterAssignment}`;
}

export function buildSitePreviewAdminToken(siteSlug: string): string {
  const secret = getConfig().previewAdminSecret.trim();

  return crypto
    .createHmac("sha256", secret || "curb-preview-admin-fallback")
    .update(`preview-admin:${siteSlug}`)
    .digest("base64url");
}

export function buildPreviewAdminUrl(
  baseUrl: string | null | undefined,
  siteSlug: string
): string | null {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) {
    return null;
  }

  const isAbsolute = /^https?:\/\//i.test(raw);
  const url = new URL(raw, "http://local-preview.invalid");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/admin/`;
  url.searchParams.set(
    PREVIEW_ADMIN_QUERY_PARAM,
    buildSitePreviewAdminToken(siteSlug)
  );

  if (isAbsolute) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function applyPreviewAccessToSiteConfigScript(
  content: string,
  siteSlug: string
): string {
  const parsed = parseSiteConfigScript(content);
  if (!parsed) {
    return content;
  }

  parsed.config.cms = {
    ...(parsed.config.cms ?? {}),
    previewMode: {
      enabled: true,
      token: buildSitePreviewAdminToken(siteSlug),
      queryParam: PREVIEW_ADMIN_QUERY_PARAM,
      storageNamespace: PREVIEW_ADMIN_STORAGE_NAMESPACE,
    },
  };

  return serializeSiteConfigScript(parsed);
}
