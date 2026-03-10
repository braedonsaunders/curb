import { NextRequest, NextResponse } from "next/server";

import {
  readSiteCmsSettings,
  writeSiteCmsSettings,
} from "@/lib/generated-site-cms";

type RouteContext = { params: Promise<{ siteSlug: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { siteSlug } = await context.params;
    return NextResponse.json({ settings: readSiteCmsSettings(siteSlug) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load settings.";
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
      ownerEmail?: unknown;
      commerceProvider?: unknown;
    };

    if (
      typeof body.ownerEmail !== "string" ||
      typeof body.commerceProvider !== "string"
    ) {
      return NextResponse.json(
        { error: "ownerEmail and commerceProvider are required." },
        { status: 400 }
      );
    }

    const settings = writeSiteCmsSettings(siteSlug, {
      ownerEmail: body.ownerEmail,
      commerceProvider:
        body.commerceProvider === "shopify"
          ? "shopify"
          : body.commerceProvider === "stripe-payment-links"
            ? "stripe-payment-links"
            : "none",
    });

    return NextResponse.json({ settings });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
