import { logActivity } from "../activity-log";
import { getConfig, updateConfig } from "../config";
import { auditBusiness } from "./audit";
import { getDb } from "../db";
import { getPlaceDetails } from "../places";
import { initializeDatabase } from "../schema";

const ENRICHMENT_POLL_MS = 5000;
const FAILED_RETRY_DELAY_SQL = "datetime('now', '-10 minutes')";

type EnrichmentWorkerState = {
  intervalId: ReturnType<typeof setInterval> | null;
  followUpTimer: ReturnType<typeof setTimeout> | null;
  running: boolean;
};

type BusinessRow = {
  id: number;
  place_id: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  review_count: number | null;
  hours_json: string | null;
  photos_json: string | null;
  details_enriched_at: string | null;
  enrichment_completed_at: string | null;
};

type LatestAuditRow = {
  id: number;
  has_website: number;
  website_complexity: string | null;
  replacement_difficulty: string | null;
  advanced_features_json: string | null;
  created_at: string | null;
} | null;

declare global {
  var __curbEnrichmentWorkerState: EnrichmentWorkerState | undefined;
}

function getWorkerState(): EnrichmentWorkerState {
  if (!globalThis.__curbEnrichmentWorkerState) {
    globalThis.__curbEnrichmentWorkerState = {
      intervalId: null,
      followUpTimer: null,
      running: false,
    };
  }

  return globalThis.__curbEnrichmentWorkerState;
}

function scheduleFollowUpPass(delayMs: number): void {
  const state = getWorkerState();
  if (state.followUpTimer) {
    return;
  }

  state.followUpTimer = setTimeout(() => {
    state.followUpTimer = null;
    void runPendingEnrichmentPass();
  }, delayMs);

  state.followUpTimer.unref?.();
}

export function isAutoEnrichmentEnabled(): boolean {
  return getConfig().autoEnrichmentEnabled;
}

export function setAutoEnrichmentEnabled(enabled: boolean): boolean {
  updateConfig({ autoEnrichmentEnabled: enabled });
  logActivity({
    kind: "enrichment",
    stage: enabled ? "resumed" : "paused",
    message: enabled ? "Automatic enrichment resumed" : "Automatic enrichment paused",
  });

  if (enabled) {
    scheduleFollowUpPass(0);
  }

  return enabled;
}

export function requeueBusinessesForEnrichment(
  businessIds: number[]
): { queued: number; skippedInProgress: number } {
  initializeDatabase();
  const db = getDb();
  const ids = Array.from(
    new Set(
      businessIds.filter((value) => Number.isInteger(value) && value > 0)
    )
  );

  if (ids.length === 0) {
    return { queued: 0, skippedInProgress: 0 };
  }

  const inProgressRows = db
    .prepare(
      `SELECT id
      FROM businesses
      WHERE id IN (${ids.map(() => "?").join(", ")})
        AND status != 'archived'
        AND enrichment_status = 'in_progress'`
    )
    .all(...ids) as Array<{ id: number }>;
  const inProgressIds = new Set(inProgressRows.map((row) => row.id));
  const queueableRows = db
    .prepare(
      `SELECT id, name
      FROM businesses
      WHERE id IN (${ids.map(() => "?").join(", ")})
        AND status != 'archived'
        AND COALESCE(enrichment_status, 'pending') != 'in_progress'`
    )
    .all(...ids) as Array<{ id: number; name: string }>;
  const queueableIds = queueableRows.map((row) => row.id);

  if (queueableIds.length > 0) {
    db.prepare(
      `UPDATE businesses
      SET
        enrichment_status = 'pending',
        details_enriched_at = NULL,
        enrichment_started_at = NULL,
        enrichment_completed_at = NULL,
        enrichment_error = NULL,
        updated_at = datetime('now')
      WHERE id IN (${queueableIds.map(() => "?").join(", ")})`
    ).run(...queueableIds);

    for (const row of queueableRows) {
      logActivity({
        kind: "enrichment",
        stage: "requeued",
        businessId: row.id,
        businessName: row.name,
        message: `Requeued enrichment for ${row.name}`,
      });
    }
  }

  if (queueableIds.length > 0 && isAutoEnrichmentEnabled()) {
    scheduleFollowUpPass(0);
  }

  return {
    queued: queueableIds.length,
    skippedInProgress: inProgressIds.size,
  };
}

