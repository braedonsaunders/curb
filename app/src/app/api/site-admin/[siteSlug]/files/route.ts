import path from "path";

import { NextRequest, NextResponse } from "next/server";

import {
  SiteEditorError,
  ensureSiteBackup,
  getLatestGeneratedSiteForSlug,
  listSiteFiles,
  readSiteTextFile,
  writeSiteBinaryFile,
  writeSiteTextFile,
} from "@/lib/site-editor";

type RouteContext = { params: Promise<{ siteSlug: string }> };

function getEditorPath(request: NextRequest): string | null {
  const relativePath = request.nextUrl.searchParams.get("path");
  if (!relativePath) {
    return null;
  }

  return relativePath;
}

function getCanonicalAssetExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === ".jpeg") {
    return ".jpg";
  }

  return normalized;
}

function assertMatchingUploadExtension(
  relativePath: string,
  uploadedFileName: string
): void {
  const targetExtension = getCanonicalAssetExtension(path.extname(relativePath));
  const uploadExtension = getCanonicalAssetExtension(path.extname(uploadedFileName));

  if (!targetExtension || !uploadExtension || targetExtension === uploadExtension) {
    return;
  }

  throw new SiteEditorError(
    `Upload a ${targetExtension} file to replace this asset.`,
    400
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { siteSlug } = await context.params;
    const site = getLatestGeneratedSiteForSlug(siteSlug);
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

    console.error("Site admin files GET error:", error);
    return NextResponse.json(
      { error: "Failed to load site editor data." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { siteSlug } = await context.params;
    const relativePath = getEditorPath(request);

    if (!relativePath) {
      throw new SiteEditorError("A site file path is required.", 400);
    }

    const site = getLatestGeneratedSiteForSlug(siteSlug);
    const contentType = request.headers.get("content-type") ?? "";
    let textContent: string | null = null;
    let binaryContent: Buffer | null = null;

    if (contentType.startsWith("multipart/form-data")) {
      const formData = await request.formData();
      const upload = formData.get("file");

      if (!(upload instanceof File)) {
        throw new SiteEditorError("An uploaded file is required.", 400);
      }

      assertMatchingUploadExtension(relativePath, upload.name);
      binaryContent = Buffer.from(await upload.arrayBuffer());
    } else {
      const body = (await request.json()) as { content?: unknown };
      if (typeof body.content !== "string") {
        throw new SiteEditorError("A text file body is required.", 400);
      }

      textContent = body.content;
    }

    const backup = ensureSiteBackup(site);
    const file =
      binaryContent !== null
        ? writeSiteBinaryFile(site.siteDir, relativePath, binaryContent)
        : writeSiteTextFile(site.siteDir, relativePath, textContent ?? "");

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

    console.error("Site admin files PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save the site file." },
      { status: 500 }
    );
  }
}
