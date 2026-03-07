import slugify from "slugify";
import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import { discoverBusinesses } from "../places";

export interface DiscoveryRunResult {
  runId: number;
  location: string;
  totalFound: number;
  newAdded: number;
  skippedExisting: number;
  businesses: Array<{
    id: number;
    place_id: string;
    name: string;
    slug: string;
    category: string | null;
    address: string | null;
    rating: number | null;
    website_url: string | null;
    status: string;
    enrichment_status: string | null;
    details_enriched_at: string | null;
    isNew: boolean;
  }>;
}

function generateSlug(name: string, city: string | null): string {
  const raw = city ? `${name}-${city}` : name;
  return slugify(raw, { lower: true, strict: true, trim: true });
}

function ensureUniqueSlug(
  db: ReturnType<typeof getDb>,
  baseSlug: string
): string {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = db
      .prepare("SELECT id FROM businesses WHERE slug = ?")
      .get(slug);
    if (!existing) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

export async function runDiscovery(
  location: string,
  radiusKm: number,
  categories: string[]
): Promise<DiscoveryRunResult> {
  initializeDatabase();
  const db = getDb();

  const result = await discoverBusinesses(location, radiusKm, categories);

  const insertBusiness = db.prepare(`
    INSERT INTO businesses (
      place_id, name, slug, category, address, city, province, postal_code,
      phone, email, website_url, google_maps_url, latitude, longitude,
      rating, review_count, hours_json, photos_json, status
    ) VALUES (
      @place_id, @name, @slug, @category, @address, @city, @province, @postal_code,
      @phone, @email, @website_url, @google_maps_url, @latitude, @longitude,
      @rating, @review_count, @hours_json, @photos_json, 'discovered'
    )
  `);

  const checkExisting = db.prepare(
    `SELECT
      id,
      place_id,
      name,
      slug,
      category,
      address,
      rating,
      website_url,
      status,
      enrichment_status,
      details_enriched_at
    FROM businesses
    WHERE place_id = ?`
  );

  function buildDiscoverySummary(
    row: {
      id: number;
      place_id: string;
      name: string;
      slug: string;
      category: string | null;
      address: string | null;
      rating: number | null;
      website_url: string | null;
      status: string;
      enrichment_status: string | null;
      details_enriched_at: string | null;
    },
    isNew: boolean
  ): DiscoveryRunResult["businesses"][number] {
    return {
      id: row.id,
      place_id: row.place_id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      address: row.address,
      rating: row.rating,
      website_url: row.website_url,
      status: row.status,
      enrichment_status: row.enrichment_status,
      details_enriched_at: row.details_enriched_at,
      isNew,
    };
  }

  let newAdded = 0;
  let skippedExisting = 0;
  const businessResults: DiscoveryRunResult["businesses"] = [];

  for (const biz of result.businesses) {
    const existing = checkExisting.get(biz.place_id) as
      | {
          id: number;
          place_id: string;
          name: string;
          slug: string;
          category: string | null;
          address: string | null;
          rating: number | null;
          website_url: string | null;
          status: string;
          enrichment_status: string | null;
          details_enriched_at: string | null;
        }
      | undefined;

    if (existing) {
      skippedExisting++;
      businessResults.push(buildDiscoverySummary(existing, false));
      continue;
    }

    const slug = ensureUniqueSlug(
      db,
      generateSlug(biz.name, biz.city)
    );

    try {
      insertBusiness.run({
        place_id: biz.place_id,
        name: biz.name,
        slug,
        category: biz.category,
        address: biz.address,
        city: biz.city,
        province: biz.province,
        postal_code: biz.postal_code,
        phone: biz.phone,
        email: null,
        website_url: biz.website_url,
        google_maps_url: biz.google_maps_url,
        latitude: biz.latitude,
        longitude: biz.longitude,
        rating: biz.rating,
        review_count: biz.review_count,
        hours_json: biz.hours_json,
        photos_json: biz.photos_json,
      });

      const inserted = checkExisting.get(biz.place_id) as {
        id: number;
        place_id: string;
        name: string;
        slug: string;
        category: string | null;
        address: string | null;
        rating: number | null;
        website_url: string | null;
        status: string;
        enrichment_status: string | null;
        details_enriched_at: string | null;
      };

      newAdded++;
      businessResults.push(buildDiscoverySummary(inserted, true));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint")) {
        skippedExisting++;
        const row = checkExisting.get(biz.place_id) as {
          id: number;
          place_id: string;
          name: string;
          slug: string;
          category: string | null;
          address: string | null;
          rating: number | null;
          website_url: string | null;
          status: string;
          enrichment_status: string | null;
          details_enriched_at: string | null;
        };
        businessResults.push(buildDiscoverySummary(row, false));
      } else {
        throw err;
      }
    }
  }

  // Log the discovery run
  const insertRun = db.prepare(`
    INSERT INTO discovery_runs (
      location_query, latitude, longitude, radius_km, categories,
      results_count, new_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const runResult = insertRun.run(
    location,
    result.location.lat,
    result.location.lng,
    radiusKm,
    categories.join(","),
    result.totalFound,
    newAdded
  );

  return {
    runId: Number(runResult.lastInsertRowid),
    location,
    totalFound: result.totalFound,
    newAdded,
    skippedExisting,
    businesses: businessResults,
  };
}
