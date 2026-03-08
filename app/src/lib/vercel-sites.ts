import crypto from "crypto";
import fs from "fs";
import path from "path";
import slugify from "slugify";
import { Vercel } from "@vercel/sdk";
import { logActivity } from "./activity-log";
import { getConfig, type Config } from "./config";
import { getDb } from "./db";
import { initializeDatabase } from "./schema";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
const SITES_DIR = path.join(WORKSPACE_ROOT, "sites");
const INTERNAL_SITE_FILES = new Set(["__source_snapshot.json"]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".txt",
  ".xml",
]);
const STATIC_PROJECT_SETTINGS = {
  buildCommand: null,
  devCommand: null,
  framework: null,
  installCommand: null,
  outputDirectory: null,
  rootDirectory: null,
} as const;
const DEPLOYMENT_POLL_INTERVAL_MS = 1500;
const DEPLOYMENT_POLL_TIMEOUT_MS = 120000;

type DeploymentKind = "preview" | "customer";

type RawBusinessRow = {
  id: number;
  name: string;
  slug: string;
  customer_domain: string | null;
  customer_domain_verified: number | null;
  customer_domain_verification_json: string | null;
  vercel_customer_project_id: string | null;
  vercel_customer_project_name: string | null;
};

type RawGeneratedSiteRow = {
  id: number;
  version: number;
  slug: string;
  site_path: string;
};

type SiteContext = {
  business: RawBusinessRow;
  generatedSite: RawGeneratedSiteRow;
  siteDir: string;
};

type VerificationRecord = {
  type: string;
  domain: string;
  value: string;
  reason: string;
};

export interface SiteDeploymentRecord {
  id: number;
  businessId: number;
  generatedSiteId: number;
  deploymentKind: DeploymentKind;
  vercelProjectId: string;
  vercelProjectName: string | null;
  vercelDeploymentId: string;
  vercelDeploymentUrl: string;
  aliasUrl: string | null;
  aliasHost: string | null;
  target: string;
  readyState: string | null;
  active: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPreviewLink {
  url: string;
  source: "vercel-alias" | "vercel-deployment" | "local";
}

export interface DeployPreviewResult {
  aliasUrl: string | null;
  deploymentId: string;
  deploymentUrl: string;
  generatedSiteId: number;
  readyState: string | null;
  version: number;
}

export interface DeployCustomerResult extends DeployPreviewResult {
  customerDomain: string | null;
  customerDomainVerified: boolean;
  customerDomainVerification: VerificationRecord[];
  projectCreated: boolean;
  projectId: string;
  projectName: string;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getTeamScope(config: Config): { teamId?: string } {
  const teamId = config.vercelTeamId.trim();
  return teamId ? { teamId } : {};
}

function createVercelClient(config: Config): Vercel {
  const token = config.vercelToken.trim();
  if (!token) {
    throw new Error("Add a Vercel token in Settings before deploying sites.");
  }

  return new Vercel({
    bearerToken: token,
    timeoutMs: 120000,
  });
}

function normalizeHostname(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const withoutWildcard = raw.replace(/^\*\./, "").replace(/^\./, "");

  try {
    const parsed = withoutWildcard.includes("://")
      ? new URL(withoutWildcard)
      : new URL(`https://${withoutWildcard}`);
    return parsed.hostname.replace(/\.$/, "");
  } catch {
    return withoutWildcard.replace(/\/+$/, "").replace(/\.$/, "");
  }
}

function buildDnsLabel(value: string, fallback: string): string {
  const normalized =
    slugify(value, { lower: true, strict: true, trim: true }) ||
    slugify(fallback, { lower: true, strict: true, trim: true }) ||
    "site";

  if (normalized.length <= 63) {
    return normalized;
  }

  const hash = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 8);
  const prefix = normalized.slice(0, Math.max(1, 63 - hash.length - 1));
  return `${prefix}-${hash}`;
}

function buildPreviewAliasHost(slug: string, config: Config): string | null {
  const rootDomain = normalizeHostname(config.vercelPreviewRootDomain);
  if (!rootDomain) {
    return null;
  }

  return `${buildDnsLabel(slug, "preview")}.${rootDomain}`;
}

function buildCustomerProjectName(slug: string, businessId: number): string {
  const base = buildDnsLabel(slug, `customer-${businessId}`);
  const prefix = `curb-${base}`;
  if (prefix.length <= 100) {
    return prefix;
  }

  const hash = crypto.createHash("sha1").update(prefix).digest("hex").slice(0, 8);
  const trimmed = prefix.slice(0, Math.max(1, 100 - hash.length - 1));
  return `${trimmed}-${hash}`;
}

function buildDeploymentName(kind: DeploymentKind, slug: string): string {
  return buildDnsLabel(`curb-${kind}-${slug}`, `${kind}-site`);
}

function serializeVerification(
  verification: VerificationRecord[]
): string | null {
  return verification.length > 0 ? JSON.stringify(verification) : null;
}

function parseVerification(
  value: string | null | undefined
): VerificationRecord[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const source = entry as Record<string, unknown>;
        const type = String(source.type ?? "").trim();
        const domain = String(source.domain ?? "").trim();
        const value = String(source.value ?? "").trim();
        const reason = String(source.reason ?? "").trim();

        if (!type || !domain || !value) {
          return null;
        }

        return {
          type,
          domain,
          value,
          reason,
        } satisfies VerificationRecord;
      })
      .filter((entry): entry is VerificationRecord => entry !== null);
  } catch {
    return [];
  }
}

