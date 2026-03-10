import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/schema";
import { deployCustomerProjectForBusiness } from "@/lib/vercel-sites";

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

    const body = (await request.json().catch(() => ({}))) as {
      customerDomain?: unknown;
    };
    if (
      body.customerDomain !== undefined &&
      body.customerDomain !== null &&
      typeof body.customerDomain !== "string"
    ) {
      return NextResponse.json(
        { error: "customerDomain must be a string when provided" },
        { status: 400 }
      );
    }

    const deployment = await deployCustomerProjectForBusiness(businessId, {
      customerDomain:
        typeof body.customerDomain === "string" ? body.customerDomain : null,
    });

    return NextResponse.json({
      success: true,
      deployment,
    });
  } catch (error) {
    console.error("Deploy customer error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("not found") || message.includes("No generated site")
        ? 404
        : message.includes("token") ||
            message.includes("Settings") ||
            message.startsWith("Add ")
          ? 422
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
