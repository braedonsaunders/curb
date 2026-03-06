import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { generateSiteForBusiness } from '@/lib/core/generate';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();

    const body = await request.json();
    const { businessId, promptOverride } = body;

    if (!businessId || typeof businessId !== 'number') {
      return NextResponse.json(
        { error: 'businessId is required and must be a number' },
        { status: 400 }
      );
    }

    if (promptOverride !== undefined && typeof promptOverride !== 'string') {
      return NextResponse.json(
        { error: 'promptOverride must be a string' },
        { status: 400 }
      );
    }

    const site = await generateSiteForBusiness(businessId, promptOverride);

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
    console.error('Generate error:', err);
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
