import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import { generateSite, type BusinessData } from "../claude";
import { downloadPlacePhoto } from "../places";

const SITES_DIR = path.resolve(process.cwd(), "..", "sites");

export interface GenerateResult {
  businessId: number;
  businessName: string;
  slug: string;
  sitePath: string;
  version: number;
  generationTimeMs: number;
}

function businessRowToData(
  row: Record<string, unknown>
): BusinessData {
  return {
    name: row.name as string,
    category: (row.category as string) ?? null,
    address: (row.address as string) ?? null,
    city: (row.city as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website_url: (row.website_url as string) ?? null,
    rating: (row.rating as number) ?? null,
    review_count: (row.review_count as number) ?? null,
    hours_json: (row.hours_json as string) ?? null,
    photos_json: (row.photos_json as string) ?? null,
    google_maps_url: (row.google_maps_url as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
  };
}

async function downloadPhotos(
  photosJson: string | null,
  slug: string
): Promise<string[]> {
  if (!photosJson) return [];

  let photoRefs: string[];
  try {
    photoRefs = JSON.parse(photosJson);
  } catch {
    return [];
  }

  if (!Array.isArray(photoRefs) || photoRefs.length === 0) return [];

  const toDownload = photoRefs.slice(0, 5);
  const downloadedPaths: string[] = [];

  for (const ref of toDownload) {
    try {
      const relativePath = await downloadPlacePhoto(ref, slug);
      downloadedPaths.push(relativePath);
    } catch (err) {
      console.error(
        `Failed to download photo for ${slug}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return downloadedPaths;
}

export async function generateSiteForBusiness(
  businessId: number,
  promptOverride?: string
): Promise<GenerateResult> {
  initializeDatabase();
  const db = getDb();

  const business = db
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(businessId) as Record<string, unknown> | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const slug = business.slug as string;
  const name = business.name as string;
  const photosJson = business.photos_json as string | null;

  // Create directory structure
  const siteDir = path.join(SITES_DIR, slug);
  const assetsDir = path.join(siteDir, "assets", "photos");
  fs.mkdirSync(assetsDir, { recursive: true });

  // Download photos
  await downloadPhotos(photosJson, slug);

  // Prepare business data for Claude
  const businessData = businessRowToData(business);

  // Generate the site HTML
  const startTime = Date.now();
  const html = await generateSite(businessData);
  const generationTimeMs = Date.now() - startTime;

  // Write the HTML file
  const indexPath = path.join(siteDir, "index.html");
  fs.writeFileSync(indexPath, html, "utf-8");

  // Determine version
  const latestVersion = db
    .prepare(
      "SELECT MAX(version) as max_version FROM generated_sites WHERE business_id = ?"
    )
    .get(businessId) as { max_version: number | null } | undefined;

  const version = (latestVersion?.max_version ?? 0) + 1;

  // Insert generated_sites record
  const sitePath = path.relative(
    path.resolve(process.cwd(), ".."),
    siteDir
  );

  db.prepare(
    `INSERT INTO generated_sites (
      business_id, version, slug, site_path, prompt_used, model_used,
      generation_time_ms, exported
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    businessId,
    version,
    slug,
    sitePath,
    promptOverride ?? null,
    "claude-sonnet-4-20250514",
    generationTimeMs
  );

  // Update business status
  db.prepare(
    "UPDATE businesses SET status = 'generated', updated_at = datetime('now') WHERE id = ?"
  ).run(businessId);

  return {
    businessId,
    businessName: name,
    slug,
    sitePath: siteDir,
    version,
    generationTimeMs,
  };
}
