import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';
import { normalizeEmailRecord } from '@/lib/email-record';

export async function GET(request: NextRequest) {
  try {
    initializeDatabase();
    const db = getDb();

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('e.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM emails e ${whereClause}`
    ).get(...params) as { total: number };
    const total = countResult.total;

    const emailRows = db.prepare(`
      SELECT
        e.*,
        b.name as business_name,
        b.category as business_category
      FROM emails e
      LEFT JOIN businesses b ON b.id = e.business_id
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Record<string, unknown>[];

    return NextResponse.json({
      emails: emailRows.map(normalizeEmailRecord),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('List emails error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
