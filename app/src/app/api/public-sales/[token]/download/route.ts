import { NextRequest, NextResponse } from "next/server";

import { exportSite } from "@/lib/core/export";
import { getDb } from "@/lib/db";
import { getSaleByPublicToken } from "@/lib/sales";
import { initializeDatabase } from "@/lib/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  void request;

  try {
    initializeDatabase();

    const { token } = await params;
    const sale = getSaleByPublicToken(token);
    if (!sale) {
      return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    }

    if (
      sale.mode !== "handoff" ||
      !["paid", "fulfilled", "activation-failed"].includes(sale.status)
    ) {
      return NextResponse.json(
        { error: "This purchase does not have a downloadable ZIP." },
        { status: 409 }
      );
    }

    const db = getDb();
    const business = db
      .prepare("SELECT slug FROM businesses WHERE id = ?")
      .get(sale.businessId) as { slug: string } | undefined;
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const zipBuffer = await exportSite(business.slug);
    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${business.slug}-website.zip"`,
        "Content-Length": String(zipBuffer.length),
        "Content-Type": "application/zip",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export purchase ZIP";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

