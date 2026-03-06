import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    const audits = db.prepare(
      'SELECT * FROM audits WHERE business_id = ? ORDER BY created_at DESC'
    ).all(businessId);

    const generatedSites = db.prepare(
      'SELECT * FROM generated_sites WHERE business_id = ? ORDER BY version DESC'
    ).all(businessId);

    const emails = db.prepare(
      'SELECT * FROM emails WHERE business_id = ? ORDER BY created_at DESC'
    ).all(businessId);

    return NextResponse.json({
      ...(business as Record<string, unknown>),
      audits,
      generatedSites,
      emails,
    });
  } catch (err) {
    console.error('Get business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const existing = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const allowedFields = [
      'status', 'notes', 'email', 'name', 'address', 'city', 'province',
      'postal_code', 'phone', 'website_url', 'category', 'google_maps_url',
    ];
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

    updates.push("updated_at = datetime('now')");
    values.push(businessId);

    db.prepare(
      `UPDATE businesses SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);

    return NextResponse.json({ success: true, business: updated });
  } catch (err) {
    console.error('Update business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const existing = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    db.prepare(
      "UPDATE businesses SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
    ).run(businessId);

    return NextResponse.json({ success: true, message: 'Business archived' });
  } catch (err) {
    console.error('Delete business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
