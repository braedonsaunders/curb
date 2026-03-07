import fs from "fs";
import { logActivity } from "../activity-log";
import { auditWebsite, isAiAuthenticationError } from "../claude";
import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import {
  captureWebsiteScreenshot,
  resolveReachableUrl,
  type WebsitePageSignals,
  type WebsiteScreenshot,
} from "../website-screenshot";

const VISUAL_AUDIT_VERSION = 2;

type OwnerSentiment = "proud" | "mixed" | "embarrassed" | null;
type WebsiteComplexity =
  | "none"
  | "simple"
  | "moderate"
  | "advanced"
  | "unknown";
type ReplacementDifficulty = "easy" | "medium" | "hard" | "unknown";

export interface AuditResult {
  businessId: number;
  businessName: string;
  hasWebsite: boolean;
  urlReachable: boolean | null;
  grade: string | null;
  ownerSentiment: OwnerSentiment;
  summary: string;
  screenshotUrl: string | null;
  strengths: string[];
  issues: string[];
  websiteComplexity: WebsiteComplexity;
  replacementDifficulty: ReplacementDifficulty;
  advancedFeatures: string[];
}

function toPublicScreenshotUrl(relativePath: string | null): string | null {
  if (!relativePath) {
    return null;
  }

  return `/${relativePath.replace(/^\/+/, "")}`;
}

function normalizeGrade(grade: string): string {
  const normalized = grade.trim().toUpperCase();
  return ["A", "B", "C", "D", "F"].includes(normalized) ? normalized : "C";
}

function normalizeWebsiteComplexity(
  complexity: string
): Exclude<WebsiteComplexity, "none" | "unknown"> {
  const normalized = complexity.trim().toLowerCase();
  return normalized === "simple" ||
    normalized === "moderate" ||
    normalized === "advanced"
    ? normalized
    : "moderate";
}

function normalizeReplacementDifficulty(
  difficulty: string
): Exclude<ReplacementDifficulty, "unknown"> {
  const normalized = difficulty.trim().toLowerCase();
  return normalized === "easy" ||
    normalized === "medium" ||
    normalized === "hard"
    ? normalized
    : "medium";
}

function nextBusinessStatus(grade: string | null): string {
  if (grade === "A") return "skipped";
  if (grade === "D" || grade === "F") return "flagged";
  if (grade) return "audited";
  return "discovered";
}

function shouldUseHeuristicFallback(error: unknown): boolean {
  return isAiAuthenticationError(error);
}

function inferComplexityFromSignals(
  pageSignals: WebsitePageSignals
): {
  websiteComplexity: Exclude<WebsiteComplexity, "none" | "unknown">;
  replacementDifficulty: Exclude<ReplacementDifficulty, "unknown">;
  advancedFeatures: string[];
} {
  const advancedFeatures = Array.from(new Set(pageSignals.detectedFeatures));
  const hasAdvancedFeature = advancedFeatures.some((feature) =>
    ["online store", "customer portal", "advanced lead capture"].includes(
      feature
    )
  );
  const hasModerateFeature = advancedFeatures.some((feature) =>
    ["appointment booking", "video or rich media", "large multi-page navigation"].includes(
      feature
    )
  );

  if (
    hasAdvancedFeature ||
    pageSignals.internalLinkCount >= 20 ||
    pageSignals.formCount > 1
  ) {
    return {
      websiteComplexity: "advanced",
      replacementDifficulty: "hard",
      advancedFeatures,
    };
  }

  if (
    hasModerateFeature ||
    pageSignals.navLinkCount >= 6 ||
    pageSignals.internalLinkCount >= 10
  ) {
    return {
      websiteComplexity: "moderate",
      replacementDifficulty: "medium",
      advancedFeatures,
    };
  }

  return {
    websiteComplexity: "simple",
    replacementDifficulty: "easy",
    advancedFeatures,
  };
}

