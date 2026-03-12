import { NextRequest, NextResponse } from "next/server";

import {
  ensureActivationWorkerRunning,
  queueSaleActivation,
} from "@/lib/activation-jobs";
import { getLatestSaleForBusiness } from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  void request;

  try {
    initializeDatabase();
    ensureActivationWorkerRunning();

    const { id } = await context.params;
    const businessId = Number.parseInt(id, 10);

    if (!Number.isFinite(businessId)) {
      return NextResponse.json(
        { error: "Invalid business ID" },
        { status: 400 }
      );
    }

    const sale = getLatestSaleForBusiness(businessId);
    if (!sale) {
      return NextResponse.json(
        { error: "No sale exists for this business yet." },
        { status: 404 }
      );
    }

    if (sale.status === "draft" || sale.status === "payment-pending") {
      return NextResponse.json(
        { error: "This sale has not been paid yet." },
        { status: 409 }
      );
    }

    const job = queueSaleActivation(sale.id, businessId);
    return NextResponse.json({ ok: true, job, sale });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to queue activation";
    const status =
      message.includes("Invalid business ID")
        ? 400
        : message.includes("No sale")
          ? 404
        : message.includes("paid")
            ? 409
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
