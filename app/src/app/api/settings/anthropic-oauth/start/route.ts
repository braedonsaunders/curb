import { NextResponse } from "next/server";
import {
  buildAnthropicAuthorizeUrl,
  createPkcePair,
} from "@/lib/anthropic-oauth";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { verifier, challenge } = createPkcePair();

    return NextResponse.json({
      url: buildAnthropicAuthorizeUrl(challenge, verifier),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start OAuth flow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
