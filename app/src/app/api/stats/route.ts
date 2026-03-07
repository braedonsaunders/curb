import { NextResponse } from 'next/server';
import { ensureEnrichmentWorkerRunning } from '@/lib/core/enrichment';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const db = getDb();

    // Count businesses by status
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM businesses
      WHERE status != 'archived'
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
    }

    // Total businesses (excluding archived)
    const totalResult = db.prepare(
      "SELECT COUNT(*) as total FROM businesses WHERE status != 'archived'"
    ).get() as { total: number };

    // Total sites generated
    const sitesResult = db.prepare(
      'SELECT COUNT(*) as total FROM generated_sites'
    ).get() as { total: number };

    // Total emails sent
    const emailsSentResult = db.prepare(
      "SELECT COUNT(*) as total FROM emails WHERE status = 'sent'"
    ).get() as { total: number };

    // Total emails drafted
    const emailsDraftResult = db.prepare(
      "SELECT COUNT(*) as total FROM emails WHERE status = 'draft'"
    ).get() as { total: number };

    // Grade distribution from latest audits
    const gradeDistribution = db.prepare(`
      SELECT overall_grade as grade, COUNT(*) as count
      FROM audits a
      WHERE a.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = a.business_id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      GROUP BY overall_grade
      ORDER BY overall_grade
    `).all();

    const replacementDifficultyDistribution = db.prepare(`
      SELECT replacement_difficulty as value, COUNT(*) as count
      FROM audits a
      WHERE a.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = a.business_id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      GROUP BY replacement_difficulty
      ORDER BY count DESC
    `).all();

    const websiteComplexityDistribution = db.prepare(`
      SELECT website_complexity as value, COUNT(*) as count
      FROM audits a
      WHERE a.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = a.business_id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      GROUP BY website_complexity
      ORDER BY count DESC
    `).all();

    const ownerSentimentDistribution = db.prepare(`
      SELECT owner_sentiment as value, COUNT(*) as count
      FROM audits a
      WHERE a.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = a.business_id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      GROUP BY owner_sentiment
      ORDER BY count DESC
    `).all();

    const leadSignals = db.prepare(`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN b.status = 'flagged' AND COALESCE(latest_audit.has_website, 0) = 0
              THEN 1
            ELSE 0
          END
        ), 0) as noWebsiteFlagged,
        COALESCE(SUM(
          CASE
            WHEN b.status = 'flagged' AND latest_audit.replacement_difficulty = 'easy'
              THEN 1
            ELSE 0
          END
        ), 0) as easyReplacementFlagged,
        COALESCE(SUM(
          CASE
            WHEN b.status = 'flagged' AND latest_audit.website_complexity IN ('none', 'simple')
              THEN 1
            ELSE 0
          END
        ), 0) as simpleSiteFlagged,
        COALESCE(SUM(
          CASE
            WHEN b.status = 'flagged' AND latest_audit.owner_sentiment = 'embarrassed'
              THEN 1
            ELSE 0
          END
        ), 0) as embarrassedOwnerFlagged,
        COALESCE(SUM(
          CASE
            WHEN b.status = 'flagged'
              AND latest_audit.replacement_difficulty = 'easy'
              AND (
                COALESCE(latest_audit.has_website, 0) = 0
                OR (
                  latest_audit.overall_grade IN ('D', 'F')
                  AND latest_audit.website_complexity IN ('none', 'simple', 'moderate')
                )
              )
              THEN 1
            ELSE 0
          END
        ), 0) as primeTargets
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = b.id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      WHERE b.status != 'archived'
    `).get() as {
      noWebsiteFlagged: number;
      easyReplacementFlagged: number;
      simpleSiteFlagged: number;
      embarrassedOwnerFlagged: number;
      primeTargets: number;
    };

    const topOpportunities = db.prepare(`
      SELECT
        b.id,
        b.name,
        b.category,
        b.status,
        b.updated_at,
        latest_audit.overall_grade,
        latest_audit.owner_sentiment,
        latest_audit.website_complexity,
        latest_audit.replacement_difficulty,
        latest_audit.has_website
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id
        FROM audits a2
        WHERE a2.business_id = b.id AND a2.audit_version = 2
        ORDER BY a2.created_at DESC
        LIMIT 1
      )
      WHERE b.status = 'flagged'
      ORDER BY
        CASE latest_audit.replacement_difficulty
          WHEN 'easy' THEN 0
          WHEN 'medium' THEN 1
          WHEN 'hard' THEN 2
          ELSE 3
        END,
        CASE
          WHEN COALESCE(latest_audit.has_website, 0) = 0 THEN 0
          ELSE 1
        END,
        CASE latest_audit.overall_grade
          WHEN 'F' THEN 0
          WHEN 'D' THEN 1
          WHEN 'C' THEN 2
          WHEN 'B' THEN 3
          WHEN 'A' THEN 4
          ELSE 5
        END,
        CASE latest_audit.website_complexity
          WHEN 'none' THEN 0
          WHEN 'simple' THEN 1
          WHEN 'moderate' THEN 2
          WHEN 'advanced' THEN 3
          ELSE 4
        END,
        b.updated_at DESC
      LIMIT 8
    `).all();

    // Recent activity - last 10 businesses updated
    const recentActivity = db.prepare(`
      SELECT id, name, slug, status, category, updated_at
      FROM businesses
      WHERE status != 'archived'
      ORDER BY updated_at DESC
      LIMIT 10
    `).all();

    return NextResponse.json({
      totalBusinesses: totalResult.total,
      totalSitesGenerated: sitesResult.total,
      totalEmailsSent: emailsSentResult.total,
      totalEmailsDraft: emailsDraftResult.total,
      businessesByStatus: byStatus,
      gradeDistribution,
      replacementDifficultyDistribution,
      websiteComplexityDistribution,
      ownerSentimentDistribution,
      leadSignals,
      topOpportunities,
      recentActivity,
    });
  } catch (err) {
    console.error('Stats error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
