import { getDb } from "./db";

export function initializeDatabase(): void {
  const db = getDb();

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
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      has_website BOOLEAN NOT NULL,
      url_reachable BOOLEAN,
      is_ssl BOOLEAN,
      is_mobile_friendly BOOLEAN,
      performance_score INTEGER,
      accessibility_score INTEGER,
      seo_score INTEGER,
      load_time_ms INTEGER,
      overall_grade TEXT,
      notes TEXT,
      raw_json TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
    CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);
    CREATE INDEX IF NOT EXISTS idx_audits_business_id ON audits(business_id);
    CREATE INDEX IF NOT EXISTS idx_generated_sites_business_id ON generated_sites(business_id);
    CREATE INDEX IF NOT EXISTS idx_emails_business_id ON emails(business_id);
  `);
}