export function requeueAllBusinessesForEnrichment(): {
  queued: number;
  skippedInProgress: number;
} {
  initializeDatabase();
  const db = getDb();

  const skippedInProgressRow = db
    .prepare(
      `SELECT COUNT(*) as count
      FROM businesses
      WHERE status != 'archived'
        AND enrichment_status = 'in_progress'`
    )
    .get() as { count: number };
  const queuedRow = db
    .prepare(
      `SELECT COUNT(*) as count
      FROM businesses
      WHERE status != 'archived'
        AND COALESCE(enrichment_status, 'pending') != 'in_progress'`
    )
    .get() as { count: number };

  const skippedInProgress = skippedInProgressRow.count;
  const queued = queuedRow.count;

  if (queued > 0) {
    db.prepare(
      `UPDATE businesses
      SET
        enrichment_status = 'pending',
        details_enriched_at = NULL,
        enrichment_started_at = NULL,
        enrichment_completed_at = NULL,
        enrichment_error = NULL,
        updated_at = datetime('now')
      WHERE status != 'archived'
        AND COALESCE(enrichment_status, 'pending') != 'in_progress'`
    ).run();

    logActivity({
      kind: "enrichment",
      stage: "requeued",
      message: `Requeued enrichment for ${queued} business${queued === 1 ? "" : "es"}`,
    });
  }

  if (queued > 0 && isAutoEnrichmentEnabled()) {
    scheduleFollowUpPass(0);
  }

  return {
    queued,
    skippedInProgress,
  };
}

function deriveAddressParts(addressComponents: Array<{
  long_name: string;
  short_name: string;
  types: string[];
}>): {
  city: string | null;
  province: string | null;
  postalCode: string | null;
} {
  let city: string | null = null;
  let province: string | null = null;
  let postalCode: string | null = null;

  for (const component of addressComponents) {
    if (component.types.includes("locality")) {
      city = component.long_name;
    }

    if (component.types.includes("administrative_area_level_1")) {
      province = component.short_name;
    }

    if (component.types.includes("postal_code")) {
      postalCode = component.long_name;
    }
  }

  return { city, province, postalCode };
}

function getLatestAuditForBusiness(businessId: number): LatestAuditRow {
  const db = getDb();

  return (db
    .prepare(
      `SELECT
        id,
        has_website,
        website_complexity,
        replacement_difficulty,
        advanced_features_json,
        created_at
      FROM audits
      WHERE business_id = ? AND audit_version = 2
      ORDER BY created_at DESC
      LIMIT 1`
    )
    .get(businessId) as LatestAuditRow) ?? null;
}

function shouldRunVisualAudit(
  business: BusinessRow,
  latestAudit: LatestAuditRow
): boolean {
  if (!business.enrichment_completed_at) {
    return true;
  }

  if (!latestAudit) {
    return true;
  }

  if (
    latestAudit.website_complexity == null ||
    latestAudit.replacement_difficulty == null ||
    latestAudit.advanced_features_json == null
  ) {
    return true;
  }

  if (
    business.details_enriched_at &&
    latestAudit.created_at &&
    latestAudit.created_at < business.details_enriched_at
  ) {
    return true;
  }

  return false;
}

function findNextBusinessIdForEnrichment(): number | null {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT b.id
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = b.id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      WHERE b.status != 'archived'
        AND COALESCE(b.enrichment_status, 'pending') != 'in_progress'
        AND (
          COALESCE(b.enrichment_status, 'pending') = 'pending'
          OR
          b.details_enriched_at IS NULL
          OR latest_audit.id IS NULL
          OR latest_audit.website_complexity IS NULL
          OR latest_audit.replacement_difficulty IS NULL
          OR latest_audit.advanced_features_json IS NULL
        )
        AND (
          COALESCE(b.enrichment_status, 'pending') != 'failed'
          OR b.enrichment_started_at IS NULL
          OR b.enrichment_started_at <= ${FAILED_RETRY_DELAY_SQL}
        )
      ORDER BY
        CASE COALESCE(b.enrichment_status, 'pending')
          WHEN 'pending' THEN 0
          WHEN 'failed' THEN 1
          ELSE 2
        END,
        COALESCE(b.enrichment_completed_at, b.updated_at, b.created_at) ASC
      LIMIT 1`
    )
    .get() as { id: number } | undefined;

  return row?.id ?? null;
}

function claimBusinessForEnrichment(businessId: number): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE businesses
      SET
        enrichment_status = 'in_progress',
        enrichment_started_at = datetime('now'),
        enrichment_error = NULL,
        enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1,
        updated_at = datetime('now')
      WHERE id = ?
        AND COALESCE(enrichment_status, 'pending') != 'in_progress'`
    )
    .run(businessId);

  return result.changes > 0;
}

