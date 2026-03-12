import "server-only";

import type { NextRequest } from "next/server";

import { buildSitePreviewAdminToken } from "@/lib/site-preview-access";
import {
  SITE_ADMIN_PREVIEW_QUERY_PARAM,
  SITE_ADMIN_SESSION_COOKIE,
} from "@/lib/site-admin-session";

type SiteAdminAccessOptions = {
  siteSlug: string;
  host: string | null | undefined;
  previewAccessToken?: string | null;
  sessionCookieValue?: string | null;
};

type SiteAdminAccessResult = {
  allowed: boolean;
  sessionValue: string | null;
};

function normalizeHost(host: string | null | undefined): string {
  const rawHost = String(host ?? "").trim();
  if (!rawHost) {
    return "";
  }

  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch {
    return rawHost.toLowerCase();
  }
}

export function isLocalSiteAdminHost(host: string | null | undefined): boolean {
  const hostname = normalizeHost(host);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function buildSiteAdminSessionValue(siteSlug: string): string {
  return `${encodeURIComponent(siteSlug)}:${buildSitePreviewAdminToken(siteSlug)}`;
}

export function getSiteAdminSessionValue(
  siteSlug: string,
  previewAccessToken: string | null | undefined
): string | null {
  if (!previewAccessToken) {
    return null;
  }

  return previewAccessToken === buildSitePreviewAdminToken(siteSlug)
    ? buildSiteAdminSessionValue(siteSlug)
    : null;
}

export function resolveSiteAdminAccess(
  options: SiteAdminAccessOptions
): SiteAdminAccessResult {
  if (isLocalSiteAdminHost(options.host)) {
    return {
      allowed: true,
      sessionValue: null,
    };
  }

  const querySessionValue = getSiteAdminSessionValue(
    options.siteSlug,
    options.previewAccessToken
  );
  if (querySessionValue) {
    return {
      allowed: true,
      sessionValue: querySessionValue,
    };
  }

  return {
    allowed:
      options.sessionCookieValue === buildSiteAdminSessionValue(options.siteSlug),
    sessionValue: null,
  };
}

export function isSiteAdminRequestAuthorized(
  request: NextRequest,
  siteSlug: string
): boolean {
  return resolveSiteAdminAccess({
    siteSlug,
    host: request.headers.get("host"),
    previewAccessToken: request.nextUrl.searchParams.get(
      SITE_ADMIN_PREVIEW_QUERY_PARAM
    ),
    sessionCookieValue:
      request.cookies.get(SITE_ADMIN_SESSION_COOKIE)?.value ?? null,
  }).allowed;
}

export { SITE_ADMIN_PREVIEW_QUERY_PARAM, SITE_ADMIN_SESSION_COOKIE };
