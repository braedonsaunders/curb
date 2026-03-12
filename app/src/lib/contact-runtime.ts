export const PORTABLE_CONTACT_RUNTIME = `(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var contactConfig = siteConfig.contact || {};
  var turnstileScriptPromise = null;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function ensureStatus(form) {
    var status = form.querySelector("[data-curb-form-status]");
    if (status) {
      return status;
    }

    status = document.createElement("div");
    status.setAttribute("data-curb-form-status", "true");
    status.style.marginTop = "0.75rem";
    status.style.fontSize = "0.95rem";
    form.appendChild(status);
    return status;
  }

  function setStatus(form, type, message) {
    var status = ensureStatus(form);
    status.textContent = message;
    status.style.color = type === "error" ? "#b42318" : "#166534";
  }

  function serializeForm(form) {
    var formData = new FormData(form);
    var pairs = [];
    formData.forEach(function (value, key) {
      if (typeof value === "string" && value.trim()) {
        pairs.push([key.trim(), value.trim()]);
      }
    });
    return pairs;
  }

  function looksLikeContactForm(form) {
    if (form.getAttribute("data-curb-contact-form") === "true") {
      return true;
    }

    var tokens = [];
    var controls = form.querySelectorAll("input, textarea, select");
    controls.forEach(function (control) {
      ["name", "id", "placeholder", "aria-label"].forEach(function (attribute) {
        var value = control.getAttribute(attribute);
        if (value) {
          tokens.push(value.toLowerCase());
        }
      });
    });

    var haystack = tokens.join(" ");
    return /(name|email|phone|message|quote|service|appointment|booking)/.test(haystack);
  }

  function shouldHandleForm(form) {
    if (!looksLikeContactForm(form)) {
      return false;
    }

    var action = text(form.getAttribute("action"));
    if (!action || action === "#") {
      return true;
    }

    if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(action)) {
      return false;
    }

    return !/^(https?:)?\\/\\//i.test(action);
  }

  function isLocalHost() {
    var hostname = text(window.location.hostname).toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  }

  function resolveEndpointUrl() {
    var configured = text(contactConfig.endpointUrl);
    if (configured) {
      return configured;
    }

    if (isLocalHost()) {
      return window.location.origin.replace(/\\/+$/, "") + "/api/forms/submit";
    }

    return "";
  }

  function ensureTurnstileContainer(form) {
    var existing = form.querySelector("[data-curb-turnstile]");
    if (existing) {
      return existing;
    }

    var container = document.createElement("div");
    container.setAttribute("data-curb-turnstile", "true");
    container.style.marginTop = "1rem";

    var submitter = form.querySelector('[type="submit"]');
    if (submitter && submitter.parentNode) {
      submitter.parentNode.insertBefore(container, submitter);
      return container;
    }

    form.appendChild(container);
    return container;
  }

  function ensureTurnstileScript() {
    var siteKey = text(contactConfig.turnstileSiteKey);
    if (!siteKey) {
      return Promise.resolve(false);
    }

    if (window.turnstile && typeof window.turnstile.render === "function") {
      return Promise.resolve(true);
    }

    if (turnstileScriptPromise) {
      return turnstileScriptPromise;
    }

    turnstileScriptPromise = new Promise(function (resolve, reject) {
      var existingScript = document.querySelector(
        'script[data-curb-turnstile-script="true"]'
      );
      if (existingScript) {
        existingScript.addEventListener("load", function () {
          resolve(true);
        });
        existingScript.addEventListener("error", function () {
          reject(new Error("Cloudflare Turnstile failed to load."));
        });
        return;
      }

      var script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-curb-turnstile-script", "true");
      script.onload = function () {
        resolve(true);
      };
      script.onerror = function () {
        reject(new Error("Cloudflare Turnstile failed to load."));
      };
      document.head.appendChild(script);
    });

    return turnstileScriptPromise;
  }

  function ensureTurnstileWidget(form) {
    var siteKey = text(contactConfig.turnstileSiteKey);
    if (!siteKey) {
      return Promise.resolve(null);
    }

    if (form.dataset.curbTurnstileWidgetId) {
      return Promise.resolve(form.dataset.curbTurnstileWidgetId);
    }

    return ensureTurnstileScript().then(function () {
      if (!window.turnstile || typeof window.turnstile.render !== "function") {
        throw new Error("Cloudflare Turnstile is unavailable.");
      }

      var container = ensureTurnstileContainer(form);
      var widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "auto",
      });
      form.dataset.curbTurnstileWidgetId = String(widgetId);
      return form.dataset.curbTurnstileWidgetId;
    });
  }

  function getTurnstileToken(form) {
    var widgetId = text(form.dataset.curbTurnstileWidgetId);
    if (
      !widgetId ||
      !window.turnstile ||
      typeof window.turnstile.getResponse !== "function"
    ) {
      return "";
    }

    try {
      return text(window.turnstile.getResponse(widgetId));
    } catch (error) {
      void error;
      return "";
    }
  }

  function resetTurnstile(form) {
    var widgetId = text(form.dataset.curbTurnstileWidgetId);
    if (
      !widgetId ||
      !window.turnstile ||
      typeof window.turnstile.reset !== "function"
    ) {
      return;
    }

    try {
      window.turnstile.reset(widgetId);
    } catch (error) {
      void error;
    }
  }

  function buildPayload(form, pairs) {
    return {
      businessName:
        text(siteConfig.businessName) ||
        text(siteConfig.site && siteConfig.site.businessName),
      fields: pairs.map(function (pair) {
        return {
          key: pair[0],
          value: pair[1],
        };
      }),
      formName:
        text(form.getAttribute("data-curb-form-name")) ||
        text(form.getAttribute("name")) ||
        "Website contact form",
      origin: window.location.origin,
      pageUrl: window.location.href,
      recipientEmail: text(contactConfig.recipientEmail),
      siteSlug: text(siteConfig.site && siteConfig.site.slug),
      siteToken: text(contactConfig.siteToken),
      submittedAt: new Date().toISOString(),
      turnstileToken: getTurnstileToken(form),
    };
  }

  function extractErrorMessage(payload, fallback) {
    if (payload && typeof payload === "object") {
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error.trim();
      }

      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message.trim();
      }
    }

    return fallback;
  }

  async function submitForm(form) {
    var recipient = text(contactConfig.recipientEmail);
    if (!recipient) {
      throw new Error(
        "Set contact.recipientEmail in assets/curb-site-config.js before launch."
      );
    }

    var endpointUrl = resolveEndpointUrl();
    if (!endpointUrl) {
      throw new Error(
        "Configure the shared form endpoint before launch."
      );
    }

    var pairs = serializeForm(form);
    if (pairs.length === 0) {
      throw new Error("Add a message before submitting the form.");
    }

    if (text(contactConfig.turnstileSiteKey)) {
      await ensureTurnstileWidget(form);
      if (!getTurnstileToken(form)) {
        throw new Error("Complete the security check before submitting.");
      }
    }

    var response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(form, pairs)),
    });
    var payload = null;

    try {
      payload = await response.json();
    } catch (error) {
      void error;
    }

    if (!response.ok) {
      throw new Error(
        extractErrorMessage(payload, "Unable to send your message right now.")
      );
    }

    return payload;
  }

  function bindForm(form) {
    if (form.dataset.curbBound === "true" || !shouldHandleForm(form)) {
      return;
    }

    form.dataset.curbBound = "true";
    if (text(contactConfig.turnstileSiteKey)) {
      void ensureTurnstileWidget(form).catch(function () {
        // Defer the error until submit so the form can still render.
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var submitter = form.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
      }

      try {
        setStatus(form, "success", "Sending your message...");
        await submitForm(form);
        form.reset();
        resetTurnstile(form);
        setStatus(
          form,
          "success",
          text(contactConfig.successMessage) ||
            "Thanks. Your message has been sent."
        );
      } catch (error) {
        resetTurnstile(form);
        setStatus(
          form,
          "error",
          error instanceof Error && error.message
            ? error.message
            : text(contactConfig.errorMessage) ||
                "Unable to send your message right now."
        );
      } finally {
        if (submitter) {
          submitter.disabled = false;
        }
      }
    });
  }

  function bindForms() {
    Array.prototype.slice.call(document.forms || []).forEach(bindForm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindForms);
  } else {
    bindForms();
  }
})();`;

