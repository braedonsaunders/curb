import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { runDiscovery } from '@/lib/core/discover';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();

    const body = await request.json();
    const { location, radiusKm, categories } = body;

    if (!location || typeof location !== 'string') {
      return NextResponse.json(
        { error: 'location is required and must be a string' },
        { status: 400 }
      );
    }

    if (radiusKm !== undefined && (typeof radiusKm !== 'number' || radiusKm <= 0)) {
      return NextResponse.json(
        { error: 'radiusKm must be a positive number' },
        { status: 400 }
      );
    }

    if (categories !== undefined && !Array.isArray(categories)) {
      return NextResponse.json(
        { error: 'categories must be an array of strings' },
        { status: 400 }
      );
    }

    const result = await runDiscovery(
      location,
      radiusKm || 10,
      categories || ['restaurant', 'store', 'health', 'beauty_salon', 'gym']
    );

    return NextResponse.json({
      success: true,
      totalFound: result.totalFound,
      newAdded: result.newAdded,
      businesses: result.businesses,
    });
  } catch (err) {
    console.error('Discovery error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('API_KEY') ? 422 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
