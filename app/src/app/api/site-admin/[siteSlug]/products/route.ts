import { NextRequest, NextResponse } from "next/server";

import {
  readSiteCmsProducts,
  writeSiteCmsProducts,
  type SiteCmsProductRecord,
} from "@/lib/generated-site-cms";

type RouteContext = { params: Promise<{ siteSlug: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { siteSlug } = await context.params;
    return NextResponse.json({ products: readSiteCmsProducts(siteSlug) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load products.";
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
      products?: unknown;
    };

    if (!Array.isArray(body.products)) {
      return NextResponse.json(
        { error: "A products array is required." },
        { status: 400 }
      );
    }

    const products = writeSiteCmsProducts(
      siteSlug,
      body.products as SiteCmsProductRecord[]
    );

    return NextResponse.json({ products });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
