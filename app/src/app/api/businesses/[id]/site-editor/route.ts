import path from "path";

import { NextRequest, NextResponse } from "next/server";

import {
  SiteEditorError,
  ensureSiteBackup,
  getLatestGeneratedSiteForBusiness,
  listSiteFiles,
  readSiteTextFile,
  writeSiteTextFile,
} from "@/lib/site-editor";

type RouteContext = { params: Promise<{ id: string }> };

function parseBusinessId(id: string): number {
  const businessId = Number.parseInt(id, 10);

  if (Number.isNaN(businessId)) {
    throw new SiteEditorError("Invalid business ID.", 400);
  }

  return businessId;
}

function getEditorPath(request: NextRequest): string | null {
  const relativePath = request.nextUrl.searchParams.get("path");
  if (!relativePath) {
    return null;
  }

  return relativePath;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const businessId = parseBusinessId(id);
    const site = getLatestGeneratedSiteForBusiness(businessId);
    const relativePath = getEditorPath(request);

    if (!relativePath) {
      return NextResponse.json({
        site: {
          id: site.id,
          slug: site.slug,
          version: site.version,
          createdAt: site.created_at,
        },
        tree: listSiteFiles(site.siteDir),
      });
    }

    const file = readSiteTextFile(site.siteDir, relativePath);

    return NextResponse.json({
      site: {
        id: site.id,
        slug: site.slug,
        version: site.version,
      },
      file,
    });
  } catch (error) {
    if (error instanceof SiteEditorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Site editor GET error:", error);
    return NextResponse.json(
      { error: "Failed to load site editor data." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const businessId = parseBusinessId(id);
    const relativePath = getEditorPath(request);

    if (!relativePath) {
      throw new SiteEditorError("A site file path is required.", 400);
    }

    const body = (await request.json()) as { content?: unknown };
    if (typeof body.content !== "string") {
      throw new SiteEditorError("A text file body is required.", 400);
    }

    const site = getLatestGeneratedSiteForBusiness(businessId);
    const backup = ensureSiteBackup(site);
    const file = writeSiteTextFile(site.siteDir, relativePath, body.content);

    return NextResponse.json({
      success: true,
      backupCreated: backup.created,
      backupPath: path
        .relative(path.resolve(process.cwd(), ".."), backup.backupPath)
        .replaceAll("\\", "/"),
      file,
    });
  } catch (error) {
    if (error instanceof SiteEditorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Site editor PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save the site file." },
      { status: 500 }
    );
  }
}
