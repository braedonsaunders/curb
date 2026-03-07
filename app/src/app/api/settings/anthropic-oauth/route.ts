import { NextResponse } from "next/server";
import {
  clearAnthropicOAuthConfigUpdates,
  getAnthropicOAuthStatus,
} from "@/lib/anthropic-oauth";
import { getConfig, updateConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getAnthropicOAuthStatus(getConfig()));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load Anthropic OAuth status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const updated = updateConfig(clearAnthropicOAuthConfigUpdates("apiKey"));

    return NextResponse.json({
      ok: true,
      status: getAnthropicOAuthStatus(updated),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to disconnect Anthropic OAuth.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
