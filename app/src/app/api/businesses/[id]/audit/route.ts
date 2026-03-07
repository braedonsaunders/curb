import { NextRequest, NextResponse } from 'next/server';
import { ensureEnrichmentWorkerRunning } from '@/lib/core/enrichment';
import { initializeDatabase } from '@/lib/schema';
import { auditBusiness } from '@/lib/core/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();

    const { id } = await params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
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
