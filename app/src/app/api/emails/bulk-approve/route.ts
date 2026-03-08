import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import getDb from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    const db = getDb();

    const body = await request.json();
    const emailIds = body.emailIds ?? body.ids;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return NextResponse.json(
        { error: 'emailIds must be a non-empty array of numbers' },
        { status: 400 }
      );
    }

    if (!emailIds.every((id: unknown) => typeof id === 'number')) {
      return NextResponse.json(
        { error: 'All emailIds must be numbers' },
        { status: 400 }
      );
    }

    const placeholders = emailIds.map(() => '?').join(', ');
    const result = db
      .prepare(
        `UPDATE emails SET status = 'approved' WHERE id IN (${placeholders})`
      )
      .run(...emailIds);

    return NextResponse.json({
      success: true,
      count: result.changes,
    });
  } catch (err) {
    console.error('Bulk approve error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
