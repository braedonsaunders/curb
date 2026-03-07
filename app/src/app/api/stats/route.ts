import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    initializeDatabase();
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
        SELECT a2.id FROM audits a2 WHERE a2.business_id = a.business_id ORDER BY a2.created_at DESC LIMIT 1
      )
      GROUP BY overall_grade
      ORDER BY overall_grade
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
