import { NextRequest, NextResponse } from "next/server";
import {
  buildAnthropicOAuthConfigUpdates,
  exchangeAnthropicCode,
  getAnthropicOAuthStatus,
  parseAnthropicCodePaste,
} from "@/lib/anthropic-oauth";
import { getConfig, updateConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { code?: unknown }
      | null;
    const rawCode = String(body?.code ?? "").trim();

    if (!rawCode) {
      return NextResponse.json(
        { error: "Authorization code is required." },
        { status: 400 }
      );
    }

    const { code, verifier } = parseAnthropicCodePaste(rawCode);
    const existing = getConfig();
    const tokens = await exchangeAnthropicCode(code, verifier, verifier);
    const updated = updateConfig(
      buildAnthropicOAuthConfigUpdates(tokens, {
        refreshToken: existing.anthropicOAuthRefreshToken,
        expiresAtMs: existing.anthropicOAuthExpiresAtMs,
        authMode: "oauth",
      })
    );

    return NextResponse.json({
      ok: true,
      status: getAnthropicOAuthStatus(updated),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to exchange OAuth code.";
    const status = message.startsWith("Invalid code format") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
