import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';
import slugify from 'slugify';

export async function GET(request: NextRequest) {
  try {
    initializeDatabase();
    const db = getDb();

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const grade = searchParams.get('grade');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20', 10)));
    const offset = (page - 1) * limit;

    // Sorting
    const allowedSortColumns: Record<string, string> = {
      name: 'b.name',
      category: 'b.category',
      city: 'b.city',
      status: 'b.status',
      grade: 'latest_audit.overall_grade',
      created_at: 'b.created_at',
    };
    const sortParam = searchParams.get('sort');
    const dirParam = searchParams.get('dir');
    const sortColumn = (sortParam && allowedSortColumns[sortParam]) || 'b.updated_at';
    const sortDirection = dirParam === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (category) {
      conditions.push('b.category = ?');
      params.push(category);
    }

    if (grade) {
      conditions.push('latest_audit.overall_grade = ?');
      params.push(grade);
    }

    if (search) {
      conditions.push('(b.name LIKE ? OR b.category LIKE ? OR b.city LIKE ? OR b.address LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Exclude archived by default unless explicitly requested
    if (status !== 'archived') {
      conditions.push("b.status != 'archived'");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `
      SELECT COUNT(DISTINCT b.id) as total
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id FROM audits a2 WHERE a2.business_id = b.id ORDER BY a2.created_at DESC LIMIT 1
      )
      ${whereClause}
    `;
    const countResult = db.prepare(countSql).get(...params) as { total: number };
    const total = countResult.total;

    // Data query
    const dataSql = `
      SELECT
        b.*,
        latest_audit.overall_grade,
        latest_audit.performance_score,
        latest_audit.has_website as audit_has_website,
        latest_audit.created_at as audit_date,
        latest_site.id as site_id,
        latest_site.slug as site_slug,
        latest_site.version as site_version,
        latest_site.created_at as site_created_at
      FROM businesses b
      LEFT JOIN audits latest_audit ON latest_audit.id = (
        SELECT a2.id FROM audits a2 WHERE a2.business_id = b.id ORDER BY a2.created_at DESC LIMIT 1
      )
      LEFT JOIN generated_sites latest_site ON latest_site.id = (
        SELECT gs.id FROM generated_sites gs WHERE gs.business_id = b.id ORDER BY gs.version DESC LIMIT 1
      )
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `;

    const businesses = db.prepare(dataSql).all(...params, limit, offset);

    return NextResponse.json({
      businesses,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('List businesses error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    const db = getDb();

    const body = await request.json();
    const { name, place_id, address, city, province, postal_code, phone, email, website_url, category, latitude, longitude, notes } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      );
    }

    const slug = slugify(name, { lower: true, strict: true });
    // Ensure unique slug
    const existingSlug = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug);
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    // Generate a place_id for manual entries if not provided
    const finalPlaceId = place_id || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result = db.prepare(`
      INSERT INTO businesses (place_id, name, slug, category, address, city, province, postal_code, phone, email, website_url, latitude, longitude, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered')
    `).run(
      finalPlaceId,
      name,
      finalSlug,
      category || null,
      address || null,
      city || null,
      province || null,
      postal_code || null,
      phone || null,
      email || null,
      website_url || null,
      latitude || null,
      longitude || null,
      notes || null
    );

    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(result.lastInsertRowid);

    return NextResponse.json(
      { success: true, business },
      { status: 201 }
    );
  } catch (err) {
    console.error('Create business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('UNIQUE constraint') ? 409 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
