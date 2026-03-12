function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": text(origin) || "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(data, init) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function normalizeFields(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      var key = text(entry.key).slice(0, 120);
      var fieldValue = text(entry.value).slice(0, 5000);
      if (!key || !fieldValue) {
        return null;
      }

      return { key, value: fieldValue };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function normalizeSubmission(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    businessName: text(value.businessName),
    fields: normalizeFields(value.fields),
    formName: text(value.formName).slice(0, 160),
    origin: text(value.origin).slice(0, 300),
    pageUrl: text(value.pageUrl).slice(0, 500),
    recipientEmail: text(value.recipientEmail).toLowerCase(),
    siteSlug: text(value.siteSlug),
    siteToken: text(value.siteToken),
    submittedAt: text(value.submittedAt).slice(0, 120),
    turnstileToken: text(value.turnstileToken),
  };
}

function decodeBase64Url(value) {
  var normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  var padLength = (4 - (normalized.length % 4)) % 4;
  if (padLength) {
    normalized += "=".repeat(padLength);
  }
  return atob(normalized);
}

async function hmacSignature(secret, payload) {
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  var signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  var bytes = new Uint8Array(signature);
  var binary = "";
  bytes.forEach(function (byte) {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifySiteToken(siteToken, secret) {
  if (!siteToken || !secret) {
    return null;
  }

  var separatorIndex = siteToken.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  var payload = siteToken.slice(0, separatorIndex);
  var signature = siteToken.slice(separatorIndex + 1);
  if ((await hmacSignature(secret, payload)) !== signature) {
    return null;
  }

  try {
    var parsed = JSON.parse(decodeBase64Url(payload));
    if (
      parsed.version !== 1 ||
      !text(parsed.siteSlug) ||
      !text(parsed.recipientEmail) ||
      !text(parsed.businessName)
    ) {
      return null;
    }

    return {
      businessName: text(parsed.businessName),
      recipientEmail: text(parsed.recipientEmail).toLowerCase(),
      siteSlug: text(parsed.siteSlug),
    };
  } catch {
    return null;
  }
}

async function verifyTurnstile(token, request, env) {
  if (!text(env.TURNSTILE_SECRET_KEY)) {
    return;
  }

  if (!token) {
    throw new Error("Complete the Cloudflare Turnstile challenge.");
  }

  var body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  var ip =
    text(request.headers.get("cf-connecting-ip")) ||
    text(request.headers.get("x-forwarded-for")).split(",")[0];
  if (ip) {
    body.set("remoteip", ip);
  }

  var response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body,
    }
  );
  var payload = await response.json().catch(function () {
    return null;
  });

  if (!response.ok || !payload || payload.success !== true) {
    var message =
      Array.isArray(payload && payload["error-codes"])
        ? payload["error-codes"].join(", ")
        : "Cloudflare Turnstile rejected the submission.";
    throw new Error(message);
  }
}

function findReplyTo(fields) {
  var emailField =
    fields.find(function (field) {
      return /email/i.test(field.key);
    }) ||
    fields.find(function (field) {
      return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(field.value);
    }) ||
    null;

  if (!emailField) {
    return null;
  }

  var value = text(emailField.value).toLowerCase();
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value) ? value : null;
}

function buildEmailText(claims, submission) {
  var lines = [
    "Business: " + claims.businessName,
    "Site slug: " + claims.siteSlug,
  ];

  if (submission.formName) {
    lines.push("Form: " + submission.formName);
  }
  if (submission.pageUrl) {
    lines.push("Page: " + submission.pageUrl);
  }
  if (submission.origin) {
    lines.push("Origin: " + submission.origin);
  }
  if (submission.submittedAt) {
    lines.push("Submitted: " + submission.submittedAt);
  }

  lines.push("", "Fields:");
  submission.fields.forEach(function (field) {
    lines.push(field.key + ": " + field.value);
  });

  return lines.join("\\n") + "\\n";
}

async function sendWithResend(claims, submission, env) {
  if (!text(env.RESEND_API_KEY) || !text(env.RESEND_FROM_EMAIL)) {
    throw new Error("Configure Resend before using the form worker.");
  }

  var response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [claims.recipientEmail],
      reply_to: findReplyTo(submission.fields) || undefined,
      subject: "New website lead for " + claims.businessName,
      text: buildEmailText(claims, submission),
    }),
  });
  var payload = await response.json().catch(function () {
    return null;
  });

  if (!response.ok) {
    throw new Error(
      text(payload && payload.message) ||
        text(payload && payload.error) ||
        "Resend rejected the submission."
    );
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request.headers.get("origin")),
      });
    }

    if (request.method !== "POST") {
      return json(
        { ok: false, error: "Method not allowed." },
        {
          status: 405,
          headers: corsHeaders(request.headers.get("origin")),
        }
      );
    }

    try {
      var submission = normalizeSubmission(await request.json());
      if (
        !submission ||
        !submission.siteSlug ||
        !submission.siteToken ||
        !submission.recipientEmail ||
        !submission.businessName
      ) {
        throw new Error("The submitted form payload is invalid.");
      }

      var claims = await verifySiteToken(
        submission.siteToken,
        text(env.CURB_FORM_SIGNING_SECRET)
      );
      if (!claims) {
        throw new Error("The site form token is invalid.");
      }

      if (
        claims.siteSlug !== submission.siteSlug ||
        claims.recipientEmail !== submission.recipientEmail ||
        claims.businessName !== submission.businessName
      ) {
        throw new Error("The submitted form payload does not match the site token.");
      }

      if (submission.fields.length === 0) {
        throw new Error("The form submission did not include any fields.");
      }

      await verifyTurnstile(submission.turnstileToken, request, env);
      await sendWithResend(claims, submission, env);

      return json(
        {
          ok: true,
          message: "Your message has been sent.",
        },
        {
          headers: corsHeaders(request.headers.get("origin")),
        }
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Unable to send your message right now.",
        },
        {
          status: 400,
          headers: corsHeaders(request.headers.get("origin")),
        }
      );
    }
  },
};

