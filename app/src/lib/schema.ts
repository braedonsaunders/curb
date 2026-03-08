import { initializeSettingsStore } from "./config";
import { getDb } from "./db";

function ensureColumn(
  table: string,
  column: string,
  definition: string
): void {
  const db = getDb();
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  if (columns.some((entry) => entry.name === column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function initializeDatabase(): void {
  const db = getDb();

  initializeSettingsStore();

  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      postal_code TEXT,
      phone TEXT,
      email TEXT,
      website_url TEXT,
      google_maps_url TEXT,
      latitude REAL,
      longitude REAL,
      rating REAL,
      review_count INTEGER,
      hours_json TEXT,
      photos_json TEXT,
      status TEXT DEFAULT 'discovered',
      enrichment_status TEXT DEFAULT 'pending',
      details_enriched_at TEXT,
      enrichment_started_at TEXT,
      enrichment_completed_at TEXT,
      enrichment_error TEXT,
      enrichment_attempts INTEGER DEFAULT 0,
      customer_domain TEXT,
      customer_domain_verified BOOLEAN DEFAULT 0,
      customer_domain_verification_json TEXT,
      vercel_customer_project_id TEXT,
      vercel_customer_project_name TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      has_website BOOLEAN NOT NULL,
      url_reachable BOOLEAN,
      overall_grade TEXT,
      owner_sentiment TEXT,
      notes TEXT,
      screenshot_path TEXT,
      strengths_json TEXT,
      issues_json TEXT,
      website_complexity TEXT,
      replacement_difficulty TEXT,
      advanced_features_json TEXT,
      review_json TEXT,
      audit_version INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS generated_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      version INTEGER DEFAULT 1,
      slug TEXT NOT NULL,
      site_path TEXT NOT NULL,
      prompt_used TEXT,
      model_used TEXT,
      generation_time_ms INTEGER,
      exported BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      generated_site_id INTEGER NOT NULL REFERENCES generated_sites(id),
      deployment_kind TEXT NOT NULL,
      vercel_project_id TEXT NOT NULL,
      vercel_project_name TEXT,
      vercel_deployment_id TEXT NOT NULL,
      vercel_deployment_url TEXT NOT NULL,
      alias_url TEXT,
      alias_host TEXT,
      target TEXT NOT NULL,
      ready_state TEXT,
      active BOOLEAN DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      to_address TEXT,
      status TEXT DEFAULT 'draft',
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_query TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      radius_km INTEGER,
      categories TEXT,
      results_count INTEGER,
      new_count INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      stage TEXT NOT NULL,
      business_id INTEGER REFERENCES businesses(id),
      business_name TEXT,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
    CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);
    CREATE INDEX IF NOT EXISTS idx_audits_business_id ON audits(business_id);
    CREATE INDEX IF NOT EXISTS idx_generated_sites_business_id ON generated_sites(business_id);
    CREATE INDEX IF NOT EXISTS idx_site_deployments_business_kind ON site_deployments(business_id, deployment_kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_deployments_generated_site_id ON site_deployments(generated_site_id);
    CREATE INDEX IF NOT EXISTS idx_emails_business_id ON emails(business_id);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
  `);

  ensureColumn("audits", "owner_sentiment", "owner_sentiment TEXT");
  ensureColumn("audits", "screenshot_path", "screenshot_path TEXT");
  ensureColumn("audits", "strengths_json", "strengths_json TEXT");
  ensureColumn("audits", "issues_json", "issues_json TEXT");
  ensureColumn("audits", "website_complexity", "website_complexity TEXT");
  ensureColumn(
    "audits",
    "replacement_difficulty",
    "replacement_difficulty TEXT"
  );
  ensureColumn(
    "audits",
    "advanced_features_json",
    "advanced_features_json TEXT"
  );
  ensureColumn("audits", "review_json", "review_json TEXT");
  ensureColumn("audits", "audit_version", "audit_version INTEGER");
  ensureColumn(
    "businesses",
    "enrichment_status",
    "enrichment_status TEXT DEFAULT 'pending'"
  );
  ensureColumn(
    "businesses",
    "details_enriched_at",
    "details_enriched_at TEXT"
  );
  ensureColumn(
    "businesses",
    "enrichment_started_at",
    "enrichment_started_at TEXT"
  );
  ensureColumn(
    "businesses",
    "enrichment_completed_at",
    "enrichment_completed_at TEXT"
  );
  ensureColumn(
    "businesses",
    "enrichment_error",
    "enrichment_error TEXT"
  );
  ensureColumn(
    "businesses",
    "enrichment_attempts",
    "enrichment_attempts INTEGER DEFAULT 0"
  );
  ensureColumn("businesses", "customer_domain", "customer_domain TEXT");
  ensureColumn(
    "businesses",
    "customer_domain_verified",
    "customer_domain_verified BOOLEAN DEFAULT 0"
  );
  ensureColumn(
    "businesses",
    "customer_domain_verification_json",
    "customer_domain_verification_json TEXT"
  );
  ensureColumn(
    "businesses",
    "vercel_customer_project_id",
    "vercel_customer_project_id TEXT"
  );
  ensureColumn(
    "businesses",
    "vercel_customer_project_name",
    "vercel_customer_project_name TEXT"
  );

  db.prepare(
    "UPDATE businesses SET enrichment_status = 'pending' WHERE enrichment_status IS NULL"
  ).run();
  db.prepare(
    "UPDATE businesses SET enrichment_attempts = 0 WHERE enrichment_attempts IS NULL"
  ).run();
  db.prepare(`
    UPDATE businesses
    SET details_enriched_at = COALESCE(updated_at, created_at)
    WHERE details_enriched_at IS NULL
      AND (
        website_url IS NOT NULL
        OR google_maps_url IS NOT NULL
        OR phone IS NOT NULL
        OR city IS NOT NULL
        OR hours_json IS NOT NULL
      )
  `).run();
  db.prepare(`
    UPDATE businesses
    SET customer_domain_verified = 0
    WHERE customer_domain_verified IS NULL
  `).run();
}
