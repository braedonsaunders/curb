import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

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

async function serveSiteAsset(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path: requestedSegments } = await params;
  const segments = Array.isArray(requestedSegments) ? requestedSegments : [];
  const filePath = resolveRequestedFile(segments);

  if (!filePath) {
    return NextResponse.json({ error: "Site file not found" }, { status: 404 });
  }

  if (getContentType(filePath).startsWith("text/html")) {
    const html = fs.readFileSync(filePath, "utf-8");
    const baseHref = request.nextUrl.pathname.endsWith("/")
      ? request.nextUrl.pathname
      : `${request.nextUrl.pathname}/`;
    const body = injectBaseHref(html, baseHref);

    return new NextResponse(body, {
      headers: {
        "content-type": getContentType(filePath),
        "cache-control": "no-store",
      },
    });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "content-type": getContentType(filePath),
      "cache-control": "no-store",
    },
  });
}

export const GET = serveSiteAsset;
export const HEAD = serveSiteAsset;
