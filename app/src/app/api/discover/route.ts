import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { expandDiscoveryCategoryIds } from '@/lib/discovery-categories';
import { ensureEnrichmentWorkerRunning, runPendingEnrichmentPass } from '@/lib/core/enrichment';
import { initializeDatabase } from '@/lib/schema';
import { runDiscovery } from '@/lib/core/discover';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();

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

    const config = getConfig();
    const requestedCategories =
      categories && categories.length > 0
        ? categories
        : config.defaultCategories;
    const placeTypes = expandDiscoveryCategoryIds(requestedCategories);

    if (placeTypes.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one discovery category in Discover or Settings.' },
        { status: 400 }
      );
    }

    const result = await runDiscovery(
      location,
      radiusKm || config.defaultRadiusKm,
      placeTypes
    );
    void runPendingEnrichmentPass();

    return NextResponse.json({
      success: true,
      totalFound: result.totalFound,
      newAdded: result.newAdded,
      skippedExisting: result.skippedExisting,
      businesses: result.businesses,
      run: {
        id: result.runId,
        location: result.location,
        categories: requestedCategories,
        totalFound: result.totalFound,
        newFound: result.newAdded,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Discovery error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status =
      message.includes('API key') ? 422
      : message.includes('Select at least one') ? 400
      : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
