import crypto from "crypto";

import type { Config } from "@/lib/config";

export type SharedFormTokenClaims = {
  businessName: string;
  recipientEmail: string;
  siteSlug: string;
};

export type SharedFormSubmissionField = {
  key: string;
  value: string;
};

export type SharedFormSubmission = {
  businessName: string;
  formName: string;
  origin: string;
  pageUrl: string;
  recipientEmail: string;
  siteSlug: string;
  siteToken: string;
  submittedAt: string;
  turnstileToken: string;
  fields: SharedFormSubmissionField[];
};

type ParsedSharedFormToken = SharedFormTokenClaims & {
  version: 1;
};

const SHARED_FORM_TOKEN_VERSION = 1;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeClaims(
  claims: SharedFormTokenClaims
): SharedFormTokenClaims {
  return {
    businessName: text(claims.businessName),
    recipientEmail: text(claims.recipientEmail).toLowerCase(),
    siteSlug: text(claims.siteSlug),
  };
}

function encodeTokenPayload(payload: ParsedSharedFormToken): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeTokenPayload(payload: string): ParsedSharedFormToken | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as ParsedSharedFormToken;

    if (
      parsed?.version !== SHARED_FORM_TOKEN_VERSION ||
      !text(parsed.siteSlug) ||
      !text(parsed.recipientEmail) ||
      !text(parsed.businessName)
    ) {
      return null;
    }

    return {
      version: SHARED_FORM_TOKEN_VERSION,
      businessName: text(parsed.businessName),
      recipientEmail: text(parsed.recipientEmail).toLowerCase(),
      siteSlug: text(parsed.siteSlug),
    };
  } catch {
    return null;
  }
}

function buildTokenSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function buildSharedFormSiteToken(
  claims: SharedFormTokenClaims,
  secret: string
): string {
  const normalizedClaims = normalizeClaims(claims);
  const payload = encodeTokenPayload({
    version: SHARED_FORM_TOKEN_VERSION,
    ...normalizedClaims,
  });

  return `${payload}.${buildTokenSignature(payload, secret)}`;
}

export function buildSharedFormSiteTokenFromConfig(
  claims: SharedFormTokenClaims,
  config: Config
): string {
  const secret = text(config.sharedFormSigningSecret);
  if (!secret) {
    return "";
  }

  return buildSharedFormSiteToken(claims, secret);
}

export function verifySharedFormSiteToken(
  token: string,
  secret: string
): SharedFormTokenClaims | null {
  const normalizedToken = text(token);
  const normalizedSecret = text(secret);

  if (!normalizedToken || !normalizedSecret) {
    return null;
  }

  const separatorIndex = normalizedToken.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const payload = normalizedToken.slice(0, separatorIndex);
  const providedSignature = normalizedToken.slice(separatorIndex + 1);
  const expectedSignature = buildTokenSignature(payload, normalizedSecret);

  if (
    !providedSignature ||
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature)
    )
  ) {
    return null;
  }

  const parsed = decodeTokenPayload(payload);
  if (!parsed) {
    return null;
  }

  return {
    businessName: parsed.businessName,
    recipientEmail: parsed.recipientEmail,
    siteSlug: parsed.siteSlug,
  };
}

export function normalizeSharedFormFields(
  value: unknown
): SharedFormSubmissionField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const source = entry as Record<string, unknown>;
      const key = text(source.key).slice(0, 120);
      const fieldValue = text(source.value).slice(0, 5000);

      if (!key || !fieldValue) {
        return null;
      }

      return { key, value: fieldValue };
    })
    .filter((entry): entry is SharedFormSubmissionField => entry !== null)
    .slice(0, 40);
}

export function normalizeSharedFormSubmission(
  value: unknown
): SharedFormSubmission | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const fields = normalizeSharedFormFields(source.fields);
  const siteToken = text(source.siteToken);
  const recipientEmail = text(source.recipientEmail).toLowerCase();
  const siteSlug = text(source.siteSlug);
  const businessName = text(source.businessName);

  if (!siteToken || !recipientEmail || !siteSlug || !businessName) {
    return null;
  }

  return {
    businessName,
    fields,
    formName: text(source.formName).slice(0, 160),
    origin: text(source.origin).slice(0, 300),
    pageUrl: text(source.pageUrl).slice(0, 500),
    recipientEmail,
    siteSlug,
    siteToken,
    submittedAt: text(source.submittedAt).slice(0, 120),
    turnstileToken: text(source.turnstileToken),
  };
}

export function buildSharedFormEmailSubject(
  claims: SharedFormTokenClaims
): string {
  return `New website lead for ${text(claims.businessName) || text(claims.siteSlug)}`;
}

export function buildSharedFormEmailText(
  claims: SharedFormTokenClaims,
  submission: SharedFormSubmission
): string {
  const lines = [
    `Business: ${claims.businessName}`,
    `Site slug: ${claims.siteSlug}`,
  ];

  if (submission.formName) {
    lines.push(`Form: ${submission.formName}`);
  }

  if (submission.pageUrl) {
    lines.push(`Page: ${submission.pageUrl}`);
  }

  if (submission.origin) {
    lines.push(`Origin: ${submission.origin}`);
  }

  if (submission.submittedAt) {
    lines.push(`Submitted: ${submission.submittedAt}`);
  }

  lines.push("", "Fields:");

  for (const field of submission.fields) {
    lines.push(`${field.key}: ${field.value}`);
  }

  return `${lines.join("\n")}\n`;
}

export function findReplyToEmail(
  fields: SharedFormSubmissionField[]
): string | null {
  const emailField =
    fields.find((field) => /email/i.test(field.key)) ??
    fields.find((field) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)
    ) ??
    null;

  if (!emailField) {
    return null;
  }

  const value = text(emailField.value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

