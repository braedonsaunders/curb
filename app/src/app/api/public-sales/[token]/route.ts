import { NextRequest, NextResponse } from "next/server";

import { ensureActivationWorkerRunning } from "@/lib/activation-jobs";
import { getDb } from "@/lib/db";
import { getSaleByPublicToken } from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  void request;

  try {
    initializeDatabase();
    ensureActivationWorkerRunning();

    const { token } = await params;
    const sale = getSaleByPublicToken(token);
    if (!sale) {
      return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    }

    const db = getDb();
    const business = db
      .prepare("SELECT name FROM businesses WHERE id = ?")
      .get(sale.businessId) as { name: string } | undefined;
    const metadata = sale.metadata ?? {};
    const customerDeployment =
      metadata.customerDeployment &&
      typeof metadata.customerDeployment === "object"
        ? (metadata.customerDeployment as Record<string, unknown>)
        : null;
    const liveUrl =
      text(customerDeployment?.liveUrl) ||
      text(customerDeployment?.deploymentUrl) ||
      "";

    return NextResponse.json({
      businessName: text(business?.name) || "Website purchase",
      customerSiteUrl: liveUrl || null,
      downloadUrl:
        sale.mode === "handoff" &&
        (sale.status === "paid" ||
          sale.status === "fulfilled" ||
          sale.status === "activation-failed")
          ? `/api/public-sales/${encodeURIComponent(sale.publicToken)}/download`
          : null,
      mode: sale.mode,
      paidAt: sale.paidAt,
      publicToken: sale.publicToken,
      status: sale.status,
      stripePaymentLinkUrl: sale.stripePaymentLinkUrl,
      updatedAt: sale.updatedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load purchase";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
