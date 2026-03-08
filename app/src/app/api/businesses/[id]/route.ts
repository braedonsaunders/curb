import { NextRequest, NextResponse } from 'next/server';
import {
  ensureEnrichmentWorkerRunning,
  runPendingEnrichmentPass,
} from '@/lib/core/enrichment';
import { initializeDatabase } from '@/lib/schema';
import { getDb } from '@/lib/db';
import { normalizeEmailRecord } from '@/lib/email-record';
import {
  getCustomerProjectState,
  getPublicPreviewLinkForBusiness,
  listSiteDeploymentsForBusiness,
} from '@/lib/vercel-sites';

type RouteContext = { params: Promise<{ id: string }> };

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    const audits = db.prepare(
      'SELECT * FROM audits WHERE business_id = ? AND audit_version = 2 ORDER BY created_at DESC'
    ).all(businessId);

    const generatedSites = db.prepare(
      'SELECT * FROM generated_sites WHERE business_id = ? ORDER BY version DESC'
    ).all(businessId);

    const emails = db.prepare(
      'SELECT * FROM emails WHERE business_id = ? ORDER BY created_at DESC'
    ).all(businessId);
    const siteDeployments = listSiteDeploymentsForBusiness(businessId);
    const previewLink = getPublicPreviewLinkForBusiness(
      businessId,
      String((business as Record<string, unknown>).slug ?? "")
    );
    const customerProjectState = getCustomerProjectState(businessId);

    // Add camelCase aliases for audits
    const normalizedAudits = (audits as Record<string, unknown>[]).map((audit) => ({
      ...audit,
      grade: audit.overall_grade,
      hasWebsite: audit.has_website,
      urlReachable: audit.url_reachable,
      ownerSentiment: audit.owner_sentiment,
      summary: audit.notes,
      screenshotUrl: typeof audit.screenshot_path === "string" && audit.screenshot_path
        ? `/${audit.screenshot_path.replace(/^\/+/, "")}`
        : null,
      websiteComplexity: audit.website_complexity,
      replacementDifficulty: audit.replacement_difficulty,
      advancedFeatures: parseJsonArray(audit.advanced_features_json),
      strengths: parseJsonArray(audit.strengths_json),
      issues: parseJsonArray(audit.issues_json),
      createdAt: audit.created_at,
    }));

    // Add camelCase aliases for generated_sites
    const normalizedSites = (generatedSites as Record<string, unknown>[]).map((site) => ({
      ...site,
      generatedAt: site.created_at,
    }));

    // Add camelCase aliases for emails
    const normalizedEmails = (emails as Record<string, unknown>[]).map(normalizeEmailRecord);
    const normalizedSiteDeployments = siteDeployments.map((deployment) => ({
      ...deployment,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    }));

    return NextResponse.json({
      ...(business as Record<string, unknown>),
      customerDomain: customerProjectState.customerDomain,
      customerDomainVerified: customerProjectState.customerDomainVerified,
      customerDomainVerification: customerProjectState.customerDomainVerification,
      customerVercelProjectId: customerProjectState.customerProjectId,
      customerVercelProjectName: customerProjectState.customerProjectName,
      publicPreviewUrl: previewLink.url,
      publicPreviewUrlSource: previewLink.source,
      audits: normalizedAudits,
      generatedSites: normalizedSites,
      emails: normalizedEmails,
      siteDeployments: normalizedSiteDeployments,
    });
  } catch (err) {
    console.error('Get business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const existing = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const allowedFields = [
      'status', 'notes', 'email', 'name', 'address', 'city', 'province',
      'postal_code', 'phone', 'website_url', 'category', 'google_maps_url',
      'customer_domain',
    ];
    const enrichmentSensitiveFields = new Set([
      'name',
      'address',
      'city',
      'province',
      'postal_code',
      'phone',
      'website_url',
      'category',
      'google_maps_url',
    ]);
    const updates: string[] = [];
    const values: unknown[] = [];
    let shouldResetEnrichment = false;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
        if (field === 'customer_domain') {
          updates.push('customer_domain_verified = 0');
          updates.push('customer_domain_verification_json = NULL');
        }
        if (enrichmentSensitiveFields.has(field)) {
          shouldResetEnrichment = true;
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    if (shouldResetEnrichment) {
      updates.push("enrichment_status = 'pending'");
      updates.push("enrichment_completed_at = NULL");
      updates.push("enrichment_error = NULL");
    }

    updates.push("updated_at = datetime('now')");
    values.push(businessId);

    db.prepare(
      `UPDATE businesses SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    if (shouldResetEnrichment) {
      void runPendingEnrichmentPass();
    }

    return NextResponse.json({ success: true, business: updated });
  } catch (err) {
    console.error('Update business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    initializeDatabase();
    ensureEnrichmentWorkerRunning();
    const db = getDb();
    const { id } = await context.params;
    const businessId = parseInt(id, 10);

    if (isNaN(businessId)) {
      return NextResponse.json(
        { error: 'Invalid business ID' },
        { status: 400 }
      );
    }

    const existing = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    db.prepare(
      "UPDATE businesses SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
    ).run(businessId);

    return NextResponse.json({ success: true, message: 'Business archived' });
  } catch (err) {
    console.error('Delete business error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
