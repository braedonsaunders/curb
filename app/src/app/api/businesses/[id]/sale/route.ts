import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { saveSaleDraftForBusiness } from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
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
    const exists = db
      .prepare("SELECT id FROM businesses WHERE id = ?")
      .get(businessId) as { id: number } | undefined;
    if (!exists) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { sale?: Record<string, unknown> }
      | null;
    if (!body?.sale || typeof body.sale !== "object") {
      return NextResponse.json(
        { error: 'Request body must include a "sale" object.' },
        { status: 400 }
      );
    }

    const sale = saveSaleDraftForBusiness(businessId, body.sale);
    return NextResponse.json({ ok: true, sale });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save sale draft";
    const status =
      message.includes("Invalid business ID")
        ? 400
        : message.includes("Business not found")
          ? 404
        : message.includes("amount") || message.includes("Managed")
            ? 400
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
