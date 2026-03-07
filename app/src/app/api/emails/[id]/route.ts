import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    const db = getDb();
    const { id } = await context.params;
    const emailId = parseInt(id, 10);

    if (isNaN(emailId)) {
      return NextResponse.json(
        { error: 'Invalid email ID' },
        { status: 400 }
      );
    }

    const existing = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId) as Record<string, unknown> | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const allowedFields = ['subject', 'body', 'status', 'to_address'];
    const updates: string[] = [];
    const values: unknown[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // If status changed to 'sent', set sent_at
    if (body.status === 'sent' && existing.status !== 'sent') {
      updates.push("sent_at = datetime('now')");
    }

    values.push(emailId);

    db.prepare(
      `UPDATE emails SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);

    return NextResponse.json({ success: true, email: updated });
  } catch (err) {
    console.error('Update email error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