function toAbsoluteSiteDir(sitePath: string, slug: string): string {
  const trimmed = String(sitePath ?? "").trim();
  if (!trimmed) {
    return path.join(SITES_DIR, slug);
  }

  return path.resolve(WORKSPACE_ROOT, trimmed);
}

function walkSiteFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSiteFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function collectDeploymentFiles(siteDir: string): Array<{
  file: string;
  data: string;
  encoding: "base64" | "utf-8";
}> {
  if (!fs.existsSync(siteDir)) {
    throw new Error(`Generated site directory not found at ${siteDir}`);
  }

  return walkSiteFiles(siteDir)
    .filter((fullPath) => !INTERNAL_SITE_FILES.has(path.basename(fullPath)))
    .sort((left, right) => left.localeCompare(right))
    .map((fullPath) => {
      const relativePath = path
        .relative(siteDir, fullPath)
        .split(path.sep)
        .join("/");
      const extension = path.extname(fullPath).toLowerCase();
      const encoding = TEXT_FILE_EXTENSIONS.has(extension) ? "utf-8" : "base64";

      return {
        file: relativePath,
        data:
          encoding === "utf-8"
            ? fs.readFileSync(fullPath, "utf8")
            : fs.readFileSync(fullPath).toString("base64"),
        encoding,
      };
    });
}

