(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var contactConfig = siteConfig.contact || {};

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

  function ensureFallback(form) {
    var fallback = form.querySelector("[data-curb-mailto-fallback]");
    if (fallback) {
      return fallback;
    }

    fallback = document.createElement("div");
    fallback.setAttribute("data-curb-mailto-fallback", "true");
    fallback.hidden = true;
    fallback.style.marginTop = "1rem";
    fallback.style.padding = "1rem";
    fallback.style.border = "1px solid rgba(15, 23, 42, 0.12)";
    fallback.style.borderRadius = "0.75rem";
    fallback.style.background = "rgba(248, 250, 252, 0.96)";
    fallback.innerHTML =
      '<p data-curb-mailto-copy-message style="margin:0 0 0.75rem 0;font-size:0.95rem;"></p>' +
      '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">' +
      '<a data-curb-mailto-link href="#" style="font-weight:600;">Open email app again</a>' +
      '<button data-curb-mailto-copy type="button" style="padding:0.6rem 0.9rem;border-radius:999px;border:0;background:#0f172a;color:#fff;cursor:pointer;">Copy message</button>' +
      "</div>" +
      '<pre data-curb-mailto-preview style="margin:0;white-space:pre-wrap;font-size:0.85rem;line-height:1.5;"></pre>';
    form.appendChild(fallback);
    return fallback;
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
        pairs.push([key, value.trim()]);
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

    return !/^(https?:)?\/\//i.test(action);
  }

  function buildMailtoUrl(recipient, pairs) {
    var lines = pairs.map(function (pair) {
      return pair[0] + ": " + pair[1];
    });
    var subject = text(contactConfig.subjectPrefix) || "Website inquiry";
    return "mailto:" + encodeURIComponent(recipient) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
  }

  function buildFallbackText(recipient, pairs) {
    var subject = text(contactConfig.subjectPrefix) || "Website inquiry";
    var body = pairs.map(function (pair) {
      return pair[0] + ": " + pair[1];
    }).join("\n");
    return [
      "To: " + recipient,
      "Subject: " + subject,
      "",
      body
    ].join("\n");
  }

  function showFallback(form, recipient, mailtoUrl, fallbackText) {
    var fallback = ensureFallback(form);
    var message = fallback.querySelector("[data-curb-mailto-copy-message]");
    var link = fallback.querySelector("[data-curb-mailto-link]");
    var preview = fallback.querySelector("[data-curb-mailto-preview]");
    var copyButton = fallback.querySelector("[data-curb-mailto-copy]");
    var hint =
      text(contactConfig.fallbackMessage) ||
      "If your email app did not open, copy the prepared message below.";

    if (message) {
      message.textContent = hint;
    }
    if (link) {
      link.setAttribute("href", mailtoUrl);
    }
    if (preview) {
      preview.textContent = fallbackText;
    }
    if (copyButton) {
      copyButton.onclick = async function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fallbackText);
            copyButton.textContent = "Copied";
            window.setTimeout(function () {
              copyButton.textContent = "Copy message";
            }, 1800);
            return;
          }
        } catch (error) {
          void error;
        }

        window.prompt("Copy this email message", fallbackText);
      };
    }

    fallback.hidden = false;
  }

  function bindForm(form) {
    if (form.dataset.curbBound === "true" || !shouldHandleForm(form)) {
      return;
    }

    form.dataset.curbBound = "true";

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var submitter = form.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
      }

      var pairs = serializeForm(form);
      var recipient = text(contactConfig.recipientEmail);
      var mailtoUrl = buildMailtoUrl(recipient, pairs);
      var fallbackText = buildFallbackText(recipient, pairs);
      var composerOpened = false;
      var visibilityHandler = function () {
        if (document.hidden) {
          composerOpened = true;
        }
      };

      try {
        if (!recipient) {
          throw new Error(
            "Set contact.recipientEmail in assets/curb-site-config.js before launch."
          );
        }

        document.addEventListener("visibilitychange", visibilityHandler, {
          once: false
        });
        setStatus(form, "success", "Opening your email app...");
        window.location.href = mailtoUrl;

        window.setTimeout(function () {
          document.removeEventListener("visibilitychange", visibilityHandler);
          if (!composerOpened) {
            setStatus(form, "error", "Email app not detected.");
            showFallback(form, recipient, mailtoUrl, fallbackText);
            return;
          }

          showFallback(form, recipient, mailtoUrl, fallbackText);
          setStatus(
            form,
            "success",
            "Your email draft should be open. Send it from your mail app."
          );
        }, 1200);
      } catch (error) {
        var message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to send your message right now.";
        setStatus(form, "error", message);
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
})();
