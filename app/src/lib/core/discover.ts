import slugify from "slugify";
import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import {
  discoverBusinesses,
  getPlaceDetails,
  type DiscoveredBusiness,
} from "../places";

export interface DiscoveryRunResult {
  runId: number;
  location: string;
  totalFound: number;
  newAdded: number;
  skippedExisting: number;
  businesses: Array<{
    place_id: string;
    name: string;
    slug: string;
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
    "SELECT id FROM businesses WHERE place_id = ?"
  );

  let newAdded = 0;
  let skippedExisting = 0;
  const businessResults: DiscoveryRunResult["businesses"] = [];

  for (const biz of result.businesses) {
    const existing = checkExisting.get(biz.place_id) as
      | { id: number }
      | undefined;

    if (existing) {
      skippedExisting++;
      const row = db
        .prepare("SELECT slug FROM businesses WHERE place_id = ?")
        .get(biz.place_id) as { slug: string };
      businessResults.push({
        place_id: biz.place_id,
        name: biz.name,
        slug: row.slug,
        isNew: false,
      });
      continue;
    }

    // Enrich with Place Details when possible
    let enriched: DiscoveredBusiness = { ...biz };
    try {
      const details = await getPlaceDetails(biz.place_id);
      const addressComponents = details.address_components ?? [];

      let city: string | null = null;
      let province: string | null = null;
      let postalCode: string | null = null;

      for (const comp of addressComponents) {
        if (comp.types.includes("locality")) city = comp.long_name;
        if (comp.types.includes("administrative_area_level_1"))
          province = comp.short_name;
        if (comp.types.includes("postal_code"))
          postalCode = comp.long_name;
      }

      enriched = {
        ...enriched,
        address: details.formatted_address ?? enriched.address,
        city: city ?? enriched.city,
        province: province ?? enriched.province,
        postal_code: postalCode ?? enriched.postal_code,
        phone: details.formatted_phone_number ?? enriched.phone,
        website_url: details.website ?? enriched.website_url,
        google_maps_url: details.url ?? enriched.google_maps_url,
        rating: details.rating ?? enriched.rating,
        review_count:
          details.user_ratings_total ?? enriched.review_count,
        hours_json: details.opening_hours?.weekday_text
          ? JSON.stringify(details.opening_hours.weekday_text)
          : enriched.hours_json,
        photos_json: details.photos?.length
          ? JSON.stringify(
              details.photos.map((p) => p.photo_reference)
            )
          : enriched.photos_json,
      };
    } catch {
      // Use basic nearby search data if details fail
    }

    const slug = ensureUniqueSlug(
      db,
      generateSlug(enriched.name, enriched.city)
    );

    try {
      insertBusiness.run({
        place_id: enriched.place_id,
        name: enriched.name,
        slug,
        category: enriched.category,
        address: enriched.address,
        city: enriched.city,
        province: enriched.province,
        postal_code: enriched.postal_code,
        phone: enriched.phone,
        email: null,
        website_url: enriched.website_url,
        google_maps_url: enriched.google_maps_url,
        latitude: enriched.latitude,
        longitude: enriched.longitude,
        rating: enriched.rating,
        review_count: enriched.review_count,
        hours_json: enriched.hours_json,
        photos_json: enriched.photos_json,
      });

      newAdded++;
      businessResults.push({
        place_id: enriched.place_id,
        name: enriched.name,
        slug,
        isNew: true,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint")) {
        skippedExisting++;
        businessResults.push({
          place_id: enriched.place_id,
          name: enriched.name,
          slug,
          isNew: false,
        });
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
