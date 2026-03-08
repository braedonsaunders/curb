import { getConfig } from "./config";
import fs from "fs";
import path from "path";

const GEOCODING_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_SEARCH_BASE =
  "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const PLACE_DETAILS_BASE =
  "https://maps.googleapis.com/maps/api/place/details/json";
const PLACE_PHOTO_BASE = "https://maps.googleapis.com/maps/api/place/photo";

const SITES_DIR = path.resolve(process.cwd(), "..", "sites");

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface DiscoveredBusiness {
  place_id: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  review_count: number | null;
  hours_json: string | null;
  photos_json: string | null;
}

export interface DiscoveryResult {
  businesses: DiscoveredBusiness[];
  location: GeoLocation;
  totalFound: number;
}

export interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address: string | null;
  formatted_phone_number: string | null;
  website: string | null;
  url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  types: string[];
  address_components: AddressComponent[];
  geometry: { location: GeoLocation };
  opening_hours: { weekday_text?: string[] } | null;
  photos: PlacePhoto[];
}

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface PlacePhoto {
  photo_reference: string;
  height: number;
  width: number;
}

function getApiKey(): string {
  const key = getConfig().googlePlacesApiKey;
  if (!key) {
    throw new Error(
      "Google Places API key is not set. Please configure it in Settings."
    );
  }
  return key;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocode(address: string): Promise<GeoLocation> {
  const apiKey = getApiKey();
  const url = `${GEOCODING_BASE}?address=${encodeURIComponent(address)}&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding API returned status ${response.status}`);
  }

  const data = await response.json();
  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(
      `Geocoding failed for "${address}": ${data.status} - ${data.error_message ?? "no results"}`
    );
  }

  return data.results[0].geometry.location;
}

function mapNearbyResultToBusiness(
  place: Record<string, unknown>
): DiscoveredBusiness {
  const geometry = place.geometry as
    | { location: GeoLocation }
    | undefined;
  const photos = place.photos as PlacePhoto[] | undefined;
  const types = place.types as string[] | undefined;

  return {
    place_id: place.place_id as string,
    name: place.name as string,
    category: types?.[0] ?? null,
    address: (place.vicinity as string) ?? null,
    city: null,
    province: null,
    postal_code: null,
    phone: null,
    website_url: null,
    google_maps_url: null,
    latitude: geometry?.location.lat ?? 0,
    longitude: geometry?.location.lng ?? 0,
    rating: (place.rating as number) ?? null,
    review_count: (place.user_ratings_total as number) ?? null,
    hours_json: null,
    photos_json: photos
      ? JSON.stringify(photos.map((p) => p.photo_reference))
      : null,
  };
}

export async function discoverBusinesses(
  location: string,
  radiusKm: number,
  categories: string[]
): Promise<DiscoveryResult> {
  const apiKey = getApiKey();
  const geo = await geocode(location);
  const radiusMeters = radiusKm * 1000;

  const allBusinesses: DiscoveredBusiness[] = [];
  const seenPlaceIds = new Set<string>();

  for (const category of categories) {
    let nextPageToken: string | undefined;
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        location: `${geo.lat},${geo.lng}`,
        radius: radiusMeters.toString(),
        type: category,
        key: apiKey,
      });

      if (nextPageToken) {
        params.set("pagetoken", nextPageToken);
      }

      const url = `${NEARBY_SEARCH_BASE}?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Nearby Search API returned status ${response.status}`
        );
      }

      const data = await response.json();

      if (data.status === "ZERO_RESULTS") {
        break;
      }

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw new Error(
          `Nearby Search failed: ${data.status} - ${data.error_message ?? "unknown error"}`
        );
      }

      const results = data.results as Record<string, unknown>[];
      for (const place of results) {
        const placeId = place.place_id as string;
        if (!seenPlaceIds.has(placeId)) {
          seenPlaceIds.add(placeId);
          allBusinesses.push(mapNearbyResultToBusiness(place));
        }
      }

      nextPageToken = data.next_page_token as string | undefined;
      pageCount++;

      // Google requires a short delay before using next_page_token
      if (nextPageToken && pageCount < 3) {
        await delay(2000);
      }
    } while (nextPageToken && pageCount < 3);
  }

  return {
    businesses: allBusinesses,
    location: geo,
    totalFound: allBusinesses.length,
  };
}

export async function getPlaceDetails(
  placeId: string
): Promise<PlaceDetails> {
  const apiKey = getApiKey();
  const fields = [
    "place_id",
    "name",
    "formatted_address",
    "formatted_phone_number",
    "website",
    "url",
    "rating",
    "user_ratings_total",
    "types",
    "address_component",
    "geometry",
    "opening_hours",
    "photos",
  ].join(",");

  const url = `${PLACE_DETAILS_BASE}?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Place Details API returned status ${response.status}`
    );
  }

  const data = await response.json();
  if (data.status !== "OK") {
    throw new Error(
      `Place Details failed for ${placeId}: ${data.status} - ${data.error_message ?? "unknown error"}`
    );
  }

  const result = data.result;

  return {
    place_id: result.place_id,
    name: result.name,
    formatted_address: result.formatted_address ?? null,
    formatted_phone_number: result.formatted_phone_number ?? null,
    website: result.website ?? null,
    url: result.url ?? null,
    rating: result.rating ?? null,
    user_ratings_total: result.user_ratings_total ?? null,
    types: result.types ?? [],
    address_components: result.address_components ?? [],
    geometry: result.geometry,
    opening_hours: result.opening_hours ?? null,
    photos: result.photos ?? [],
  };
}

export async function downloadPlacePhoto(
  photoReference: string,
  slug: string,
  siteDir?: string
): Promise<string> {
  const apiKey = getApiKey();
  const targetSiteDir = siteDir ?? path.join(SITES_DIR, slug);
  const photoDir = path.join(targetSiteDir, "assets", "photos");

  fs.mkdirSync(photoDir, { recursive: true });

  const url = `${PLACE_PHOTO_BASE}?maxwidth=800&photo_reference=${encodeURIComponent(photoReference)}&key=${apiKey}`;
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Photo download failed with status ${response.status}`);
  }

  const contentType =
    response.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(photoDir, filename);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return `assets/photos/${filename}`;
}
