import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import {
  buildPublicPurchasePath,
  saveSaleDraftForBusiness,
  setSalePaymentLink,
} from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";
import { createStripePaymentLink } from "@/lib/stripe-payment-links";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    const { id } = await context.params;
    const businessId = Number.parseInt(id, 10);

    if (!Number.isFinite(businessId)) {
      return NextResponse.json(
        { error: "Invalid business ID" },
        { status: 400 }
      );
    }

    const db = getDb();
    const business = db
      .prepare("SELECT id, name, email FROM businesses WHERE id = ?")
      .get(businessId) as
      | { id: number; name: string; email: string | null }
      | undefined;

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { sale?: Record<string, unknown> }
      | null;
    const draft = saveSaleDraftForBusiness(businessId, body?.sale ?? {});
    const paymentLink = await createStripePaymentLink(draft, business, {
      requestOrigin: request.nextUrl.origin,
    });
    const sale = setSalePaymentLink(draft.id, paymentLink.id, paymentLink.url);

    return NextResponse.json({
      ok: true,
      paymentLinkUrl: paymentLink.url,
      publicPurchasePath: buildPublicPurchasePath(sale.publicToken),
      sale,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create Stripe payment link";
    const status =
      message.includes("Invalid business ID")
        ? 400
        : message.includes("Business not found")
          ? 404
        : message.includes("Stripe") ||
            message.includes("amount") ||
            message.includes("Managed") ||
            message.includes("public app base URL")
            ? 422
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
