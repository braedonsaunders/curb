import { NextRequest, NextResponse } from "next/server";
import { listRecentActivity } from "@/lib/activity-log";
import { getConfig } from "@/lib/config";
import { ensureEnrichmentWorkerRunning } from "@/lib/core/enrichment";
import { getDb } from "@/lib/db";
import { initializeDatabase } from "@/lib/schema";

export async function GET(request: NextRequest) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const db = getDb();
    const config = getConfig();

    const limit = Math.min(
      50,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") || "20", 10))
    );
    const kind = request.nextUrl.searchParams.get("kind") || undefined;
    const businessIdParam = request.nextUrl.searchParams.get("businessId");
    const businessId =
      businessIdParam && !Number.isNaN(Number.parseInt(businessIdParam, 10))
        ? Number.parseInt(businessIdParam, 10)
        : null;

    const recent = businessId
      ? (db
          .prepare(
            `SELECT
              id,
              kind,
              stage,
              business_id,
              business_name,
              message,
              created_at
            FROM activity_logs
            WHERE business_id = ?
              ${kind ? "AND kind = ?" : ""}
            ORDER BY created_at DESC, id DESC
            LIMIT ?`
          )
          .all(
            ...(kind ? [businessId, kind, limit] : [businessId, limit])
          ) as Array<Record<string, unknown>>).map((row) => ({
          id: Number(row.id),
          kind: String(row.kind ?? ""),
          stage: String(row.stage ?? ""),
          businessId:
            typeof row.business_id === "number"
              ? row.business_id
              : Number(row.business_id ?? 0) || null,
          businessName:
            typeof row.business_name === "string" ? row.business_name : null,
          message: String(row.message ?? ""),
          createdAt: String(row.created_at ?? ""),
        }))
      : listRecentActivity(limit, kind);
    const current = db
      .prepare(
        `SELECT
          id,
          name,
          enrichment_status,
          enrichment_started_at
        FROM businesses
        WHERE enrichment_status = 'in_progress'
        ORDER BY enrichment_started_at ASC
        LIMIT 1`
      )
      .get() as
      | {
          id: number;
          name: string;
          enrichment_status: string;
          enrichment_started_at: string | null;
        }
      | undefined;
    const queue = db
      .prepare(
        `SELECT
          SUM(CASE WHEN enrichment_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN enrichment_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN enrichment_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN enrichment_status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM businesses
        WHERE status != 'archived'`
      )
      .get() as {
      pending: number | null;
      in_progress: number | null;
      failed: number | null;
      completed: number | null;
    };

    const currentLog =
      current &&
      ((db
        .prepare(
          `SELECT
            id,
            kind,
            stage,
            business_id,
            business_name,
            message,
            created_at
          FROM activity_logs
          WHERE business_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1`
        )
        .get(current.id) as Record<string, unknown> | undefined) ??
        null);

    return NextResponse.json({
      enabled: config.autoEnrichmentEnabled,
      current: current
        ? {
            id: current.id,
            name: current.name,
            status: current.enrichment_status,
            startedAt: current.enrichment_started_at,
            stage:
              currentLog && typeof currentLog.stage === "string"
                ? currentLog.stage
                : "working",
            message:
              currentLog && typeof currentLog.message === "string"
                ? currentLog.message
                : `Evaluating ${current.name}`,
          }
        : null,
      queue: {
        pending: queue.pending ?? 0,
        inProgress: queue.in_progress ?? 0,
        failed: queue.failed ?? 0,
        completed: queue.completed ?? 0,
      },
      recent,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
