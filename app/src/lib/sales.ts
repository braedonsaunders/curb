import crypto from "crypto";

import { getDb } from "./db";
import { initializeDatabase } from "./schema";

export type SaleMode = "handoff" | "managed";
export type SaleStatus =
  | "draft"
  | "payment-pending"
  | "paid"
  | "fulfilled"
  | "activation-failed"
  | "cancelled";

export type ActivationJobStatus = "queued" | "running" | "completed" | "failed";

export interface SaleRecord {
  id: number;
  businessId: number;
  publicToken: string;
  mode: SaleMode;
  status: SaleStatus;
  currency: string;
  oneTimeAmountCents: number;
  monthlyAmountCents: number;
  description: string;
  customerEmail: string;
  customerName: string;
  notes: string;
  stripePaymentLinkId: string | null;
  stripePaymentLinkUrl: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationJobRecord {
  id: number;
  businessId: number;
  saleId: number | null;
  kind: string;
  status: ActivationJobStatus;
  attemptCount: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleDraftInput {
  mode?: unknown;
  currency?: unknown;
  oneTimeAmountCents?: unknown;
  monthlyAmountCents?: unknown;
  description?: unknown;
  customerEmail?: unknown;
  customerName?: unknown;
  notes?: unknown;
}

type RawSaleRow = {
  id: number;
  business_id: number;
  public_token: string;
  mode: string;
  status: string;
  currency: string;
  one_time_amount_cents: number | null;
  monthly_amount_cents: number | null;
  description: string | null;
  customer_email: string | null;
  customer_name: string | null;
  notes: string | null;
  stripe_payment_link_id: string | null;
  stripe_payment_link_url: string | null;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type RawActivationJobRow = {
  id: number;
  business_id: number;
  sale_id: number | null;
  kind: string;
  status: string;
  attempt_count: number | null;
  error_message: string | null;
  result_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeCurrency(value: unknown): string {
  const normalized = text(value).toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : "usd";
}

export function normalizeSaleMode(value: unknown): SaleMode {
  return text(value).toLowerCase() === "managed" ? "managed" : "handoff";
}

export function normalizeSaleStatus(value: unknown): SaleStatus {
  const normalized = text(value).toLowerCase();
  if (
    normalized === "payment-pending" ||
    normalized === "paid" ||
    normalized === "fulfilled" ||
    normalized === "activation-failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }

  return "draft";
}

function normalizeActivationJobStatus(value: unknown): ActivationJobStatus {
  const normalized = text(value).toLowerCase();
  if (normalized === "running" || normalized === "completed" || normalized === "failed") {
    return normalized;
  }

  return "queued";
}

function normalizeAmount(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapSaleRow(row: RawSaleRow | undefined): SaleRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    businessId: row.business_id,
    publicToken: text(row.public_token),
    mode: normalizeSaleMode(row.mode),
    status: normalizeSaleStatus(row.status),
    currency: normalizeCurrency(row.currency),
    oneTimeAmountCents: normalizeAmount(row.one_time_amount_cents),
    monthlyAmountCents: normalizeAmount(row.monthly_amount_cents),
    description: text(row.description),
    customerEmail: text(row.customer_email),
    customerName: text(row.customer_name),
    notes: text(row.notes),
    stripePaymentLinkId: text(row.stripe_payment_link_id) || null,
    stripePaymentLinkUrl: text(row.stripe_payment_link_url) || null,
    stripeCheckoutSessionId: text(row.stripe_checkout_session_id) || null,
    stripeCustomerId: text(row.stripe_customer_id) || null,
    stripeSubscriptionId: text(row.stripe_subscription_id) || null,
    paidAt: text(row.paid_at) || null,
    fulfilledAt: text(row.fulfilled_at) || null,
    errorMessage: text(row.error_message) || null,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapActivationJobRow(
  row: RawActivationJobRow | undefined
): ActivationJobRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    businessId: row.business_id,
    saleId: typeof row.sale_id === "number" ? row.sale_id : null,
    kind: text(row.kind),
    status: normalizeActivationJobStatus(row.status),
    attemptCount: normalizeAmount(row.attempt_count),
    errorMessage: text(row.error_message) || null,
    result: parseJsonObject(row.result_json),
    startedAt: text(row.started_at) || null,
    completedAt: text(row.completed_at) || null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function generatePublicToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function loadBusinessContact(
  businessId: number
): { email: string | null; name: string | null } {
  const db = getDb();
  const row = db
    .prepare("SELECT email, name FROM businesses WHERE id = ?")
    .get(businessId) as { email: string | null; name: string | null } | undefined;

  return {
    email: text(row?.email) || null,
    name: text(row?.name) || null,
  };
}

export function listActivationJobsForBusiness(
  businessId: number
): ActivationJobRecord[] {
  initializeDatabase();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
      FROM activation_jobs
      WHERE business_id = ?
      ORDER BY created_at DESC, id DESC`
    )
    .all(businessId) as RawActivationJobRow[];

  return rows
    .map((row) => mapActivationJobRow(row))
    .filter((row): row is ActivationJobRecord => row !== null);
}

export function getLatestSaleForBusiness(businessId: number): SaleRecord | null {
  initializeDatabase();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
      FROM sales
      WHERE business_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`
    )
    .get(businessId) as RawSaleRow | undefined;

  return mapSaleRow(row);
}

export function getSaleById(saleId: number): SaleRecord | null {
  initializeDatabase();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sales WHERE id = ?")
    .get(saleId) as RawSaleRow | undefined;

  return mapSaleRow(row);
}

export function getSaleByPublicToken(token: string): SaleRecord | null {
  initializeDatabase();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sales WHERE public_token = ?")
    .get(text(token)) as RawSaleRow | undefined;

  return mapSaleRow(row);
}

export function getSaleByStripePaymentLinkId(
  paymentLinkId: string
): SaleRecord | null {
  initializeDatabase();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
      FROM sales
      WHERE stripe_payment_link_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`
    )
    .get(text(paymentLinkId)) as RawSaleRow | undefined;

  return mapSaleRow(row);
}

function createSale(
  businessId: number,
  input: Required<
    Pick<
      SaleRecord,
      | "mode"
      | "currency"
      | "oneTimeAmountCents"
      | "monthlyAmountCents"
      | "description"
      | "customerEmail"
      | "customerName"
      | "notes"
    >
  >
): SaleRecord {
  const db = getDb();
  const publicToken = generatePublicToken();
  const result = db
    .prepare(
      `INSERT INTO sales (
        business_id,
        public_token,
        mode,
        status,
        currency,
        one_time_amount_cents,
        monthly_amount_cents,
        description,
        customer_email,
        customer_name,
        notes
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      businessId,
      publicToken,
      input.mode,
      input.currency,
      input.oneTimeAmountCents,
      input.monthlyAmountCents,
      input.description,
      input.customerEmail || null,
      input.customerName || null,
      input.notes || null
    );

  return getSaleById(Number(result.lastInsertRowid)) as SaleRecord;
}

function validateSaleDraft(draft: SaleDraftInput): {
  mode: SaleMode;
  currency: string;
  oneTimeAmountCents: number;
  monthlyAmountCents: number;
  description: string;
  customerEmail: string;
  customerName: string;
  notes: string;
} {
  const mode = normalizeSaleMode(draft.mode);
  const currency = normalizeCurrency(draft.currency);
  const oneTimeAmountCents = normalizeAmount(draft.oneTimeAmountCents);
  const monthlyAmountCents = normalizeAmount(draft.monthlyAmountCents);
  const description = text(draft.description).slice(0, 1000);
  const customerEmail = text(draft.customerEmail).slice(0, 320).toLowerCase();
  const customerName = text(draft.customerName).slice(0, 200);
  const notes = text(draft.notes).slice(0, 4000);

  if (mode === "managed" && monthlyAmountCents <= 0) {
    throw new Error("Managed sales need a monthly hosting amount.");
  }

  if (oneTimeAmountCents <= 0 && monthlyAmountCents <= 0) {
    throw new Error("Add either a one-time amount or a monthly amount.");
  }

  return {
    mode,
    currency,
    oneTimeAmountCents,
    monthlyAmountCents,
    description,
    customerEmail,
    customerName,
    notes,
  };
}

export function saveSaleDraftForBusiness(
  businessId: number,
  draft: SaleDraftInput
): SaleRecord {
  initializeDatabase();
  const db = getDb();
  const normalized = validateSaleDraft(draft);
  const latestSale = getLatestSaleForBusiness(businessId);
  const businessContact = loadBusinessContact(businessId);
  const customerEmail = normalized.customerEmail || businessContact.email || "";
  const customerName = normalized.customerName || businessContact.name || "";

  if (
    latestSale &&
    (latestSale.status === "draft" ||
      latestSale.status === "payment-pending" ||
      latestSale.status === "activation-failed")
  ) {
    db.prepare(
      `UPDATE sales
      SET
        mode = ?,
        currency = ?,
        one_time_amount_cents = ?,
        monthly_amount_cents = ?,
        description = ?,
        customer_email = ?,
        customer_name = ?,
        notes = ?,
        stripe_payment_link_id = NULL,
        stripe_payment_link_url = NULL,
        stripe_checkout_session_id = NULL,
        stripe_customer_id = NULL,
        stripe_subscription_id = NULL,
        paid_at = NULL,
        fulfilled_at = NULL,
        error_message = NULL,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      normalized.mode,
      normalized.currency,
      normalized.oneTimeAmountCents,
      normalized.monthlyAmountCents,
      normalized.description || null,
      customerEmail || null,
      customerName || null,
      normalized.notes || null,
      latestSale.id
    );

    return getSaleById(latestSale.id) as SaleRecord;
  }

  return createSale(businessId, {
    ...normalized,
    customerEmail,
    customerName,
  });
}

export function setSalePaymentLink(
  saleId: number,
  paymentLinkId: string,
  paymentLinkUrl: string
): SaleRecord {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE sales
    SET
      status = 'payment-pending',
      stripe_payment_link_id = ?,
      stripe_payment_link_url = ?,
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    text(paymentLinkId) || null,
    text(paymentLinkUrl) || null,
    saleId
  );

  return getSaleById(saleId) as SaleRecord;
}

export function markSalePaid(
  saleId: number,
  input: {
    checkoutSessionId: string;
    customerId?: string | null;
    subscriptionId?: string | null;
    customerEmail?: string | null;
    customerName?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): SaleRecord {
  initializeDatabase();
  const db = getDb();
  const existing = getSaleById(saleId);
  const nextMetadata = {
    ...(existing?.metadata ?? {}),
    ...(input.metadata ?? {}),
  };

  db.prepare(
    `UPDATE sales
    SET
      status = 'paid',
      stripe_checkout_session_id = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id),
      customer_email = COALESCE(?, customer_email),
      customer_name = COALESCE(?, customer_name),
      paid_at = COALESCE(paid_at, datetime('now')),
      metadata_json = ?,
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    text(input.checkoutSessionId),
    text(input.customerId) || null,
    text(input.subscriptionId) || null,
    text(input.customerEmail).toLowerCase() || null,
    text(input.customerName) || null,
    Object.keys(nextMetadata).length > 0 ? JSON.stringify(nextMetadata) : null,
    saleId
  );

  return getSaleById(saleId) as SaleRecord;
}

export function markSaleFulfilled(
  saleId: number,
  metadata?: Record<string, unknown> | null
): SaleRecord {
  initializeDatabase();
  const db = getDb();
  const existing = getSaleById(saleId);
  const nextMetadata = {
    ...(existing?.metadata ?? {}),
    ...(metadata ?? {}),
  };

  db.prepare(
    `UPDATE sales
    SET
      status = 'fulfilled',
      fulfilled_at = COALESCE(fulfilled_at, datetime('now')),
      metadata_json = ?,
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    Object.keys(nextMetadata).length > 0 ? JSON.stringify(nextMetadata) : null,
    saleId
  );

  return getSaleById(saleId) as SaleRecord;
}

export function markSaleActivationFailed(
  saleId: number,
  errorMessage: string,
  metadata?: Record<string, unknown> | null
): SaleRecord {
  initializeDatabase();
  const db = getDb();
  const existing = getSaleById(saleId);
  const nextMetadata = {
    ...(existing?.metadata ?? {}),
    ...(metadata ?? {}),
  };

  db.prepare(
    `UPDATE sales
    SET
      status = 'activation-failed',
      error_message = ?,
      metadata_json = ?,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    text(errorMessage) || "Activation failed.",
    Object.keys(nextMetadata).length > 0 ? JSON.stringify(nextMetadata) : null,
    saleId
  );

  return getSaleById(saleId) as SaleRecord;
}

export function queueActivationJob(
  businessId: number,
  saleId: number,
  kind = "post-payment-activation"
): ActivationJobRecord {
  initializeDatabase();
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT *
      FROM activation_jobs
      WHERE business_id = ?
        AND sale_id = ?
        AND kind = ?
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC, id DESC
      LIMIT 1`
    )
    .get(businessId, saleId, kind) as RawActivationJobRow | undefined;

  if (existing) {
    return mapActivationJobRow(existing) as ActivationJobRecord;
  }

  const result = db
    .prepare(
      `INSERT INTO activation_jobs (
        business_id,
        sale_id,
        kind,
        status
      ) VALUES (?, ?, ?, 'queued')`
    )
    .run(businessId, saleId, kind);

  return getActivationJobById(Number(result.lastInsertRowid)) as ActivationJobRecord;
}

export function getActivationJobById(
  jobId: number
): ActivationJobRecord | null {
  initializeDatabase();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM activation_jobs WHERE id = ?")
    .get(jobId) as RawActivationJobRow | undefined;

  return mapActivationJobRow(row);
}

export function claimNextQueuedActivationJob(): ActivationJobRecord | null {
  initializeDatabase();
  const db = getDb();
  const nextJob = db
    .prepare(
      `SELECT id
      FROM activation_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC, id ASC
      LIMIT 1`
    )
    .get() as { id: number } | undefined;

  if (!nextJob) {
    return null;
  }

  const updated = db
    .prepare(
      `UPDATE activation_jobs
      SET
        status = 'running',
        started_at = COALESCE(started_at, datetime('now')),
        attempt_count = COALESCE(attempt_count, 0) + 1,
        error_message = NULL,
        updated_at = datetime('now')
      WHERE id = ?
        AND status = 'queued'`
    )
    .run(nextJob.id);

  if (updated.changes === 0) {
    return null;
  }

  return getActivationJobById(nextJob.id);
}

export function completeActivationJob(
  jobId: number,
  result?: Record<string, unknown> | null
): ActivationJobRecord {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE activation_jobs
    SET
      status = 'completed',
      result_json = ?,
      completed_at = datetime('now'),
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    result && Object.keys(result).length > 0 ? JSON.stringify(result) : null,
    jobId
  );

  return getActivationJobById(jobId) as ActivationJobRecord;
}

export function failActivationJob(
  jobId: number,
  errorMessage: string,
  result?: Record<string, unknown> | null
): ActivationJobRecord {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE activation_jobs
    SET
      status = 'failed',
      result_json = ?,
      completed_at = datetime('now'),
      error_message = ?,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    result && Object.keys(result).length > 0 ? JSON.stringify(result) : null,
    text(errorMessage) || "Activation failed.",
    jobId
  );

  return getActivationJobById(jobId) as ActivationJobRecord;
}

export function resetActivationJob(jobId: number): ActivationJobRecord {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE activation_jobs
    SET
      status = 'queued',
      error_message = NULL,
      started_at = NULL,
      completed_at = NULL,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(jobId);

  return getActivationJobById(jobId) as ActivationJobRecord;
}

export function buildPublicPurchasePath(publicToken: string): string {
  return `/purchase/${encodeURIComponent(publicToken)}`;
}
