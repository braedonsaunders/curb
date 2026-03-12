import { NextRequest, NextResponse } from "next/server";

import {
  ensureActivationWorkerRunning,
  queueSaleActivation,
} from "@/lib/activation-jobs";
import { logActivity } from "@/lib/activity-log";
import {
  getSaleByStripePaymentLinkId,
  markSalePaid,
} from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";
import {
  parseStripeWebhookEvent,
  retrieveStripeCheckoutSession,
  verifyStripeWebhookSignature,
} from "@/lib/stripe-payment-links";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    ensureActivationWorkerRunning();

    const rawBody = await request.text();
    if (
      !verifyStripeWebhookSignature(
        rawBody,
        request.headers.get("stripe-signature")
      )
    ) {
      return NextResponse.json(
        { error: "Invalid Stripe signature" },
        { status: 400 }
      );
    }

    const event = parseStripeWebhookEvent(rawBody);
    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ received: true, ignored: true });
    }

    const webhookSession = event.data.object;
    const sessionId = text(webhookSession.id);
    if (!sessionId) {
      return NextResponse.json(
        { error: "Stripe payload is missing a checkout session id." },
        { status: 400 }
      );
    }

    const session = await retrieveStripeCheckoutSession(sessionId);
    const paymentLinkId = text(session.payment_link) || text(webhookSession.payment_link);
    if (!paymentLinkId) {
      return NextResponse.json(
        { error: "Stripe checkout session is not attached to a payment link." },
        { status: 400 }
      );
    }

    const sale = getSaleByStripePaymentLinkId(paymentLinkId);
    if (!sale) {
      return NextResponse.json(
        { error: "No sale is attached to this Stripe payment link." },
        { status: 404 }
      );
    }

    if (
      sale.stripeCheckoutSessionId === session.id &&
      (sale.status === "paid" || sale.status === "fulfilled")
    ) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const paidSale = markSalePaid(sale.id, {
      checkoutSessionId: session.id,
      customerEmail: session.customer_details?.email ?? null,
      customerId: session.customer,
      customerName: session.customer_details?.name ?? null,
      metadata: {
        stripePaymentStatus: session.payment_status,
        stripeSessionStatus: session.status,
      },
      subscriptionId: session.subscription,
    });

    const job = queueSaleActivation(paidSale.id, paidSale.businessId);

    logActivity({
      kind: "sales",
      stage: "payment-received",
      businessId: paidSale.businessId,
      message: `Stripe payment completed for sale ${paidSale.id}. Activation job ${job.id} queued.`,
    });

    return NextResponse.json({ received: true, saleId: paidSale.id, jobId: job.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stripe webhook failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

