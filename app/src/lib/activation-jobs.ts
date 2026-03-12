import { logActivity } from "./activity-log";
import { getConfig } from "./config";
import { getDb } from "./db";
import {
  normalizeProviderActivationState,
  serializeProviderActivationState,
  type ProviderActivationState,
} from "./provider-activation";
import {
  claimNextQueuedActivationJob,
  completeActivationJob,
  failActivationJob,
  getSaleById,
  markSaleActivationFailed,
  markSaleFulfilled,
  normalizeSaleMode,
  queueActivationJob,
  type ActivationJobRecord,
  type SaleRecord,
} from "./sales";
import { normalizeSiteCapabilityProfile } from "./site-capabilities";
import { deployCustomerProjectForBusiness } from "./vercel-sites";

const ACTIVATION_POLL_MS = 15_000;

type ActivationWorkerState = {
  followUpTimer: ReturnType<typeof setTimeout> | null;
  intervalId: ReturnType<typeof setInterval> | null;
  running: boolean;
};

type BusinessActivationContext = {
  businessId: number;
  businessName: string;
  customerDomain: string | null;
  customerProjectId: string | null;
  customerProjectMetadataJson: string | null;
  customerProjectName: string | null;
  customerProjectProvider: string | null;
  email: string | null;
  providerActivationJson: string | null;
  capabilityProfileJson: string | null;
  category: string | null;
  advancedFeaturesJson: string | null;
};

