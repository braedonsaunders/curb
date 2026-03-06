import { getDb } from "../db";
import { initializeDatabase } from "../schema";
import { getConfig } from "../config";
import { generateEmail, type BusinessData } from "../claude";

export interface EmailResult {
  emailId: number;
  businessId: number;
  businessName: string;
  subject: string;
  toAddress: string | null;
  status: string;
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

export async function generateOutreachEmail(
  businessId: number
): Promise<EmailResult> {
  initializeDatabase();
  const db = getDb();
  const config = getConfig();

  const business = db
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(businessId) as Record<string, unknown> | undefined;

  if (!business) {
    throw new Error(`Business with id ${businessId} not found.`);
  }

  const slug = business.slug as string;
  const name = business.name as string;
  const toAddress = (business.email as string) ?? null;

  // Build preview URL
  const previewUrl = `${config.siteBaseUrl}/${slug}`;

  // Generate email via Claude
  const businessData = businessRowToData(business);
  const emailContent = await generateEmail(
    businessData,
    previewUrl,
    config
  );

  // Insert into emails table
  const result = db
    .prepare(
      `INSERT INTO emails (business_id, subject, body, to_address, status)
       VALUES (?, ?, ?, ?, 'draft')`
    )
    .run(
      businessId,
      emailContent.subject,
      emailContent.body,
      toAddress
    );

  return {
    emailId: Number(result.lastInsertRowid),
    businessId,
    businessName: name,
    subject: emailContent.subject,
    toAddress,
    status: "draft",
  };
}

export async function updateEmailStatus(
  emailId: number,
  status: string
): Promise<void> {
  initializeDatabase();
  const db = getDb();

  const validStatuses = [
    "draft",
    "approved",
    "sent",
    "bounced",
  ];
  if (!validStatuses.includes(status)) {
    throw new Error(
      `Invalid email status "${status}". Must be one of: ${validStatuses.join(", ")}`
    );
  }

  const email = db
    .prepare("SELECT id FROM emails WHERE id = ?")
    .get(emailId) as { id: number } | undefined;

  if (!email) {
    throw new Error(`Email with id ${emailId} not found.`);
  }

  if (status === "sent") {
    db.prepare(
      "UPDATE emails SET status = ?, sent_at = datetime('now') WHERE id = ?"
    ).run(status, emailId);
  } else {
    db.prepare("UPDATE emails SET status = ? WHERE id = ?").run(
      status,
      emailId
    );
  }
}