function formatUrl(hostOrUrl: string | null | undefined): string | null {
  const raw = String(hostOrUrl ?? "").trim();
  if (!raw) {
    return null;
  }

  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function latestGeneratedSiteForBusiness(
  businessId: number
): SiteContext {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare(
      `SELECT
        id,
        name,
        slug,
        customer_domain,
        customer_domain_verified,
        customer_domain_verification_json,
        vercel_customer_project_id,
        vercel_customer_project_name
      FROM businesses
      WHERE id = ?`
    )
    .get(businessId) as RawBusinessRow | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const generatedSite = db
    .prepare(
      `SELECT
        id,
        version,
        slug,
        site_path
      FROM generated_sites
      WHERE business_id = ?
      ORDER BY version DESC, id DESC
      LIMIT 1`
    )
    .get(businessId) as RawGeneratedSiteRow | undefined;

  if (!generatedSite) {
    throw new Error(`No generated site found for ${business.name}.`);
  }

  return {
    business,
    generatedSite,
    siteDir: toAbsoluteSiteDir(generatedSite.site_path, generatedSite.slug),
  };
}

function setBusinessCustomerProject(
  businessId: number,
  projectId: string,
  projectName: string
): void {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE businesses
     SET vercel_customer_project_id = ?,
         vercel_customer_project_name = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(projectId, projectName, businessId);
}

function setBusinessCustomerDomain(
  businessId: number,
  domain: string | null,
  verified: boolean,
  verification: VerificationRecord[]
): void {
  initializeDatabase();
  const db = getDb();
  db.prepare(
    `UPDATE businesses
     SET customer_domain = ?,
         customer_domain_verified = ?,
         customer_domain_verification_json = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(domain, verified ? 1 : 0, serializeVerification(verification), businessId);
}

function insertSiteDeployment(input: {
  businessId: number;
  generatedSiteId: number;
  deploymentKind: DeploymentKind;
  vercelProjectId: string;
  vercelProjectName?: string | null;
  vercelDeploymentId: string;
  vercelDeploymentUrl: string;
  aliasUrl?: string | null;
  aliasHost?: string | null;
  target: string;
  readyState?: string | null;
  errorMessage?: string | null;
}): number {
  initializeDatabase();
  const db = getDb();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE site_deployments
       SET active = 0,
           updated_at = datetime('now')
       WHERE business_id = ?
         AND deployment_kind = ?`
    ).run(input.businessId, input.deploymentKind);

    const result = db
      .prepare(
        `INSERT INTO site_deployments (
          business_id,
          generated_site_id,
          deployment_kind,
          vercel_project_id,
          vercel_project_name,
          vercel_deployment_id,
          vercel_deployment_url,
          alias_url,
          alias_host,
          target,
          ready_state,
          active,
          error_message,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
      )
      .run(
        input.businessId,
        input.generatedSiteId,
        input.deploymentKind,
        input.vercelProjectId,
        input.vercelProjectName ?? null,
        input.vercelDeploymentId,
        input.vercelDeploymentUrl,
        input.aliasUrl ?? null,
        input.aliasHost ?? null,
        input.target,
        input.readyState ?? null,
        input.errorMessage ?? null
      );

    return Number(result.lastInsertRowid);
  });

  return tx();
}

export function listSiteDeploymentsForBusiness(
  businessId: number
): SiteDeploymentRecord[] {
  initializeDatabase();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM site_deployments
       WHERE business_id = ?
       ORDER BY active DESC, created_at DESC, id DESC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: Number(row.id),
    businessId: Number(row.business_id),
    generatedSiteId: Number(row.generated_site_id),
    deploymentKind:
      row.deployment_kind === "customer" ? "customer" : "preview",
    vercelProjectId: String(row.vercel_project_id ?? ""),
    vercelProjectName:
      typeof row.vercel_project_name === "string"
        ? row.vercel_project_name
        : null,
    vercelDeploymentId: String(row.vercel_deployment_id ?? ""),
    vercelDeploymentUrl: String(row.vercel_deployment_url ?? ""),
    aliasUrl: typeof row.alias_url === "string" ? row.alias_url : null,
    aliasHost: typeof row.alias_host === "string" ? row.alias_host : null,
    target: String(row.target ?? ""),
    readyState:
      typeof row.ready_state === "string" ? row.ready_state : null,
    active: Number(row.active ?? 0) === 1,
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

function latestReadyDeployment(
  businessId: number,
  kind: DeploymentKind
): SiteDeploymentRecord | null {
  return (
    listSiteDeploymentsForBusiness(businessId).find(
      (deployment) =>
        deployment.deploymentKind === kind &&
        deployment.readyState === "READY" &&
        !deployment.errorMessage
    ) ?? null
  );
}

export function getPublicPreviewLinkForBusiness(
  businessId: number,
  slug: string
): PublicPreviewLink {
  const latestPreview = latestReadyDeployment(businessId, "preview");
  if (latestPreview?.aliasUrl) {
    return { url: latestPreview.aliasUrl, source: "vercel-alias" };
  }

  if (latestPreview?.vercelDeploymentUrl) {
    return {
      url: latestPreview.vercelDeploymentUrl,
      source: "vercel-deployment",
    };
  }

  const config = getConfig();
  return {
    url: `${config.siteBaseUrl.replace(/\/+$/, "")}/${slug}`,
    source: "local",
  };
}

export function isPreviewDeploymentConfigured(config = getConfig()): boolean {
  return (
    config.vercelToken.trim().length > 0 &&
    config.vercelPreviewProjectId.trim().length > 0
  );
}

async function waitForDeploymentReady(
  client: Vercel,
  deploymentId: string,
  config: Config
): Promise<{ readyState: string | null; url: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEPLOYMENT_POLL_TIMEOUT_MS) {
    const deployment = await client.deployments.getDeployment({
      idOrUrl: deploymentId,
      ...getTeamScope(config),
    });

    const readyState = String(deployment.readyState ?? "");
    if (readyState === "READY") {
      const url = formatUrl(deployment.url) ?? formatUrl(deploymentId);
      if (!url) {
        throw new Error("Deployment finished without a public URL.");
      }

      return { readyState, url };
    }

    if (readyState === "ERROR" || readyState === "CANCELED") {
      throw new Error(
        `Vercel deployment ${deploymentId} ended with state ${readyState}.`
      );
    }

    await sleep(DEPLOYMENT_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for the Vercel deployment to finish.");
}

async function ensureCustomerProject(
  client: Vercel,
  config: Config,
  context: SiteContext
): Promise<{ created: boolean; projectId: string; projectName: string }> {
  const existingProjectId = context.business.vercel_customer_project_id?.trim();
  const existingProjectName =
    context.business.vercel_customer_project_name?.trim() || null;

  if (existingProjectId) {
    return {
      created: false,
      projectId: existingProjectId,
      projectName:
        existingProjectName ?? buildCustomerProjectName(context.business.slug, context.business.id),
    };
  }

  const projectName = buildCustomerProjectName(
    context.business.slug,
    context.business.id
  );
  const createdProject = await client.projects.createProject({
    ...getTeamScope(config),
    requestBody: {
      name: projectName,
      publicSource: false,
    },
  });

  setBusinessCustomerProject(context.business.id, createdProject.id, createdProject.name);

  return {
    created: true,
    projectId: createdProject.id,
    projectName: createdProject.name,
  };
}

async function ensureProjectDomain(
  client: Vercel,
  config: Config,
  projectId: string,
  domain: string
): Promise<{ verified: boolean; verification: VerificationRecord[] }> {
  let domainInfo:
    | {
        verified: boolean;
        verification?: Array<{
          type: string;
          domain: string;
          value: string;
          reason: string;
        }>;
      }
    | null = null;

  try {
    domainInfo = await client.projects.addProjectDomain({
      idOrName: projectId,
      ...getTeamScope(config),
      requestBody: { name: domain },
    });
  } catch (error) {
    try {
      domainInfo = await client.projects.getProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
    } catch {
      throw error;
    }
  }

  if (!domainInfo) {
    return { verified: false, verification: [] };
  }

  if (!domainInfo.verified) {
    try {
      await client.projects.verifyProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
      domainInfo = await client.projects.getProjectDomain({
        idOrName: projectId,
        domain,
        ...getTeamScope(config),
      });
    } catch {
      // Keep the existing verification payload so the UI can surface DNS instructions.
    }
  }

  return {
    verified: Boolean(domainInfo.verified),
    verification: Array.isArray(domainInfo.verification)
      ? domainInfo.verification.map((entry) => ({
          type: String(entry.type ?? ""),
          domain: String(entry.domain ?? ""),
          value: String(entry.value ?? ""),
          reason: String(entry.reason ?? ""),
        }))
      : [],
  };
}

async function createDeployment(
  client: Vercel,
  config: Config,
  input: {
    deploymentKind: DeploymentKind;
    files: Array<{ file: string; data: string; encoding: "base64" | "utf-8" }>;
    name: string;
    projectId: string;
    meta: Record<string, string>;
    target: string;
  }
): Promise<{ deploymentId: string; readyState: string | null; url: string }> {
  const created = await client.deployments.createDeployment({
    ...getTeamScope(config),
    forceNew: "1",
    skipAutoDetectionConfirmation: "1",
    requestBody: {
      files: input.files,
      meta: input.meta,
      name: input.name,
      project: input.projectId,
      projectSettings: STATIC_PROJECT_SETTINGS,
      target: input.target,
    },
  });

  const deploymentId = String(created.id ?? "").trim();
  if (!deploymentId) {
    throw new Error("Vercel did not return a deployment id.");
  }

  const ready = await waitForDeploymentReady(client, deploymentId, config);
  return {
    deploymentId,
    readyState: ready.readyState,
    url: ready.url,
  };
}

export async function deployPreviewForBusiness(
  businessId: number,
  options?: { initiatedBy?: "automatic" | "manual" }
): Promise<DeployPreviewResult> {
  initializeDatabase();
  const config = getConfig();

  if (!isPreviewDeploymentConfigured(config)) {
    throw new Error(
      "Add a Vercel token and Preview Project ID in Settings before deploying previews."
    );
  }

  const context = latestGeneratedSiteForBusiness(businessId);
  const client = createVercelClient(config);
  const files = collectDeploymentFiles(context.siteDir);
  const aliasHost = buildPreviewAliasHost(context.generatedSite.slug, config);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message:
      options?.initiatedBy === "automatic"
        ? `Auto-deploying preview for ${context.business.name} to Vercel`
        : `Deploying preview for ${context.business.name} to Vercel`,
  });

  try {
    const deployment = await createDeployment(client, config, {
      deploymentKind: "preview",
      files,
      meta: {
        curbBusinessId: String(context.business.id),
        curbDeploymentKind: "preview",
        curbSiteVersion: String(context.generatedSite.version),
        curbSlug: context.generatedSite.slug,
      },
      name: buildDeploymentName("preview", context.generatedSite.slug),
      projectId: config.vercelPreviewProjectId.trim(),
      target: "preview",
    });

    let aliasUrl: string | null = null;
    if (aliasHost) {
      try {
        const assigned = await client.aliases.assignAlias({
          id: deployment.deploymentId,
          ...getTeamScope(config),
          requestBody: {
            alias: aliasHost,
          },
        });
        aliasUrl = formatUrl(assigned.alias);
      } catch (error) {
        logActivity({
          kind: "deployment",
          stage: "warning",
          businessId,
          businessName: context.business.name,
          message: `Preview deployed for ${context.business.name}, but alias assignment failed: ${toErrorMessage(
            error,
            "Unknown alias error."
          )}`,
        });
      }
    }

    insertSiteDeployment({
      aliasHost,
      aliasUrl,
      businessId,
      deploymentKind: "preview",
      generatedSiteId: context.generatedSite.id,
      readyState: deployment.readyState,
      target: "preview",
      vercelDeploymentId: deployment.deploymentId,
      vercelDeploymentUrl: deployment.url,
      vercelProjectId: config.vercelPreviewProjectId.trim(),
      vercelProjectName: null,
    });

    logActivity({
      kind: "deployment",
      stage: aliasUrl ? "aliased" : "completed",
      businessId,
      businessName: context.business.name,
      message: aliasUrl
        ? `Preview deployed for ${context.business.name} at ${aliasUrl}`
        : `Preview deployed for ${context.business.name} at ${deployment.url}`,
    });

    return {
      aliasUrl,
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.url,
      generatedSiteId: context.generatedSite.id,
      readyState: deployment.readyState,
      version: context.generatedSite.version,
    };
  } catch (error) {
    logActivity({
      kind: "deployment",
      stage: "failed",
      businessId,
      businessName: context.business.name,
      message: `Preview deployment failed for ${context.business.name}: ${toErrorMessage(
        error,
        "Unknown deployment error."
      )}`,
    });
    throw error;
  }
}

export async function deployCustomerProjectForBusiness(
  businessId: number,
  options?: { customerDomain?: string | null }
): Promise<DeployCustomerResult> {
  initializeDatabase();
  const config = getConfig();
  const context = latestGeneratedSiteForBusiness(businessId);
  const client = createVercelClient(config);
  const files = collectDeploymentFiles(context.siteDir);
  const requestedDomain =
    normalizeHostname(options?.customerDomain) ??
    normalizeHostname(context.business.customer_domain);

  logActivity({
    kind: "deployment",
    stage: "started",
    businessId,
    businessName: context.business.name,
    message: `Deploying a dedicated customer project for ${context.business.name}`,
  });

  try {
    const project = await ensureCustomerProject(client, config, context);
    let customerDomainVerified = false;
    let customerDomainVerification: VerificationRecord[] = [];

    if (requestedDomain) {
      const domainResult = await ensureProjectDomain(
        client,
        config,
        project.projectId,
        requestedDomain
      );
      customerDomainVerified = domainResult.verified;
      customerDomainVerification = domainResult.verification;
      setBusinessCustomerDomain(
        context.business.id,
        requestedDomain,
        customerDomainVerified,
        customerDomainVerification
      );
    }

    const deployment = await createDeployment(client, config, {
      deploymentKind: "customer",
      files,
      meta: {
        curbBusinessId: String(context.business.id),
        curbDeploymentKind: "customer",
        curbSiteVersion: String(context.generatedSite.version),
        curbSlug: context.generatedSite.slug,
      },
      name: buildDeploymentName("customer", context.generatedSite.slug),
      projectId: project.projectId,
      target: "production",
    });

    let aliasUrl: string | null = null;
    if (requestedDomain && customerDomainVerified) {
      const alias = await client.aliases.assignAlias({
        id: deployment.deploymentId,
        ...getTeamScope(config),
        requestBody: {
          alias: requestedDomain,
        },
      });
      aliasUrl = formatUrl(alias.alias);
    }

    insertSiteDeployment({
      aliasHost: requestedDomain,
      aliasUrl,
      businessId,
      deploymentKind: "customer",
      generatedSiteId: context.generatedSite.id,
      readyState: deployment.readyState,
      target: "production",
      vercelDeploymentId: deployment.deploymentId,
      vercelDeploymentUrl: deployment.url,
      vercelProjectId: project.projectId,
      vercelProjectName: project.projectName,
    });

    logActivity({
      kind: "deployment",
      stage: aliasUrl ? "aliased" : "completed",
      businessId,
      businessName: context.business.name,
      message: aliasUrl
        ? `Customer deployment for ${context.business.name} is live at ${aliasUrl}`
        : `Customer deployment for ${context.business.name} is live at ${deployment.url}`,
    });

    return {
      aliasUrl,
      customerDomain: requestedDomain,
      customerDomainVerification,
      customerDomainVerified,
      deploymentId: deployment.deploymentId,
      deploymentUrl: deployment.url,
      generatedSiteId: context.generatedSite.id,
      projectCreated: project.created,
      projectId: project.projectId,
      projectName: project.projectName,
      readyState: deployment.readyState,
      version: context.generatedSite.version,
    };
  } catch (error) {
    logActivity({
      kind: "deployment",
      stage: "failed",
      businessId,
      businessName: context.business.name,
      message: `Customer deployment failed for ${context.business.name}: ${toErrorMessage(
        error,
        "Unknown deployment error."
      )}`,
    });
    throw error;
  }
}

export function getCustomerProjectState(businessId: number): {
  customerDomain: string | null;
  customerDomainVerification: VerificationRecord[];
  customerDomainVerified: boolean;
  customerProjectId: string | null;
  customerProjectName: string | null;
} {
  initializeDatabase();
  const db = getDb();
  const business = db
    .prepare(
      `SELECT
        customer_domain,
        customer_domain_verified,
        customer_domain_verification_json,
        vercel_customer_project_id,
        vercel_customer_project_name
      FROM businesses
      WHERE id = ?`
    )
    .get(businessId) as
      | {
          customer_domain: string | null;
          customer_domain_verified: number | null;
          customer_domain_verification_json: string | null;
          vercel_customer_project_id: string | null;
          vercel_customer_project_name: string | null;
        }
      | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  return {
    customerDomain: business.customer_domain ?? null,
    customerDomainVerification: parseVerification(
      business.customer_domain_verification_json
    ),
    customerDomainVerified: Number(business.customer_domain_verified ?? 0) === 1,
    customerProjectId: business.vercel_customer_project_id ?? null,
    customerProjectName: business.vercel_customer_project_name ?? null,
  };
}
