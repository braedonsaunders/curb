import { NextRequest, NextResponse } from "next/server";
import { fetchPlacePhotoAsset } from "@/lib/places";

export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get("reference");
    const placeId = request.nextUrl.searchParams.get("placeId");
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

    const asset = await fetchPlacePhotoAsset(reference, {
      maxWidth: maxWidthParam,
      placeId,
    });

    return new NextResponse(asset.buffer, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": asset.cacheControl,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load place photo";
    const status = message.includes("API key is not set")
      ? 422
      : message.includes("status 403")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