async function syncBusinessPlaceDetails(business: BusinessRow): Promise<void> {
  const details = await getPlaceDetails(business.place_id);
  const { city, province, postalCode } = deriveAddressParts(
    details.address_components ?? []
  );
  const db = getDb();

  db.prepare(
    `UPDATE businesses
    SET
      name = ?,
      category = COALESCE(?, category),
      address = ?,
      city = ?,
      province = ?,
      postal_code = ?,
      phone = ?,
      website_url = ?,
      google_maps_url = ?,
      latitude = ?,
      longitude = ?,
      rating = ?,
      review_count = ?,
      hours_json = ?,
      photos_json = ?,
      details_enriched_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    details.name || business.name,
    details.types?.[0] ?? business.category,
    details.formatted_address ?? business.address,
    city ?? business.city,
    province ?? business.province,
    postalCode ?? business.postal_code,
    details.formatted_phone_number ?? business.phone,
    details.website ?? business.website_url,
    details.url ?? business.google_maps_url,
    details.geometry?.location.lat ?? business.latitude,
    details.geometry?.location.lng ?? business.longitude,
    details.rating ?? business.rating,
    details.user_ratings_total ?? business.review_count,
    details.opening_hours?.weekday_text
      ? JSON.stringify(details.opening_hours.weekday_text)
      : business.hours_json,
    details.photos?.length
      ? JSON.stringify(details.photos.map((photo) => photo.photo_reference))
      : business.photos_json,
    business.id
  );
}

function markBusinessEnrichmentComplete(businessId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE businesses
    SET
      enrichment_status = 'completed',
      enrichment_completed_at = datetime('now'),
      enrichment_error = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(businessId);
}

function markBusinessEnrichmentFailed(
  businessId: number,
  error: string
): void {
  const db = getDb();
  db.prepare(
    `UPDATE businesses
    SET
      enrichment_status = 'failed',
      enrichment_error = ?,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(error, businessId);
}

export async function enrichBusiness(businessId: number): Promise<void> {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare(
      `SELECT
        id,
        place_id,
        name,
        category,
        address,
        city,
        province,
        postal_code,
        phone,
        website_url,
        google_maps_url,
        latitude,
        longitude,
        rating,
        review_count,
        hours_json,
        photos_json,
        details_enriched_at,
        enrichment_completed_at
      FROM businesses
      WHERE id = ?`
    )
    .get(businessId) as BusinessRow | undefined;

  if (!business) {
    return;
  }

  try {
    logActivity({
      kind: "enrichment",
      stage: "start",
      businessId: business.id,
      businessName: business.name,
      message: `Evaluating ${business.name}`,
    });

    if (!business.details_enriched_at) {
      logActivity({
        kind: "enrichment",
        stage: "details",
        businessId: business.id,
        businessName: business.name,
        message: `Fetching Google Place details for ${business.name}`,
      });
      await syncBusinessPlaceDetails(business);
    }

    const refreshedBusiness = db
      .prepare(
        `SELECT
          id,
          place_id,
          name,
          category,
          address,
          city,
          province,
          postal_code,
          phone,
          website_url,
          google_maps_url,
          latitude,
          longitude,
          rating,
          review_count,
          hours_json,
          photos_json,
          details_enriched_at,
          enrichment_completed_at
        FROM businesses
        WHERE id = ?`
      )
      .get(businessId) as BusinessRow;

    const latestAudit = getLatestAuditForBusiness(businessId);
    if (shouldRunVisualAudit(refreshedBusiness, latestAudit)) {
      logActivity({
        kind: "enrichment",
        stage: "audit",
        businessId: refreshedBusiness.id,
        businessName: refreshedBusiness.name,
        message: `Evaluating current website for ${refreshedBusiness.name}`,
      });
      await auditBusiness(businessId);
    }

    markBusinessEnrichmentComplete(businessId);
    logActivity({
      kind: "enrichment",
      stage: "complete",
      businessId: refreshedBusiness.id,
      businessName: refreshedBusiness.name,
      message: `Completed enrichment for ${refreshedBusiness.name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markBusinessEnrichmentFailed(businessId, message);
    logActivity({
      kind: "enrichment",
      stage: "failed",
      businessId: business.id,
      businessName: business.name,
      message: `Enrichment failed for ${business.name}`,
    });
    throw error;
  }
}

export async function runPendingEnrichmentPass(): Promise<void> {
  initializeDatabase();
  const state = getWorkerState();

  if (!isAutoEnrichmentEnabled()) {
    return;
  }

  if (state.running) {
    return;
  }

  state.running = true;

  try {
    const nextBusinessId = findNextBusinessIdForEnrichment();
    if (!nextBusinessId) {
      return;
    }

    if (!claimBusinessForEnrichment(nextBusinessId)) {
      scheduleFollowUpPass(250);
      return;
    }

    try {
      await enrichBusiness(nextBusinessId);
    } catch (error) {
      console.error(
        `Failed to enrich business ${nextBusinessId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } finally {
    state.running = false;
  }

  if (findNextBusinessIdForEnrichment() != null) {
    scheduleFollowUpPass(750);
  }
}

export function ensureEnrichmentWorkerRunning(): void {
  if (typeof window !== "undefined") {
    return;
  }

  initializeDatabase();
  const state = getWorkerState();

  if (!state.intervalId) {
    state.intervalId = setInterval(() => {
      void runPendingEnrichmentPass();
    }, ENRICHMENT_POLL_MS);

    state.intervalId.unref?.();
  }

  scheduleFollowUpPass(0);
}
