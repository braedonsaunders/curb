import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import { getConfig } from "../config";

export interface AuditResult {
  businessId: number;
  businessName: string;
  hasWebsite: boolean;
  grade: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  isMobileFriendly: boolean | null;
  isSsl: boolean | null;
  loadTimeMs: number | null;
  notes: string;
}

interface PageSpeedCategory {
  score: number;
}

interface PageSpeedResult {
  lighthouseResult?: {
    categories?: {
      performance?: PageSpeedCategory;
      accessibility?: PageSpeedCategory;
      seo?: PageSpeedCategory;
    };
    audits?: {
      interactive?: { numericValue: number };
      "is-on-https"?: { score: number };
      viewport?: { score: number };
    };
  };
}

function computeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

async function checkUrlReachable(
  url: string
): Promise<{ reachable: boolean; isSsl: boolean }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const finalUrl = response.url || url;
    return {
      reachable: response.ok || response.status < 500,
      isSsl: finalUrl.startsWith("https://"),
    };
  } catch {
    return { reachable: false, isSsl: false };
  }
}

async function runPageSpeedAudit(
  url: string,
  apiKey: string
): Promise<{
  performance: number;
  accessibility: number;
  seo: number;
  isMobileFriendly: boolean;
  isSsl: boolean;
  loadTimeMs: number;
  raw: string;
}> {
  const endpoint =
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
  const apiUrl = `${endpoint}?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=mobile&category=performance&category=accessibility&category=seo`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `PageSpeed API returned status ${response.status}: ${await response.text()}`
    );
  }

  const data: PageSpeedResult = await response.json();
  const categories = data.lighthouseResult?.categories;
  const audits = data.lighthouseResult?.audits;

  const performance = Math.round(
    (categories?.performance?.score ?? 0) * 100
  );
  const accessibility = Math.round(
    (categories?.accessibility?.score ?? 0) * 100
  );
  const seo = Math.round((categories?.seo?.score ?? 0) * 100);
  const loadTimeMs = Math.round(
    audits?.interactive?.numericValue ?? 0
  );
  const isSsl = (audits?.["is-on-https"]?.score ?? 0) === 1;
  const isMobileFriendly = (audits?.viewport?.score ?? 0) === 1;

  return {
    performance,
    accessibility,
    seo,
    isMobileFriendly,
    isSsl,
    loadTimeMs,
    raw: JSON.stringify(data),
  };
}

export async function auditBusiness(
  businessId: number
): Promise<AuditResult> {
  initializeDatabase();
  const db = getDb();
  const config = getConfig();

  const business = db
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(businessId) as Record<string, unknown> | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const businessName = business.name as string;
  const websiteUrl = business.website_url as string | null;

  const insertAudit = db.prepare(`
    INSERT INTO audits (
      business_id, has_website, url_reachable, is_ssl, is_mobile_friendly,
      performance_score, accessibility_score, seo_score, load_time_ms,
      overall_grade, notes, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // No website case
  if (!websiteUrl) {
    const notes =
      "No website found. Business is a strong candidate for a new site.";

    insertAudit.run(
      businessId,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "F",
      notes,
      null
    );

    db.prepare(
      "UPDATE businesses SET status = 'audited', updated_at = datetime('now') WHERE id = ?"
    ).run(businessId);

    return {
      businessId,
      businessName,
      hasWebsite: false,
      grade: "F",
      performanceScore: null,
      accessibilityScore: null,
      seoScore: null,
      isMobileFriendly: null,
      isSsl: null,
      loadTimeMs: null,
      notes,
    };
  }

  // Has website - check reachability first
  const { reachable, isSsl: reachSsl } =
    await checkUrlReachable(websiteUrl);

  if (!reachable) {
    const notes =
      "Website exists but is not reachable. May be down or misconfigured.";

    insertAudit.run(
      businessId,
      1,
      0,
      0,
      null,
      null,
      null,
      null,
      null,
      "F",
      notes,
      null
    );

    db.prepare(
      "UPDATE businesses SET status = 'audited', updated_at = datetime('now') WHERE id = ?"
    ).run(businessId);

    return {
      businessId,
      businessName,
      hasWebsite: true,
      grade: "F",
      performanceScore: null,
      accessibilityScore: null,
      seoScore: null,
      isMobileFriendly: null,
      isSsl: null,
      loadTimeMs: null,
      notes,
    };
  }

  // Run PageSpeed Insights
  let performance = 0;
  let accessibility = 0;
  let seo = 0;
  let isMobileFriendly = false;
  let isSsl = reachSsl;
  let loadTimeMs = 0;
  let rawJson: string | null = null;
  let notes = "";

  if (config.googlePageSpeedApiKey) {
    try {
      const psResult = await runPageSpeedAudit(
        websiteUrl,
        config.googlePageSpeedApiKey
      );
      performance = psResult.performance;
      accessibility = psResult.accessibility;
      seo = psResult.seo;
      isMobileFriendly = psResult.isMobileFriendly;
      isSsl = psResult.isSsl;
      loadTimeMs = psResult.loadTimeMs;
      rawJson = psResult.raw;
    } catch (err) {
      notes = `PageSpeed API error: ${err instanceof Error ? err.message : String(err)}. `;
    }
  } else {
    notes =
      "No PageSpeed API key configured. Using basic reachability check only. ";
  }

  // Compute overall score: (performance * 0.4) + (seo * 0.3) + (accessibility * 0.3)
  let overallScore =
    performance * 0.4 + seo * 0.3 + accessibility * 0.3;
  if (!isMobileFriendly) overallScore -= 20;
  if (!isSsl) overallScore -= 10;
  overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

  const grade = computeGrade(overallScore);

  if (grade === "D" || grade === "F") {
    notes += `Grade ${grade}: Strong candidate for website improvement.`;
  }

  insertAudit.run(
    businessId,
    1,
    1,
    isSsl ? 1 : 0,
    isMobileFriendly ? 1 : 0,
    performance,
    accessibility,
    seo,
    loadTimeMs,
    grade,
    notes.trim(),
    rawJson
  );

  db.prepare(
    "UPDATE businesses SET status = 'audited', updated_at = datetime('now') WHERE id = ?"
  ).run(businessId);

  return {
    businessId,
    businessName,
    hasWebsite: true,
    grade,
    performanceScore: performance,
    accessibilityScore: accessibility,
    seoScore: seo,
    isMobileFriendly,
    isSsl,
    loadTimeMs,
    notes: notes.trim(),
  };
}

export async function batchAudit(): Promise<AuditResult[]> {
  initializeDatabase();
  const db = getDb();

  const businesses = db
    .prepare(
      "SELECT id FROM businesses WHERE status = 'discovered'"
    )
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