declare global {
  var __curbActivationWorkerState: ActivationWorkerState | undefined;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function getWorkerState(): ActivationWorkerState {
  if (!globalThis.__curbActivationWorkerState) {
    globalThis.__curbActivationWorkerState = {
      followUpTimer: null,
      intervalId: null,
      running: false,
    };
  }

  return globalThis.__curbActivationWorkerState;
}

function scheduleFollowUpPass(delayMs: number): void {
  const state = getWorkerState();
  if (state.followUpTimer) {
    return;
  }

  state.followUpTimer = setTimeout(() => {
    state.followUpTimer = null;
    void runPendingActivationJobs();
  }, delayMs);
  state.followUpTimer.unref?.();
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
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

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function getBusinessActivationContext(
  businessId: number
): BusinessActivationContext {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        b.id as business_id,
        b.name as business_name,
        b.customer_domain,
        b.vercel_customer_project_id,
        b.customer_project_metadata_json,
        b.vercel_customer_project_name,
        b.customer_project_provider,
        b.email,
        b.provider_activation_json,
        b.category,
        latest_audit.capability_profile_json,
        latest_audit.advanced_features_json
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = b.id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      WHERE b.id = ?`
    )
    .get(businessId) as
    | {
        business_id: number;
        business_name: string;
        customer_domain: string | null;
        vercel_customer_project_id: string | null;
        customer_project_metadata_json: string | null;
        vercel_customer_project_name: string | null;
        customer_project_provider: string | null;
        email: string | null;
        provider_activation_json: string | null;
        category: string | null;
        capability_profile_json: string | null;
        advanced_features_json: string | null;
      }
    | undefined;

  if (!row) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  return {
    businessId: row.business_id,
    businessName: text(row.business_name),
    customerDomain: text(row.customer_domain) || null,
    customerProjectId: text(row.vercel_customer_project_id) || null,
    customerProjectMetadataJson: row.customer_project_metadata_json,
    customerProjectName: text(row.vercel_customer_project_name) || null,
    customerProjectProvider: text(row.customer_project_provider) || null,
    email: text(row.email) || null,
    providerActivationJson: row.provider_activation_json,
    capabilityProfileJson: row.capability_profile_json,
    category: text(row.category) || null,
    advancedFeaturesJson: row.advanced_features_json,
  };
}

function buildCloudflareDashboardUrl(
  metadataSource: string | Record<string, unknown> | null,
  projectId: string | null
): string {
  const metadata =
    typeof metadataSource === "string"
      ? parseJsonObject(metadataSource)
      : metadataSource;
  const accountId = text(metadata?.cloudflareAccountId);
  const normalizedProjectId = text(projectId);

  if (!accountId || !normalizedProjectId) {
    return "";
  }

  return `https://dash.cloudflare.com/${accountId}/pages/view/${normalizedProjectId}`;
}

function updateBusinessProviderActivation(
  businessId: number,
  value: ProviderActivationState
): void {
  const db = getDb();
  db.prepare(
    `UPDATE businesses
    SET
      provider_activation_json = ?,
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(serializeProviderActivationState(value), businessId);
}

function markBusinessSold(businessId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE businesses
    SET
      status = 'sold',
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(businessId);
}

async function sendActivationEmail(
  sale: SaleRecord,
  input: {
    businessName: string;
    mode: "handoff" | "managed";
    purchaseUrl: string;
    customerSiteUrl?: string | null;
  }
): Promise<void> {
  const config = getConfig();
  const apiKey = text(config.resendApiKey);
  const fromEmail = text(config.resendFromEmail);
  const toEmail = text(sale.customerEmail);

  if (!apiKey || !fromEmail || !toEmail) {
    return;
  }

  const subject =
    input.mode === "handoff"
      ? `${input.businessName} website ZIP is ready`
      : `${input.businessName} site launch is in progress`;
  const lines =
    input.mode === "handoff"
      ? [
          `Your purchase for ${input.businessName} is complete.`,
          "",
          `Download the website package here: ${input.purchaseUrl}`,
          "",
          "This link opens the purchase page where the ZIP download is available.",
        ]
      : [
          `Your purchase for ${input.businessName} is complete.`,
          "",
          `Launch status: ${input.purchaseUrl}`,
          ...(input.customerSiteUrl
            ? ["", `Current live site: ${input.customerSiteUrl}`]
            : []),
          "",
          "We will use the managed provider workflow shown on that page for any remaining setup.",
        ];

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      subject,
      text: lines.join("\n"),
      to: [toEmail],
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    throw new Error(
      text(payload?.message) || text(payload?.error) || "Resend rejected the activation email."
    );
  }
}

function buildPurchaseUrl(publicToken: string): string {
  const baseUrl = text(getConfig().appBaseUrl).replace(/\/$/, "") || "http://localhost:3000";
  return `${baseUrl}/purchase/${encodeURIComponent(publicToken)}`;
}

async function activateHandoffSale(
  sale: SaleRecord,
  context: BusinessActivationContext
): Promise<Record<string, unknown>> {
  const purchaseUrl = buildPurchaseUrl(sale.publicToken);

  try {
    await sendActivationEmail(sale, {
      businessName: context.businessName,
      mode: "handoff",
      purchaseUrl,
    });
  } catch (error) {
    logActivity({
      kind: "sales",
      stage: "email-warning",
      businessId: context.businessId,
      businessName: context.businessName,
      message: `Handoff completed for ${context.businessName}, but the confirmation email failed: ${
        error instanceof Error ? error.message : "Unknown email error."
      }`,
    });
  }

  markBusinessSold(context.businessId);
  markSaleFulfilled(sale.id, {
    delivery: "zip",
    purchaseUrl,
  });

  logActivity({
    kind: "sales",
    stage: "fulfilled",
    businessId: context.businessId,
    businessName: context.businessName,
    message: `ZIP handoff is ready for ${context.businessName}`,
  });

  return {
    delivery: "zip",
    purchaseUrl,
  };
}

function syncManagedProviderActivation(
  context: BusinessActivationContext,
  deployment: Awaited<ReturnType<typeof deployCustomerProjectForBusiness>>
): ProviderActivationState {
  const config = getConfig();
  const capabilityProfile = normalizeSiteCapabilityProfile(
    context.capabilityProfileJson,
    {
      advancedFeatures: parseJsonArray(context.advancedFeaturesJson),
      category: context.category,
    }
  );
  const providerActivation = normalizeProviderActivationState(
    context.providerActivationJson,
    capabilityProfile,
    config
  );
  const now = new Date().toISOString();
  const customerSiteUrl =
    deployment.aliasUrl || deployment.deploymentUrl || context.customerDomain || "";

  providerActivation.hosting = {
    ...providerActivation.hosting,
    accountLabel:
      deployment.projectName || deployment.projectId || context.customerProjectName || "",
    dashboardUrl:
      buildCloudflareDashboardUrl(
        context.customerProjectMetadataJson,
        deployment.projectId
      ) || customerSiteUrl,
    lastUpdatedAt: now,
    notes:
      deployment.customerDomain && !deployment.customerDomainVerified
        ? `Managed deployment is live. Finish DNS verification for ${deployment.customerDomain} before the custom domain can serve traffic.`
        : `Managed deployment is live at ${customerSiteUrl}.`,
    owner: "curb",
    provider:
      providerActivation.hosting.provider || "Cloudflare Pages",
    status: deployment.customerDomain && !deployment.customerDomainVerified
      ? "configured"
      : "live",
  };

  providerActivation.forms = {
    ...providerActivation.forms,
    endpointUrl: text(config.sharedFormEndpointUrl),
    lastUpdatedAt: now,
    notes: text(config.sharedFormEndpointUrl)
      ? "Shared Cloudflare form endpoint is attached for this managed site."
      : "Configure the shared form endpoint in Settings to activate managed contact forms.",
    owner: "curb",
    provider: providerActivation.forms.provider || "Shared Cloudflare Form Service",
    publicSiteKey: text(config.turnstileSiteKey),
    status:
      text(config.sharedFormEndpointUrl) &&
      text(config.sharedFormSigningSecret) &&
      text(config.resendApiKey) &&
      text(config.resendFromEmail)
        ? "live"
        : "not-started",
  };

  if (providerActivation.cms.status !== "not-needed") {
    providerActivation.cms = {
      ...providerActivation.cms,
      lastUpdatedAt: now,
      notes:
        providerActivation.cms.notes ||
        "Managed CMS pack is tracked here. Provision the external CMS workspace before granting client editing access.",
      owner: "curb",
      status:
        providerActivation.cms.status === "live"
          ? "live"
          : "in-progress",
    };
  }

  if (providerActivation.commerce.status !== "not-needed") {
    providerActivation.commerce = {
      ...providerActivation.commerce,
      lastUpdatedAt: now,
      notes:
        providerActivation.commerce.notes ||
        "Commerce is a managed add-on. Finish product and checkout setup in the external provider before launch.",
      owner: "curb",
      status:
        providerActivation.commerce.status === "live"
          ? "live"
          : "in-progress",
    };
  }

  if (providerActivation.booking.status !== "not-needed") {
    providerActivation.booking = {
      ...providerActivation.booking,
      lastUpdatedAt: now,
      notes:
        providerActivation.booking.notes ||
        "Booking is sold as a managed add-on. Complete the provider-side availability setup before sending clients to book.",
      owner: "curb",
      status:
        providerActivation.booking.status === "live"
          ? "live"
          : "in-progress",
    };
  }

  if (providerActivation.memberships.status !== "not-needed") {
    providerActivation.memberships = {
      ...providerActivation.memberships,
      lastUpdatedAt: now,
      notes:
        providerActivation.memberships.notes ||
        "Memberships are managed separately from the brochure launch. Keep this tracked until the access flow is fully wired.",
      owner: "curb",
      status:
        providerActivation.memberships.status === "live"
          ? "live"
          : "in-progress",
    };
  }

  updateBusinessProviderActivation(context.businessId, providerActivation);
  return providerActivation;
}

async function activateManagedSale(
  sale: SaleRecord,
  context: BusinessActivationContext
): Promise<Record<string, unknown>> {
  const deployment = await deployCustomerProjectForBusiness(context.businessId, {
    customerDomain: context.customerDomain,
  });
  const providerActivation = syncManagedProviderActivation(context, deployment);
  const customerSiteUrl = deployment.aliasUrl || deployment.deploymentUrl || null;
  const purchaseUrl = buildPurchaseUrl(sale.publicToken);

  try {
    await sendActivationEmail(sale, {
      businessName: context.businessName,
      customerSiteUrl,
      mode: "managed",
      purchaseUrl,
    });
  } catch (error) {
    logActivity({
      kind: "sales",
      stage: "email-warning",
      businessId: context.businessId,
      businessName: context.businessName,
      message: `Managed launch completed for ${context.businessName}, but the confirmation email failed: ${
        error instanceof Error ? error.message : "Unknown email error."
      }`,
    });
  }

  markBusinessSold(context.businessId);
  markSaleFulfilled(sale.id, {
    customerDeployment: {
      customerDomain: deployment.customerDomain,
      customerDomainVerified: deployment.customerDomainVerified,
      deploymentUrl: deployment.deploymentUrl,
      liveUrl: customerSiteUrl,
      projectId: deployment.projectId,
      projectName: deployment.projectName,
      provider: deployment.provider,
    },
    providerActivation,
    purchaseUrl,
  });

  logActivity({
    kind: "sales",
    stage: "fulfilled",
    businessId: context.businessId,
    businessName: context.businessName,
    message: customerSiteUrl
      ? `Managed launch finished for ${context.businessName} at ${customerSiteUrl}`
      : `Managed launch finished for ${context.businessName}`,
  });

  return {
    customerDomain: deployment.customerDomain,
    customerDomainVerified: deployment.customerDomainVerified,
    deploymentUrl: deployment.deploymentUrl,
    liveUrl: customerSiteUrl,
    projectId: deployment.projectId,
    projectName: deployment.projectName,
    provider: deployment.provider,
  };
}

async function processActivationJob(
  job: ActivationJobRecord
): Promise<Record<string, unknown>> {
  if (!job.saleId) {
    throw new Error("Activation job is missing a sale reference.");
  }

  const sale = getSaleById(job.saleId);
  if (!sale) {
    throw new Error(`Sale ${job.saleId} not found.`);
  }

  const context = getBusinessActivationContext(job.businessId);
  const mode = normalizeSaleMode(sale.mode);

  logActivity({
    kind: "sales",
    stage: "activation-started",
    businessId: context.businessId,
    businessName: context.businessName,
    message:
      mode === "handoff"
        ? `Preparing ZIP handoff for ${context.businessName}`
        : `Launching managed site for ${context.businessName}`,
  });

  if (mode === "handoff") {
    return activateHandoffSale(sale, context);
  }

  return activateManagedSale(sale, context);
}

export async function runPendingActivationJobs(): Promise<void> {
  const state = getWorkerState();
  if (state.running) {
    return;
  }

  state.running = true;
  try {
    for (;;) {
      const nextJob = queueNextActivationJob();
      if (!nextJob) {
        break;
      }

      try {
        const result = await processActivationJob(nextJob);
        completeActivationJob(nextJob.id, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Activation failed.";
        if (nextJob.saleId) {
          markSaleActivationFailed(nextJob.saleId, message);
        }
        failActivationJob(nextJob.id, message);
        logActivity({
          kind: "sales",
          stage: "activation-failed",
          businessId: nextJob.businessId,
          message,
        });
      }
    }
  } finally {
    state.running = false;
  }
}

function queueNextActivationJob(): ActivationJobRecord | null {
  return claimNextQueuedActivationJob();
}

export function ensureActivationWorkerRunning(): void {
  const state = getWorkerState();
  if (state.intervalId) {
    return;
  }

  state.intervalId = setInterval(() => {
    void runPendingActivationJobs();
  }, ACTIVATION_POLL_MS);
  state.intervalId.unref?.();
  scheduleFollowUpPass(0);
}

export function queueSaleActivation(
  saleId: number,
  businessId: number
): ActivationJobRecord {
  const job = queueActivationJob(businessId, saleId);
  ensureActivationWorkerRunning();
  scheduleFollowUpPass(0);
  return job;
}
