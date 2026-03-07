import { NextResponse } from "next/server";
import { clearOpenAIOAuthConfigUpdates, getOpenAIOAuthStatus } from "@/lib/openai-oauth";
import { getConfig, updateConfig } from "@/lib/config";
import {
  cancelOpenAIOAuthFlow,
  getOpenAIOAuthFlowState,
} from "@/lib/openai-oauth-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      status: getOpenAIOAuthStatus(getConfig()),
      flow: getOpenAIOAuthFlowState(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load OpenAI OAuth status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    cancelOpenAIOAuthFlow();
    const updated = updateConfig(clearOpenAIOAuthConfigUpdates("apiKey"));

    return NextResponse.json({
      ok: true,
      status: getOpenAIOAuthStatus(updated),
      flow: getOpenAIOAuthFlowState(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to disconnect OpenAI OAuth.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
