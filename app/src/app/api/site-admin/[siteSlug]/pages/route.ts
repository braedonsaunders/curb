import { NextRequest, NextResponse } from "next/server";

import {
  readSiteCmsPages,
  writeSiteCmsPage,
  type SiteCmsFieldValue,
} from "@/lib/generated-site-cms";

type RouteContext = { params: Promise<{ siteSlug: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { siteSlug } = await context.params;
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
    const body = (await request.json()) as {
      pageKey?: unknown;
      fields?: unknown;
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

    const page = writeSiteCmsPage(
      siteSlug,
      body.pageKey,
      body.fields as Record<string, SiteCmsFieldValue>
    );

    return NextResponse.json({ page });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save CMS page.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
