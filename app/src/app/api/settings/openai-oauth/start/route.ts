import { NextResponse } from "next/server";
import { startOpenAIOAuthFlow } from "@/lib/openai-oauth-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const url = await startOpenAIOAuthFlow();
    return NextResponse.json({ url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start OpenAI OAuth flow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
