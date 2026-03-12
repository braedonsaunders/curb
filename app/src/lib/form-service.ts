import type { NextRequest } from "next/server";

import { getConfig, type Config } from "@/lib/config";
import {
  buildSharedFormEmailSubject,
  buildSharedFormEmailText,
  findReplyToEmail,
  normalizeSharedFormSubmission,
  verifySharedFormSiteToken,
  type SharedFormSubmission,
} from "@/lib/shared-form-delivery";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildFormCorsHeaders(origin?: string | null): Record<string, string> {
  return {
    "access-control-allow-origin": origin && origin.trim() ? origin : "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
  config: Config
): Promise<void> {
  const secret = text(config.turnstileSecretKey);
  if (!secret) {
    return;
  }

  if (!token) {
    throw new Error("Complete the Cloudflare Turnstile challenge.");
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body,
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; "error-codes"?: string[] }
    | null;

  if (!response.ok || !payload?.success) {
    const message =
      payload?.["error-codes"]?.join(", ") ||
      "Cloudflare Turnstile rejected the submission.";
    throw new Error(message);
  }
}

async function sendWithResend(
  submission: SharedFormSubmission,
  config: Config
): Promise<void> {
  const apiKey = text(config.resendApiKey);
  const fromEmail = text(config.resendFromEmail);

  if (!apiKey || !fromEmail) {
    throw new Error("Configure Resend before using the shared form service.");
  }

  const claims = verifySharedFormSiteToken(
    submission.siteToken,
    text(config.sharedFormSigningSecret)
  );

  if (!claims) {
    throw new Error("The site form token is invalid.");
  }

  if (
    claims.siteSlug !== submission.siteSlug ||
    claims.recipientEmail !== submission.recipientEmail.toLowerCase() ||
    claims.businessName !== submission.businessName
  ) {
    throw new Error("The submitted form payload does not match the site token.");
  }

  if (submission.fields.length === 0) {
    throw new Error("The form submission did not include any fields.");
  }

  const fromDisplayName = claims.businessName
    ? `${claims.businessName.replace(/[<>"]/g, "").trim()} via Curb`
    : "Curb Leads";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromDisplayName} <${fromEmail}>`,
      to: [claims.recipientEmail],
      reply_to: findReplyToEmail(submission.fields) ?? undefined,
      subject: buildSharedFormEmailSubject(claims),
      text: buildSharedFormEmailText(claims, submission),
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    throw new Error(
      text(payload?.message) || text(payload?.error) || "Resend rejected the email."
    );
  }
}

export async function submitSharedFormRequest(
  request: NextRequest,
  config = getConfig()
): Promise<void> {
  const submission = normalizeSharedFormSubmission(await request.json());
  if (!submission) {
    throw new Error("The submitted form payload is invalid.");
  }

  const signingSecret = text(config.sharedFormSigningSecret);
  if (!signingSecret) {
    throw new Error("Configure the shared form signing secret before launch.");
  }

  const remoteIp =
    text(request.headers.get("cf-connecting-ip")) ||
    text(request.headers.get("x-forwarded-for")).split(",")[0] ||
    null;

  await verifyTurnstileToken(submission.turnstileToken, remoteIp, config);
  await sendWithResend(submission, config);
}
