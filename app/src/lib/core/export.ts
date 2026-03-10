import fs from "fs";
import path from "path";
import archiver from "archiver";
import { getDb } from "../db";
import {
  normalizeSiteCapabilityProfile,
  resolveStoreCommerceProvider,
  SITE_CAPABILITY_MANIFEST_PATH,
  type SiteCapabilityProfile,
} from "../site-capabilities";
import { initializeDatabase } from "../schema";

const SITES_DIR = path.resolve(process.cwd(), "..", "sites");

function readCapabilityProfile(siteDir: string): SiteCapabilityProfile | null {
  const manifestPath = path.join(
    siteDir,
    ...SITE_CAPABILITY_MANIFEST_PATH.split("/")
  );

  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      capabilityProfile?: unknown;
    };
    return normalizeSiteCapabilityProfile(parsed.capabilityProfile ?? null);
  } catch {
    return null;
  }
}

function buildCapabilitySection(profile: SiteCapabilityProfile | null): string {
  if (!profile) {
    return "";
  }

  const lines = [
    "## Capability Recommendation",
    "",
    `Operating model: ${profile.operatingModel}`,
    `Confidence: ${profile.confidence}`,
    `Summary: ${profile.packageSummary}`,
  ];

  if (profile.reasons.length > 0) {
    lines.push("", "Why Curb recommended this:");
    for (const reason of profile.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (profile.operatingModel === "static-plus-cms") {
    lines.push(
      "",
      "Recommended owner-edit stack:",
      "- Keep the public site static on Vercel or another static host",
      "- Add a customer-owned Firebase project for authentication and content storage",
      "- The built-in /admin portal uses Firebase email-link sign-in and Firestore-backed content records",
      "- Use the machine-readable manifest in assets/curb-site-package.json as the contract for future CMS packaging"
    );
  }

  if (profile.operatingModel === "static-plus-cms-and-store") {
    const commerceProvider = resolveStoreCommerceProvider(
      profile.commerce.provider
    );
    lines.push(
      "",
      "Recommended owner-edit and store stack:",
      "- Keep the public site static",
      "- Use the built-in Firebase owner portal for content and product updates",
      `- Start commerce with ${
        commerceProvider === "shopify"
          ? "Shopify checkout links"
          : "Stripe Payment Links"
      } instead of a custom cart or inventory backend`,
      "- Treat products as structured records so the owner can update catalog entries without editing HTML"
    );
  }

  if (profile.operatingModel === "custom-app") {
    lines.push(
      "",
      "Important:",
      "- Do not force this into the lightweight static pack",
      "- Keep the marketing pages static if you want, but scope the advanced customer flow as a separate app or specialist integration"
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildReadmeContent(siteDir: string): string {
  const capabilitySection = buildCapabilitySection(readCapabilityProfile(siteDir));

  return `# Generated Website
================================

This website was generated or mirrored by Curb for a local business.

## Setup Instructions

1. Unzip this archive to your desired directory.

2. The site is exported as a folder bundle. You can:
   - Open index.html directly in a browser for preview
   - Upload the entire folder to any static hosting provider
   - Deploy to services like Netlify, Vercel, or GitHub Pages

3. To deploy on a web server:
   - Upload all files maintaining the directory structure
   - Point your domain's root to the directory containing index.html
   - Ensure your server serves index.html as the default document

4. Contact forms:
   - Forms are wired for zero-backend email handoff using mailto
   - Update assets/curb-site-config.js to set the final recipient email
   - If a visitor's mail app does not open, the site shows a copy-to-clipboard fallback

5. To customize:
   - Edit index.html with any text editor or code editor
   - Replace images in the assets/photos/ directory as needed
   - Update contact information, hours, and other business details
   - Review assets/curb-site-package.json if this site was marked for an owner CMS or store pack

${capabilitySection}## Directory Structure

  index.html          - Entry page for the site
  assets/             - Local business assets when available
  ...                 - Additional mirrored or generated pages

## Support

For questions or custom modifications, contact your web designer.
`;
}

export async function exportSite(slug: string): Promise<Buffer> {
  initializeDatabase();
  const db = getDb();

  const siteDir = path.join(SITES_DIR, slug);

  if (!fs.existsSync(siteDir)) {
    throw new Error(
      `Site directory not found for slug "${slug}" at ${siteDir}`
    );
  }

  const indexPath = path.join(siteDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `index.html not found for slug "${slug}" at ${indexPath}`
    );
  }

  // Create zip buffer
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", (err: Error) => reject(err));

    // Add all files from the site directory
    archive.directory(siteDir, slug);

    // Add README.txt
    archive.append(buildReadmeContent(siteDir), {
      name: `${slug}/README.txt`,
    });

    archive.finalize();
  });

  // Mark the generated site as exported
  const site = db
    .prepare(
      "SELECT id FROM generated_sites WHERE slug = ? ORDER BY version DESC LIMIT 1"
    )
    .get(slug) as { id: number } | undefined;

  if (site) {
    db.prepare(
      "UPDATE generated_sites SET exported = 1 WHERE id = ?"
    ).run(site.id);
  }

  return buffer;
}
