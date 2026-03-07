import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  ensureEnrichmentWorkerRunning,
  requeueBusinessesForEnrichment,
  runPendingEnrichmentPass,
  setAutoEnrichmentEnabled,
} from "@/lib/core/enrichment";
import { initializeDatabase } from "@/lib/schema";

export async function GET() {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const config = getConfig();

    return NextResponse.json({
      enabled: config.autoEnrichmentEnabled,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load enrichment state";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();

    const body = (await request.json()) as {
      action?: string;
      businessIds?: number[];
    };

    if (body.action === "pause") {
      setAutoEnrichmentEnabled(false);
      return NextResponse.json({
        success: true,
        enabled: false,
        message: "Automatic enrichment paused",
      });
    }

    if (body.action === "resume") {
      setAutoEnrichmentEnabled(true);
      void runPendingEnrichmentPass();
      return NextResponse.json({
        success: true,
        enabled: true,
        message: "Automatic enrichment resumed",
      });
    }

    if (body.action === "rerun") {
      const ids = Array.isArray(body.businessIds)
        ? body.businessIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [];

      if (ids.length === 0) {
        return NextResponse.json(
          { error: "businessIds must contain at least one business ID" },
          { status: 400 }
        );
      }

      const result = requeueBusinessesForEnrichment(ids);
      void runPendingEnrichmentPass();

      return NextResponse.json({
        success: true,
        enabled: getConfig().autoEnrichmentEnabled,
        queued: result.queued,
        skippedInProgress: result.skippedInProgress,
      });
    }

    return NextResponse.json(
      { error: "Unsupported enrichment action" },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update enrichment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
