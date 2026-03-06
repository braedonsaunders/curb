import Anthropic from "@anthropic-ai/sdk";
import { getConfig, type Config } from "./config";
import fs from "fs";
import path from "path";

const MODEL = "claude-sonnet-4-20250514";
const PROMPTS_DIR = path.resolve(process.cwd(), "..", "prompts");

export interface BusinessData {
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  rating: number | null;
  review_count: number | null;
  hours_json: string | null;
  photos_json: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
}

function getClient(): Anthropic {
  const config = getConfig();
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Please configure it in your .env file."
    );
  }
  return new Anthropic({ apiKey: config.anthropicApiKey });
}

function loadPromptTemplate(filename: string): string {
  const filePath = path.join(PROMPTS_DIR, filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function injectBusinessData(template: string, data: BusinessData): string {
  let result = template;
  result = result.replace(/\{\{name\}\}/g, data.name ?? "");
  result = result.replace(/\{\{category\}\}/g, data.category ?? "");
  result = result.replace(/\{\{address\}\}/g, data.address ?? "");
  result = result.replace(/\{\{city\}\}/g, data.city ?? "");
  result = result.replace(/\{\{phone\}\}/g, data.phone ?? "");
  result = result.replace(/\{\{email\}\}/g, data.email ?? "");
  result = result.replace(/\{\{website_url\}\}/g, data.website_url ?? "");
  result = result.replace(
    /\{\{rating\}\}/g,
    data.rating?.toString() ?? ""
  );
  result = result.replace(
    /\{\{review_count\}\}/g,
    data.review_count?.toString() ?? ""
  );
  result = result.replace(/\{\{hours_json\}\}/g, data.hours_json ?? "");
  result = result.replace(/\{\{photos_json\}\}/g, data.photos_json ?? "");
  result = result.replace(
    /\{\{google_maps_url\}\}/g,
    data.google_maps_url ?? ""
  );
  result = result.replace(
    /\{\{latitude\}\}/g,
    data.latitude?.toString() ?? ""
  );
  result = result.replace(
    /\{\{longitude\}\}/g,
    data.longitude?.toString() ?? ""
  );
  return result;
}

function buildBusinessContext(data: BusinessData): string {
  const lines: string[] = [
    `Business Name: ${data.name}`,
    `Category: ${data.category ?? "Unknown"}`,
    `Address: ${data.address ?? "N/A"}`,
    `City: ${data.city ?? "N/A"}`,
    `Phone: ${data.phone ?? "N/A"}`,
    `Email: ${data.email ?? "N/A"}`,
    `Website: ${data.website_url ?? "None"}`,
    `Google Rating: ${data.rating ?? "N/A"} (${data.review_count ?? 0} reviews)`,
    `Google Maps: ${data.google_maps_url ?? "N/A"}`,
  ];

  if (data.hours_json) {
    try {
      const hours = JSON.parse(data.hours_json);
      lines.push(`Hours: ${JSON.stringify(hours, null, 2)}`);
    } catch {
      lines.push(`Hours: ${data.hours_json}`);
    }
  }

  return lines.join("\n");
}

function stripCodeFences(text: string): string {
  let result = text.trim();
  if (result.startsWith("```html")) {
    result = result.slice(7);
  } else if (result.startsWith("```json")) {
    result = result.slice(7);
  } else if (result.startsWith("```")) {
    result = result.slice(3);
  }
  if (result.endsWith("```")) {
    result = result.slice(0, -3);
  }
  return result.trim();
}

export async function generateSite(
  businessData: BusinessData
): Promise<string> {
  const client = getClient();
  const promptTemplate = loadPromptTemplate("generate-site.txt");
  const businessContext = buildBusinessContext(businessData);

  let userPrompt: string;
  if (promptTemplate) {
    userPrompt = injectBusinessData(promptTemplate, businessData);
  } else {
    userPrompt = `Generate a complete, modern, mobile-responsive single-page HTML website for the following business.
The HTML should be self-contained with inline CSS and include all sections a small business website needs
(hero, about, services, hours, contact, map embed, footer). Use a professional color scheme appropriate for the business category.
Make it look polished and production-ready.

${businessContext}

Return ONLY the complete HTML document, starting with <!DOCTYPE html> and ending with </html>. No markdown, no explanation.`;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for site generation.");
  }

  return stripCodeFences(textBlock.text);
}

export async function generateEmail(
  businessData: BusinessData,
  previewUrl: string,
  config: Config
): Promise<{ subject: string; body: string }> {
  const client = getClient();
  const promptTemplate = loadPromptTemplate("generate-email.txt");
  const businessContext = buildBusinessContext(businessData);

  let userPrompt: string;
  if (promptTemplate) {
    userPrompt = injectBusinessData(promptTemplate, businessData)
      .replace(/\{\{preview_url\}\}/g, previewUrl)
      .replace(/\{\{owner_name\}\}/g, config.ownerName)
      .replace(/\{\{business_name\}\}/g, config.businessName)
      .replace(/\{\{business_email\}\}/g, config.businessEmail);
  } else {
    userPrompt = `Write a professional cold outreach email to a local business owner. The goal is to show them
a free sample website you've built for their business, and offer your web design services.

Sender Info:
- Name: ${config.ownerName || "Web Designer"}
- Business: ${config.businessName || "Web Design Services"}
- Email: ${config.businessEmail || ""}

Target Business:
${businessContext}

Preview URL: ${previewUrl}

Write a short, friendly, non-pushy email. Include a compelling subject line.
Return your response as JSON with exactly two fields: "subject" and "body".
The body should be plain text (not HTML). No markdown code fences.`;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for email generation.");
  }

  const text = stripCodeFences(textBlock.text);

  try {
    const parsed = JSON.parse(text);
    if (!parsed.subject || !parsed.body) {
      throw new Error("Response missing subject or body fields.");
    }
    return { subject: parsed.subject, body: parsed.body };
  } catch (e) {
    throw new Error(
      `Failed to parse Claude email response as JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function auditWebsite(
  url: string,
  businessName: string
): Promise<{ grade: string; summary: string }> {
  const client = getClient();
  const promptTemplate = loadPromptTemplate("audit-website.txt");

  let userPrompt: string;
  if (promptTemplate) {
    userPrompt = promptTemplate
      .replace(/\{\{url\}\}/g, url)
      .replace(/\{\{business_name\}\}/g, businessName);
  } else {
    userPrompt = `Analyze this website URL for a local business and provide a brief qualitative assessment.

Business: ${businessName}
URL: ${url}

Evaluate the website on these criteria:
- Overall design quality and professionalism
- Mobile responsiveness likelihood
- Loading speed expectations
- SEO basics (would it have good meta tags, headings, etc.)
- Contact information visibility

Provide a letter grade (A, B, C, D, or F) and a 2-3 sentence summary.
Return your response as JSON with exactly two fields: "grade" and "summary".
No markdown code fences.`;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for website audit.");
  }

  const text = stripCodeFences(textBlock.text);

  try {
    const parsed = JSON.parse(text);
    if (!parsed.grade || !parsed.summary) {
      throw new Error("Response missing grade or summary fields.");
    }
    return { grade: parsed.grade, summary: parsed.summary };
  } catch (e) {
    throw new Error(
      `Failed to parse Claude audit response as JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
