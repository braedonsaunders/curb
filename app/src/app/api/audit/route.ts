import { NextRequest, NextResponse } from 'next/server';
import { ensureEnrichmentWorkerRunning } from '@/lib/core/enrichment';
import { initializeDatabase } from '@/lib/schema';
import { auditBusiness, batchAudit } from '@/lib/core/audit';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();

    const body = await request.json();
    const { businessId, batch } = body;

    if (!businessId && !batch) {
      return NextResponse.json(
        { error: 'Either businessId or batch: true is required' },
        { status: 400 }
      );
    }

    if (businessId && typeof businessId !== 'number') {
      return NextResponse.json(
        { error: 'businessId must be a number' },
        { status: 400 }
      );
    }

    if (batch === true) {
      const results = await batchAudit();
      return NextResponse.json({
        success: true,
        totalAudited: results.length,
        results,
      });
    }

    const result = await auditBusiness(businessId);
    return NextResponse.json({
      success: true,
      audit: result,
    });
  } catch (err) {
    console.error('Audit error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
