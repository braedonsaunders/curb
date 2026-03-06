import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import getDb from '@/lib/db';
import { generateSiteForBusiness } from '@/lib/core/generate';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    const db = getDb();

    // First try: flagged businesses, ordered by created_at ASC
    let business = db
      .prepare(
        "SELECT id FROM businesses WHERE status = 'flagged' ORDER BY created_at ASC LIMIT 1"
      )
      .get() as { id: number } | undefined;

    // Second try: audited businesses with grade D or F
    if (!business) {
      business = db
        .prepare(
          `SELECT b.id FROM businesses b
           JOIN audits a ON a.business_id = b.id
           WHERE b.status = 'audited' AND a.overall_grade IN ('D', 'F')
           ORDER BY b.created_at ASC LIMIT 1`
        )
        .get() as { id: number } | undefined;
    }

    if (!business) {
      return NextResponse.json({
        success: false,
        message: 'No businesses ready for generation',
      });
    }

    const site = await generateSiteForBusiness(business.id);

    return NextResponse.json({
      success: true,
      site: {
        businessId: site.businessId,
        businessName: site.businessName,
        slug: site.slug,
        version: site.version,
        path: site.sitePath,
        generationTimeMs: site.generationTimeMs,
      },
    });
  } catch (err) {
    console.error('Generate-next error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('not found') ? 404
      : message.includes('API_KEY') || message.includes('API key') ? 422
      : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