function buildFallbackReview(
  businessName: string,
  pageSignals: WebsitePageSignals,
  providerError: unknown
): {
  grade: string;
  ownerSentiment: NonNullable<OwnerSentiment>;
  summary: string;
  strengths: string[];
  issues: string[];
  websiteComplexity: Exclude<WebsiteComplexity, "none" | "unknown">;
  replacementDifficulty: Exclude<ReplacementDifficulty, "unknown">;
  advancedFeatures: string[];
} {
  const inferred = inferComplexityFromSignals(pageSignals);
  const reason =
    providerError instanceof Error ? providerError.message : String(providerError);

  const strengths = ["Live website was reached successfully."];
  if (pageSignals.detectedFeatures.length > 0) {
    strengths.push(
      `Detected current functionality: ${pageSignals.detectedFeatures.join(", ")}.`
    );
  }

  const issues = [
    "Visual AI review could not run, so this assessment used live page heuristics only.",
    "Fix the configured AI provider credentials to restore screenshot-based grading.",
  ];

  return {
    grade: "C",
    ownerSentiment: "mixed",
    summary:
      `Captured the current website, but AI review was unavailable. ` +
      `Replacement complexity was inferred from the live page structure and detected features. ` +
      `Provider error: ${reason}`,
    strengths,
    issues,
    websiteComplexity: inferred.websiteComplexity,
    replacementDifficulty: inferred.replacementDifficulty,
    advancedFeatures: inferred.advancedFeatures,
  };
}

function deleteScreenshotIfPresent(screenshot: WebsiteScreenshot | null): void {
  if (!screenshot) {
    return;
  }

  try {
    fs.rmSync(screenshot.absolutePath, { force: true });
  } catch {
    // Best-effort cleanup when a capture succeeds but the review fails.
  }
}

