import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

const PLACE_PHOTO_BASE = "https://maps.googleapis.com/maps/api/place/photo";

export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get("reference");
    const maxWidthParam = parseInt(
      request.nextUrl.searchParams.get("maxWidth") || "800",
      10
    );

    if (!reference) {
      return NextResponse.json(
        { error: "reference is required" },
        { status: 400 }
      );
    }

    const config = getConfig();
    if (!config.googlePlacesApiKey) {
      return NextResponse.json(
        { error: "Google Places API key is not configured." },
        { status: 422 }
      );
    }

    const maxWidth = Number.isFinite(maxWidthParam)
      ? Math.min(1600, Math.max(200, maxWidthParam))
      : 800;
    const url =
      `${PLACE_PHOTO_BASE}?maxwidth=${maxWidth}` +
      `&photo_reference=${encodeURIComponent(reference)}` +
      `&key=${config.googlePlacesApiKey}`;

    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Photo request failed with status ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const cacheControl =
      response.headers.get("cache-control") ?? "public, max-age=86400";
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load place photo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
