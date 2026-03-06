export interface Config {
  googlePlacesApiKey: string;
  googlePageSpeedApiKey: string;
  anthropicApiKey: string;
  defaultLocation: string;
  defaultRadiusKm: number;
  ownerName: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  siteBaseUrl: string;
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;

  cached = {
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
    googlePageSpeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    defaultLocation: process.env.CURB_DEFAULT_LOCATION ?? "Hamilton, ON",
    defaultRadiusKm: parseInt(process.env.CURB_DEFAULT_RADIUS_KM ?? "15", 10),
    ownerName: process.env.CURB_OWNER_NAME ?? "",
    businessName: process.env.CURB_BUSINESS_NAME ?? "",
    businessAddress: process.env.CURB_BUSINESS_ADDRESS ?? "",
    businessEmail: process.env.CURB_BUSINESS_EMAIL ?? "",
    siteBaseUrl: process.env.CURB_SITE_BASE_URL ?? "http://localhost:3000/sites",
  };

  return cached;
}

export function clearConfigCache(): void {
  cached = null;
}
