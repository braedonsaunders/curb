import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { generateSiteForBusiness } from '@/lib/core/generate';
import {
  deployPreviewForBusiness,
  isPreviewDeploymentConfigured,
} from '@/lib/vercel-sites';

export async function POST(
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

    const body = await request.json();
    const { promptOverride, modificationPrompt } = body;
    const effectivePrompt =
      typeof modificationPrompt === 'string' && modificationPrompt.trim()
        ? modificationPrompt
        : promptOverride;

    if (promptOverride !== undefined && typeof promptOverride !== 'string') {
      return NextResponse.json(
        { error: 'promptOverride must be a string' },
        { status: 400 }
      );
    }

    if (modificationPrompt !== undefined && typeof modificationPrompt !== 'string') {
      return NextResponse.json(
        { error: 'modificationPrompt must be a string' },
        { status: 400 }
      );
    }

    const site = await generateSiteForBusiness(businessId, effectivePrompt);
    let previewDeployment:
      | {
          aliasUrl: string | null;
          deploymentId: string;
          deploymentUrl: string;
          generatedSiteId: number;
          readyState: string | null;
          version: number;
        }
      | null = null;
    let previewDeploymentError: string | null = null;

    if (isPreviewDeploymentConfigured()) {
      try {
        previewDeployment = await deployPreviewForBusiness(businessId, {
          initiatedBy: 'automatic',
        });
      } catch (error) {
        previewDeploymentError =
          error instanceof Error ? error.message : 'Preview deployment failed';
      }
    }

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
      previewDeployment,
      previewDeploymentError,
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
