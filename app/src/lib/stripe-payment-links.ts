import crypto from "crypto";

import { type Config, getConfig } from "./config";
import { buildPublicPurchasePath, type SaleRecord } from "./sales";

type StripeCheckoutSession = {
  id: string;
  customer: string | null;
  customer_details?: {
    email?: string | null;
    name?: string | null;
  } | null;
  payment_link: string | null;
  payment_status?: string | null;
  status?: string | null;
  subscription: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function getStripeSecretKey(config: Config): string {
  const secretKey = text(config.stripeSecretKey);
  if (!secretKey) {
    throw new Error("Add a Stripe secret key in Settings before creating payment links.");
  }

  return secretKey;
}

function getStripeWebhookSecret(config: Config): string {
  const secret = text(config.stripeWebhookSecret);
  if (!secret) {
    throw new Error("Add a Stripe webhook signing secret in Settings before enabling Stripe webhooks.");
  }

  return secret;
}

function getAppBaseUrl(config: Config, requestOrigin?: string | null): string {
  const configured = text(config.appBaseUrl);
  const fallback = text(requestOrigin);
  const candidate = configured || fallback || "http://localhost:3000";

  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    throw new Error("Add a valid public app base URL in Settings before creating payment links.");
  }
}

async function stripeApiRequest<T>(
  pathname: string,
  init: RequestInit,
  config: Config
): Promise<T> {
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey(config)}`,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      payload.error &&
      "message" in payload.error
        ? text(payload.error.message)
        : "";
    throw new Error(message || `Stripe API request failed for ${pathname}.`);
  }

  return payload as T;
}

function appendLineItem(
  body: URLSearchParams,
  index: number,
  input: {
    currency: string;
    description?: string;
    name: string;
    quantity?: number;
    recurringInterval?: "month";
    unitAmountCents: number;
  }
): void {
  body.set(`line_items[${index}][quantity]`, String(input.quantity ?? 1));
  body.set(`line_items[${index}][price_data][currency]`, input.currency);
  body.set(
    `line_items[${index}][price_data][unit_amount]`,
    String(input.unitAmountCents)
  );
  body.set(
    `line_items[${index}][price_data][product_data][name]`,
    input.name
  );

  if (input.description) {
    body.set(
      `line_items[${index}][price_data][product_data][description]`,
      input.description
    );
  }

  if (input.recurringInterval) {
    body.set(
      `line_items[${index}][price_data][recurring][interval]`,
      input.recurringInterval
    );
  }
}

export async function createStripePaymentLink(
  sale: SaleRecord,
  business: {
    id: number;
    email: string | null;
    name: string;
  },
  options?: {
    config?: Config;
    requestOrigin?: string | null;
  }
): Promise<{ id: string; url: string }> {
  const config = options?.config ?? getConfig();
  const body = new URLSearchParams();
  const appBaseUrl = getAppBaseUrl(config, options?.requestOrigin);
  const redirectUrl = new URL(buildPublicPurchasePath(sale.publicToken), appBaseUrl);
  redirectUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  body.set("after_completion[type]", "redirect");
  body.set("after_completion[redirect][url]", redirectUrl.toString());
  body.set("allow_promotion_codes", "true");
  body.set("metadata[businessId]", String(business.id));
  body.set("metadata[saleId]", String(sale.id));
  body.set("metadata[saleMode]", sale.mode);

  if (sale.customerEmail || business.email) {
    body.set("customer_email", sale.customerEmail || text(business.email));
  }

  const recurringDescription =
    sale.mode === "managed"
      ? `Managed monthly hosting for ${business.name}`
      : "";
  const setupDescription =
    sale.mode === "managed"
      ? `Initial build and launch fee for ${business.name}`
      : `One-time ZIP handoff for ${business.name}`;

  let lineItemIndex = 0;

  if (sale.monthlyAmountCents > 0) {
    appendLineItem(body, lineItemIndex, {
      currency: sale.currency,
      description: recurringDescription,
      name: `${business.name} website hosting`,
      recurringInterval: "month",
      unitAmountCents: sale.monthlyAmountCents,
    });
    lineItemIndex += 1;
  }

  if (sale.oneTimeAmountCents > 0) {
    appendLineItem(body, lineItemIndex, {
      currency: sale.currency,
      description: setupDescription,
      name:
        sale.mode === "managed"
          ? `${business.name} website build`
          : `${business.name} website files`,
      unitAmountCents: sale.oneTimeAmountCents,
    });
  }

  const created = await stripeApiRequest<{ id?: string; url?: string }>(
    "/v1/payment_links",
    {
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    config
  );

  const id = text(created.id);
  const url = text(created.url);
  if (!id || !url) {
    throw new Error("Stripe did not return a usable payment link.");
  }

  return { id, url };
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  config = getConfig()
): boolean {
  const header = text(signatureHeader);
  if (!header) {
    return false;
  }

  const secret = getStripeWebhookSecret(config);
  const segments = header.split(",").map((segment) => segment.trim());
  const timestamp = segments.find((segment) => segment.startsWith("t="))?.slice(2);
  const signatures = segments
    .filter((segment) => segment.startsWith("v1="))
    .map((segment) => segment.slice(3))
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex")
      );
    } catch {
      return false;
    }
  });
}

export async function retrieveStripeCheckoutSession(
  sessionId: string,
  config = getConfig()
): Promise<StripeCheckoutSession> {
  const session = await stripeApiRequest<StripeCheckoutSession>(
    `/v1/checkout/sessions/${encodeURIComponent(text(sessionId))}`,
    { method: "GET" },
    config
  );

  if (!text(session.id)) {
    throw new Error("Stripe returned an invalid checkout session payload.");
  }

  return {
    id: text(session.id),
    customer: text(session.customer) || null,
    customer_details: session.customer_details ?? null,
    payment_link: text(session.payment_link) || null,
    payment_status: text(session.payment_status) || null,
    status: text(session.status) || null,
    subscription: text(session.subscription) || null,
  };
}

export function parseStripeWebhookEvent(
  rawBody: string
): { type: string; data: { object: Record<string, unknown> } } {
  const parsed = JSON.parse(rawBody) as {
    data?: { object?: Record<string, unknown> };
    type?: unknown;
  };

  return {
    type: text(parsed.type),
    data: {
      object:
        parsed.data && typeof parsed.data.object === "object" && parsed.data.object
          ? parsed.data.object
          : {},
    },
  };
}

