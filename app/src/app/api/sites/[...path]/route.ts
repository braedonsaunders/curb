import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  isLegacyAdminRequestPath,
  isLegacyManagedArtifactPath,
} from "@/lib/legacy-site-artifacts";

const SITES_DIR = path.resolve(process.cwd(), "..", "sites");

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveRequestedFile(segments: string[]): string | null {
  const requestedPath = path.resolve(SITES_DIR, ...segments);
  if (!requestedPath.startsWith(SITES_DIR)) {
    return null;
  }

  const candidates = [
    requestedPath,
    `${requestedPath}.html`,
    path.join(requestedPath, "index.html"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function resolveSiteErrorFile(
  siteSlug: string,
  statusCode: number
): string | null {
  const trimmedSlug = siteSlug.trim();
  if (!trimmedSlug) {
    return null;
  }

  return resolveRequestedFile([trimmedSlug, `${statusCode}.html`]);
}

function injectBaseHref(html: string, baseHref: string): string {
  if (/<base\b/i.test(html)) {
    return html;
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(
      /<head\b([^>]*)>/i,
      `<head$1>\n<base href="${baseHref}">`
    );
  }

  return `<base href="${baseHref}">\n${html}`;
}

function getBaseHref(pathname: string): string {
  if (/\/[^/]+\.html$/i.test(pathname)) {
    return pathname.replace(/\/[^/]+\.html$/i, "/");
  }

  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function getServedSiteRelativePath(siteSlug: string, filePath: string): string {
  const siteRoot = path.resolve(SITES_DIR, siteSlug);
  return path.relative(siteRoot, filePath).split(path.sep).join("/");
}

function sitePathnameForFile(siteSlug: string, siteRelativePath: string): string {
  if (!siteRelativePath || siteRelativePath === "index.html") {
    return `/sites/${siteSlug}/`;
  }

  if (/\/index\.html$/i.test(siteRelativePath)) {
    return `/sites/${siteSlug}/${siteRelativePath.replace(/\/index\.html$/i, "/")}`;
  }

  return `/sites/${siteSlug}/${siteRelativePath}`;
}

function serveResolvedFile(
  filePath: string,
  siteSlug: string,
  status = 200
): NextResponse {
  const siteRelativePath = getServedSiteRelativePath(siteSlug, filePath);

  if (isLegacyManagedArtifactPath(siteRelativePath)) {
    return NextResponse.json({ error: "Site file not found" }, { status: 404 });
  }

  if (getContentType(filePath).startsWith("text/html")) {
    const html = fs.readFileSync(filePath, "utf-8");
    const baseHref = getBaseHref(
      sitePathnameForFile(siteSlug, siteRelativePath)
    );
    const body = injectBaseHref(html, baseHref);

    return new NextResponse(body, {
      status,
      headers: {
        "content-type": getContentType(filePath),
        "cache-control": "no-store",
      },
    });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    status,
    headers: {
      "content-type": getContentType(filePath),
      "cache-control": "no-store",
    },
  });
}

async function serveSiteAsset(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path: requestedSegments } = await params;
  const segments = Array.isArray(requestedSegments) ? requestedSegments : [];
  const siteSlug = segments[0] ?? "";

  try {
    if (isLegacyAdminRequestPath(segments)) {
      return NextResponse.json({ error: "Site file not found" }, { status: 404 });
    }

    const filePath = resolveRequestedFile(segments);
    if (!filePath) {
      const notFoundFile = resolveSiteErrorFile(siteSlug, 404);
      if (notFoundFile) {
        return serveResolvedFile(notFoundFile, siteSlug, 404);
      }

      return NextResponse.json({ error: "Site file not found" }, { status: 404 });
    }

    return serveResolvedFile(filePath, siteSlug);
  } catch (error) {
    console.error(
      `Failed to serve generated site asset for "${siteSlug}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );

    const errorFile = resolveSiteErrorFile(siteSlug, 500);
    if (errorFile) {
      return serveResolvedFile(errorFile, siteSlug, 500);
    }

    return NextResponse.json(
      { error: "Failed to serve site file" },
      { status: 500 }
    );
  }
}

export const GET = serveSiteAsset;
export const HEAD = serveSiteAsset;