export async function auditBusiness(
  businessId: number
): Promise<AuditResult> {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(businessId) as Record<string, unknown> | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const businessName = business.name as string;
  const slug = business.slug as string;
  const websiteUrl = business.website_url as string | null;
  const detailsEnrichedAt = business.details_enriched_at as string | null;

  const insertAudit = db.prepare(`
    INSERT INTO audits (
      business_id,
      has_website,
      url_reachable,
      overall_grade,
      owner_sentiment,
      notes,
      screenshot_path,
      strengths_json,
      issues_json,
      website_complexity,
      replacement_difficulty,
      advanced_features_json,
      review_json,
      audit_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (!websiteUrl) {
    const summary =
      "No website found. This business is a strong candidate for a new site.";

    logActivity({
      kind: "enrichment",
      stage: "audit",
      businessId,
      businessName,
      message: `No website found for ${businessName}`,
    });

    insertAudit.run(
      businessId,
      0,
      null,
      "F",
      null,
      summary,
      null,
      JSON.stringify([]),
      JSON.stringify([
        "No live website was found for this business during the audit.",
      ]),
      "none",
      "easy",
      JSON.stringify([]),
      JSON.stringify({ reason: "missing_website" }),
      VISUAL_AUDIT_VERSION
    );

    db.prepare(
      `UPDATE businesses
      SET
        status = 'flagged',
        enrichment_status = CASE
          WHEN details_enriched_at IS NOT NULL THEN 'completed'
          ELSE 'pending'
        END,
        enrichment_completed_at = CASE
          WHEN details_enriched_at IS NOT NULL THEN datetime('now')
          ELSE enrichment_completed_at
        END,
        enrichment_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(businessId);

    return {
      businessId,
      businessName,
      hasWebsite: false,
      urlReachable: null,
      grade: "F",
      ownerSentiment: null,
      summary,
      screenshotUrl: null,
      strengths: [],
      issues: ["No website was found for this business."],
      websiteComplexity: "none",
      replacementDifficulty: "easy",
      advancedFeatures: [],
    };
  }

  const reachability = await resolveReachableUrl(websiteUrl);
  if (!reachability.reachable || !reachability.finalUrl) {
    const summary =
      "Website exists but could not be reached. It may be down, expired, or misconfigured.";

    logActivity({
      kind: "enrichment",
      stage: "audit",
      businessId,
      businessName,
      message: `Website could not be reached for ${businessName}`,
    });

    insertAudit.run(
      businessId,
      1,
      0,
      "F",
      null,
      summary,
      null,
      JSON.stringify([]),
      JSON.stringify([
        "The website could not be loaded during the audit.",
      ]),
      "unknown",
      "unknown",
      JSON.stringify([]),
      JSON.stringify({ reason: "unreachable_website", requestedUrl: websiteUrl }),
      VISUAL_AUDIT_VERSION
    );

    db.prepare(
      `UPDATE businesses
      SET
        status = 'flagged',
        enrichment_status = CASE
          WHEN details_enriched_at IS NOT NULL THEN 'completed'
          ELSE 'pending'
        END,
        enrichment_completed_at = CASE
          WHEN details_enriched_at IS NOT NULL THEN datetime('now')
          ELSE enrichment_completed_at
        END,
        enrichment_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(businessId);

    return {
      businessId,
      businessName,
      hasWebsite: true,
      urlReachable: false,
      grade: "F",
      ownerSentiment: null,
      summary,
      screenshotUrl: null,
      strengths: [],
      issues: ["The website could not be loaded during the audit."],
      websiteComplexity: "unknown",
      replacementDifficulty: "unknown",
      advancedFeatures: [],
    };
  }

  let screenshot: WebsiteScreenshot | null = null;

  try {
    logActivity({
      kind: "enrichment",
      stage: "screenshot",
      businessId,
      businessName,
      message: `Capturing website screenshot for ${businessName}`,
    });
    screenshot = await captureWebsiteScreenshot(reachability.finalUrl, slug);
    let review;
    try {
      logActivity({
        kind: "enrichment",
        stage: "review",
        businessId,
        businessName,
        message: `Running website review for ${businessName}`,
      });
      review = await auditWebsite({
        businessName,
        category: (business.category as string) ?? null,
        city: (business.city as string) ?? null,
        requestedUrl: websiteUrl,
        finalUrl: screenshot.finalUrl,
        pageTitle: screenshot.pageTitle,
        screenshotBase64: screenshot.base64,
        screenshotMediaType: screenshot.mediaType,
        pageSignals: screenshot.pageSignals,
      });
    } catch (error) {
      if (!shouldUseHeuristicFallback(error)) {
        throw error;
      }

      logActivity({
        kind: "enrichment",
        stage: "review",
        businessId,
        businessName,
        message: `AI review unavailable for ${businessName}; using heuristic fallback`,
      });
      review = buildFallbackReview(businessName, screenshot.pageSignals, error);
    }

    const grade = normalizeGrade(review.grade);
    const summary = review.summary;
    const strengths = review.strengths;
    const issues = review.issues;
    const websiteComplexity = normalizeWebsiteComplexity(
      review.websiteComplexity
    );
    const replacementDifficulty = normalizeReplacementDifficulty(
      review.replacementDifficulty
    );
    const advancedFeatures = review.advancedFeatures;
    const screenshotUrl = toPublicScreenshotUrl(screenshot.relativePath);
    const status = nextBusinessStatus(grade);

    insertAudit.run(
      businessId,
      1,
      1,
      grade,
      review.ownerSentiment,
      summary,
      screenshot.relativePath,
      JSON.stringify(strengths),
      JSON.stringify(issues),
      websiteComplexity,
      replacementDifficulty,
      JSON.stringify(advancedFeatures),
      JSON.stringify({
        requestedUrl: websiteUrl,
        finalUrl: screenshot.finalUrl,
        pageTitle: screenshot.pageTitle,
        pageSignals: screenshot.pageSignals,
        grade,
        ownerSentiment: review.ownerSentiment,
        summary,
        strengths,
        issues,
        websiteComplexity,
        replacementDifficulty,
        advancedFeatures,
      }),
      VISUAL_AUDIT_VERSION
    );

    db.prepare(
      `UPDATE businesses
      SET
        status = ?,
        enrichment_status = CASE
          WHEN ? IS NOT NULL THEN 'completed'
          ELSE 'pending'
        END,
        enrichment_completed_at = CASE
          WHEN ? IS NOT NULL THEN datetime('now')
          ELSE enrichment_completed_at
        END,
        enrichment_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(status, detailsEnrichedAt, detailsEnrichedAt, businessId);

    return {
      businessId,
      businessName,
      hasWebsite: true,
      urlReachable: true,
      grade,
      ownerSentiment: review.ownerSentiment,
      summary,
      screenshotUrl,
      strengths,
      issues,
      websiteComplexity,
      replacementDifficulty,
      advancedFeatures,
    };
  } catch (err) {
    logActivity({
      kind: "enrichment",
      stage: "failed",
      businessId,
      businessName,
      message: `Audit failed for ${businessName}`,
    });
    deleteScreenshotIfPresent(screenshot);
    throw err;
  }
}

export async function batchAudit(): Promise<AuditResult[]> {
  initializeDatabase();
  const db = getDb();

  const businesses = db
    .prepare("SELECT id FROM businesses WHERE status = 'discovered'")
    .all() as Array<{ id: number }>;

  const results: AuditResult[] = [];

  for (const biz of businesses) {
    try {
      const result = await auditBusiness(biz.id);
      results.push(result);
    } catch (err) {
      console.error(
        `Failed to audit business ${biz.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return results;
}
