import { NextRequest, NextResponse } from "next/server";

import {
  readSiteCmsPages,
  writeSiteCmsPage,
  type SiteCmsCollectionItemInput,
  type SiteCmsFieldValue,
} from "@/lib/generated-site-cms";
import { isSiteAdminRequestAuthorized } from "@/lib/site-admin-access";

type RouteContext = { params: Promise<{ siteSlug: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { siteSlug } = await context.params;
    if (!isSiteAdminRequestAuthorized(request, siteSlug)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ pages: readSiteCmsPages(siteSlug) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load CMS pages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { siteSlug } = await context.params;
    if (!isSiteAdminRequestAuthorized(request, siteSlug)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as {
      pageKey?: unknown;
      fields?: unknown;
      collections?: unknown;
    };

    if (typeof body.pageKey !== "string" || !body.pageKey.trim()) {
      return NextResponse.json(
        { error: "A page key is required." },
        { status: 400 }
      );
    }

    if (!body.fields || typeof body.fields !== "object") {
      return NextResponse.json(
        { error: "A page field payload is required." },
        { status: 400 }
      );
    }

    if (
      body.collections !== undefined &&
      (!body.collections || typeof body.collections !== "object")
    ) {
      return NextResponse.json(
        { error: "Collection updates must be an object." },
        { status: 400 }
      );
    }

    const page = writeSiteCmsPage(
      siteSlug,
      body.pageKey,
      body.fields as Record<string, SiteCmsFieldValue>,
      body.collections as Record<string, SiteCmsCollectionItemInput[]>
    );

    return NextResponse.json({ page });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save CMS page.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
