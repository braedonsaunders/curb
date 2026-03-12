import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import {
  generateSiteForBusiness,
  type SiteGenerationMode,
} from '@/lib/core/generate';
import { type SiteCapabilityPackOverride } from '@/lib/site-capabilities';
import {
  deployPreviewForBusiness,
  isPreviewDeploymentConfigured,
} from '@/lib/vercel-sites';

const GENERATION_MODES = new Set(['generate', 'modify', 'regenerate']);

function parseSiteCapabilityOverride(
  value: unknown
): SiteCapabilityPackOverride | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const includeCmsPack =
    typeof source.includeCmsPack === "boolean"
      ? source.includeCmsPack
      : undefined;

  if (includeCmsPack === undefined) {
    return undefined;
  }

  return {
    includeCmsPack,
  };
}

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

    const body = (await request.json()) as {
      mode?: unknown;
      prompt?: unknown;
      promptOverride?: unknown;
      modificationPrompt?: unknown;
      siteCapabilityOverride?: unknown;
    };
    const {
      mode,
      prompt,
      promptOverride,
      modificationPrompt,
      siteCapabilityOverride,
    } = body;
    const effectivePrompt =
      typeof prompt === 'string' && prompt.trim()
        ? prompt
        : typeof modificationPrompt === 'string' && modificationPrompt.trim()
          ? modificationPrompt
          : promptOverride;
    const effectiveMode: SiteGenerationMode =
      typeof mode === 'string' && GENERATION_MODES.has(mode)
        ? (mode as SiteGenerationMode)
        : typeof modificationPrompt === 'string' && modificationPrompt.trim()
          ? 'modify'
          : 'regenerate';

    const parsedSiteCapabilityOverride =
      parseSiteCapabilityOverride(siteCapabilityOverride);

    if (mode !== undefined && (typeof mode !== 'string' || !GENERATION_MODES.has(mode))) {
      return NextResponse.json(
        { error: 'mode must be one of generate, modify, or regenerate' },
        { status: 400 }
      );
    }

    if (prompt !== undefined && typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'prompt must be a string' },
        { status: 400 }
      );
    }

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

    if (
      effectiveMode === 'modify' &&
      !(typeof effectivePrompt === 'string' && effectivePrompt.trim())
    ) {
      return NextResponse.json(
        { error: 'Modify mode requires a prompt describing the requested changes.' },
        { status: 400 }
      );
    }

    const site = await generateSiteForBusiness(businessId, {
      mode: effectiveMode,
      prompt: typeof effectivePrompt === 'string' ? effectivePrompt : undefined,
      siteCapabilityOverride: parsedSiteCapabilityOverride,
    });
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
        warnings: site.warnings,
      },
      warnings: site.warnings,
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
