import { getDb } from "./db";
import { initializeDatabase } from "./schema";

export interface ActivityLogEntry {
  id: number;
  kind: string;
  stage: string;
  businessId: number | null;
  businessName: string | null;
  message: string;
  createdAt: string;
}

export function logActivity(input: {
  kind: string;
  stage: string;
  businessId?: number | null;
  businessName?: string | null;
  message: string;
}): void {
  initializeDatabase();
  const db = getDb();

  db.prepare(
    `INSERT INTO activity_logs (
      kind,
      stage,
      business_id,
      business_name,
      message
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    input.kind,
    input.stage,
    input.businessId ?? null,
    input.businessName ?? null,
    input.message
  );

  // Keep the log compact so the UI remains responsive.
  db.prepare(
    `DELETE FROM activity_logs
    WHERE id NOT IN (
      SELECT id
      FROM activity_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    )`
  ).run();
}

export function listRecentActivity(
  limit = 25,
  kind?: string
): ActivityLogEntry[] {
  initializeDatabase();
  const db = getDb();

  const rows = kind
    ? db
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
          WHERE kind = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`
        )
        .all(kind, limit)
    : db
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
          ORDER BY created_at DESC, id DESC
          LIMIT ?`
        )
        .all(limit);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    kind: String(row.kind ?? ""),
    stage: String(row.stage ?? ""),
    businessId:
      typeof row.business_id === "number" ? row.business_id : Number(row.business_id ?? 0) || null,
    businessName:
      typeof row.business_name === "string" ? row.business_name : null,
    message: String(row.message ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
}
