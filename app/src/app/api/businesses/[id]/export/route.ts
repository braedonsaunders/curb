import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import getDb from '@/lib/db';
import { exportSite } from '@/lib/core/export';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    initializeDatabase();

    const { id } = await params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const db = getDb();
    const business = db
      .prepare('SELECT slug FROM businesses WHERE id = ?')
      .get(businessId) as { slug: string } | undefined;

    if (!business) {
      return NextResponse.json(
        { error: `Business with id ${businessId} not found` },
        { status: 404 }
      );
    }

    const slug = business.slug;
    const zipBuffer = await exportSite(slug);

    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${slug}-website.zip"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  } catch (err) {
    console.error('Export error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
