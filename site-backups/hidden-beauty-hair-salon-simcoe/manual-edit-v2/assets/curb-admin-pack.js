(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var authPanel = document.getElementById("adminAuthPanel");
  var statusNode = document.getElementById("adminStatus");
  var metaNode = document.getElementById("adminMeta");
  var pageListNode = document.getElementById("adminPageList");
  var pageTitleNode = document.getElementById("adminPageTitle");
  var pageFormNode = document.getElementById("adminPageForm");
  var commerceFormNode = document.getElementById("adminCommerceForm");
  var commerceProviderInput = document.getElementById("adminCommerceProvider");
  var productsNode = document.getElementById("adminProducts");
  var productFormNode = document.getElementById("adminProductForm");
  var productFormTitleNode = document.getElementById("adminProductFormTitle");
  var addProductButton = document.getElementById("adminAddProduct");
  var pageCountNode = document.getElementById("adminPageCount");
  var productCountNode = document.getElementById("adminProductCount");
  var storeProviderNode = document.getElementById("adminStoreProvider");
  var NEW_PRODUCT_ID = "__new__";
  var runtimeBaseUrl = (function () {
    try {
      var currentScript = document.currentScript;
      return currentScript && currentScript.src ? currentScript.src : window.location.href;
    } catch (error) {
      void error;
      return window.location.href;
    }
  })();
  var schemaPath = "curb-cms-schema.json";
  var schemaUrl = (function () {
    try {
      return new URL(schemaPath, runtimeBaseUrl).toString();
    } catch (error) {
      void error;
      return schemaPath;
    }
  })();
  var schema = null;
  var db = null;
  var auth = null;
  var currentUser = null;
  var currentCommerceProvider = "none";
  var selectedPageKey = null;
  var selectedProductId = null;
  var loadedProducts = [];
  var previewSession = false;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCommerceProvider(value) {
    var normalized = text(value).toLowerCase();
    if (
      normalized === "stripe" ||
      normalized === "stripe-payment-links" ||
      normalized === "payment-links"
    ) {
      return "stripe-payment-links";
    }

    if (normalized === "shopify") {
      return "shopify";
    }

    return "none";
  }

  function configuredCommerceProvider() {
    if (!commerceConfig.enabled) {
      return "none";
    }

    var provider = normalizeCommerceProvider(commerceConfig.provider);
    return provider === "none" ? "stripe-payment-links" : provider;
  }

  function commerceProviderLabel(provider) {
    if (provider === "shopify") {
      return "Shopify checkout links";
    }

    if (provider === "stripe-payment-links") {
      return "Stripe Payment Links";
    }

    return "No store";
  }

  function checkoutUrlLabel(provider) {
    if (provider === "shopify") {
      return "Shopify product or checkout URL";
    }

    if (provider === "stripe-payment-links") {
      return "Stripe Payment Link";
    }

    return "Checkout URL";
  }

  function checkoutUrlPlaceholder(provider) {
    if (provider === "shopify") {
      return "https://your-store.myshopify.com/...";
    }

    if (provider === "stripe-payment-links") {
      return "https://buy.stripe.com/...";
    }

    return "https://...";
  }

  currentCommerceProvider = configuredCommerceProvider();

  function hasLocalStorage() {
    try {
      return typeof window.localStorage !== "undefined";
    } catch (error) {
      void error;
      return false;
    }
  }

  function setStatus(message, isError) {
    if (!statusNode) {
      return;
    }

    statusNode.textContent = message;
    statusNode.className = isError ? "text-danger mb-0 mt-2" : "text-secondary mb-0 mt-2";
  }

  function badgeMarkup(label, tone) {
    return '<span class="badge bg-' + tone + '-lt text-' + tone + '">' + escapeHtml(label) + "</span>";
  }

  function emptyStateMarkup(message) {
    return '<div class="admin-empty-state">' + escapeHtml(message) + "</div>";
  }

  function emptyStateRowMarkup(message, colspan) {
    return '<tr><td class="admin-empty-state-cell" colspan="' + String(colspan) + '">' + emptyStateMarkup(message) + "</td></tr>";
  }

  function hasFirebaseConfig() {
    return !!(
      text(firebaseConfig.apiKey) &&
      text(firebaseConfig.authDomain) &&
      text(firebaseConfig.projectId) &&
      text(firebaseConfig.appId)
    );
  }

  function getSiteSlug() {
    return text(siteConfig.site && siteConfig.site.slug);
  }

  function getOwnerEmail() {
    return text(cmsConfig.ownerEmail || siteConfig.contact && siteConfig.contact.recipientEmail);
  }

  function getPreviewStorageNamespace() {
    return text(previewConfig.storageNamespace) || "curb-preview-admin";
  }

  function getPreviewStorageKey(suffix) {
    return getPreviewStorageNamespace() + ":" + getSiteSlug() + ":" + suffix;
  }

  function getPreviewSessionKey() {
    return getPreviewStorageKey("session");
  }

  function getPreviewQueryParam() {
    return text(previewConfig.queryParam) || "curb-preview-admin";
  }

  function isPreviewConfigured() {
    return !!(previewConfig && previewConfig.enabled && text(previewConfig.token));
  }

  function hasPreviewSession() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      return window.localStorage.getItem(getPreviewSessionKey()) === "active";
    } catch (error) {
      void error;
      return false;
    }
  }

  function activatePreviewSessionFromUrl() {
    if (!isPreviewConfigured() || !hasLocalStorage()) {
      return false;
    }

    try {
      var url = new URL(window.location.href);
      var incomingToken = text(url.searchParams.get(getPreviewQueryParam()));
      if (incomingToken && incomingToken === text(previewConfig.token)) {
        window.localStorage.setItem(getPreviewSessionKey(), "active");
        url.searchParams.delete(getPreviewQueryParam());
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        return true;
      }
    } catch (error) {
      void error;
    }

    return hasPreviewSession();
  }

  function clearPreviewSession(removeData) {
    if (!hasLocalStorage()) {
      return;
    }

    try {
      var prefix = getPreviewStorageNamespace() + ":" + getSiteSlug() + ":";
      for (var index = window.localStorage.length - 1; index >= 0; index -= 1) {
        var key = window.localStorage.key(index);
        if (!key || key.indexOf(prefix) !== 0) {
          continue;
        }

        if (removeData || key === getPreviewSessionKey()) {
          window.localStorage.removeItem(key);
        }
      }
    } catch (error) {
      void error;
    }
  }

  function readStoredJson(key, fallback) {
    if (!hasLocalStorage()) {
      return fallback;
    }

    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw);
    } catch (error) {
      void error;
      return fallback;
    }
  }

  function writeStoredJson(key, value) {
    if (!hasLocalStorage()) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      void error;
    }
  }

  function previewPageStorageKey(pageKey) {
    return getPreviewStorageKey("page:" + pageKey);
  }

  function readPreviewPageFields(pageKey) {
    var fields = readStoredJson(previewPageStorageKey(pageKey), {});
    return fields && typeof fields === "object" ? fields : {};
  }

  function writePreviewPageFields(pageKey, fields) {
    writeStoredJson(previewPageStorageKey(pageKey), fields);
  }

  function sortProducts(products) {
    return products.slice().sort(function (left, right) {
      var positionDelta = Number(left && left.position || 0) - Number(right && right.position || 0);
      if (positionDelta !== 0) {
        return positionDelta;
      }

      return text(left && left.title).localeCompare(text(right && right.title));
    });
  }

  function readPreviewProducts() {
    var products = readStoredJson(getPreviewStorageKey("products"), []);
    return Array.isArray(products) ? sortProducts(products) : [];
  }

  function writePreviewProducts(products) {
    writeStoredJson(getPreviewStorageKey("products"), sortProducts(products));
  }

  function readPreviewCommerceProvider() {
    var provider = normalizeCommerceProvider(
      readStoredJson(
        getPreviewStorageKey("commerce-provider"),
        configuredCommerceProvider()
      )
    );
    return provider === "none" ? configuredCommerceProvider() : provider;
  }

  function writePreviewCommerceProvider(provider) {
    writeStoredJson(getPreviewStorageKey("commerce-provider"), provider);
  }

  function upsertPreviewProduct(product) {
    var products = readPreviewProducts().filter(function (entry) {
      return entry && entry.id !== product.id;
    });
    products.push(product);
    writePreviewProducts(products);
  }

  function deletePreviewProduct(productId) {
    writePreviewProducts(
      readPreviewProducts().filter(function (entry) {
        return entry && entry.id !== productId;
      })
    );
  }

  function initializeFirebase() {
    if (!window.firebase) {
      throw new Error("Firebase SDK failed to load.");
    }

    if (!hasFirebaseConfig()) {
      throw new Error("Add Firebase config values in assets/curb-site-config.js before using the owner portal.");
    }

    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp({
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        appId: firebaseConfig.appId,
        storageBucket: firebaseConfig.storageBucket || undefined,
        messagingSenderId: firebaseConfig.messagingSenderId || undefined
      });
    }

    auth = firebase.auth();
    db = firebase.firestore();
  }

  function renderAuthPanel() {
    if (!authPanel) {
      return;
    }

    if (previewSession) {
      authPanel.innerHTML =
        '<div class="alert alert-azure" role="alert">Preview session active. Changes stay in this browser and never touch customer data.</div>' +
        '<div class="d-grid gap-2">' +
        '<button id="exitPreviewButton" class="btn btn-primary" type="button">Exit preview</button>' +
        '<button id="resetPreviewButton" class="btn btn-outline-secondary" type="button">Reset preview data</button>' +
        "</div>";

      var exitPreviewButton = document.getElementById("exitPreviewButton");
      var resetPreviewButton = document.getElementById("resetPreviewButton");

      if (exitPreviewButton) {
        exitPreviewButton.addEventListener("click", function () {
          clearPreviewSession(false);
          window.location.reload();
        });
      }

      if (resetPreviewButton) {
        resetPreviewButton.addEventListener("click", function () {
          clearPreviewSession(true);
          window.location.reload();
        });
      }

      return;
    }

    var previewHint =
      !hasFirebaseConfig() && isPreviewConfigured()
        ? '<div class="alert alert-warning" role="alert">Open the dedicated Curb admin preview URL to unlock a browser-only demo session, or add Firebase config for live owner editing.</div>'
        : "";

    authPanel.innerHTML =
      previewHint +
      '<div class="mb-3">' +
      '<label for="ownerEmailInput" class="form-label">Owner email</label>' +
      '<input id="ownerEmailInput" class="form-control" type="email" placeholder="owner@example.com" value="' + escapeHtml(getOwnerEmail() || "") + '">' +
      "</div>" +
      '<div class="d-grid gap-2">' +
      '<button id="sendMagicLink" class="btn btn-primary" type="button">Send sign-in link</button>' +
      '<button id="signOutButton" class="btn btn-outline-secondary" type="button">Sign out</button>' +
      "</div>";

    var emailInput = document.getElementById("ownerEmailInput");
    var sendButton = document.getElementById("sendMagicLink");
    var signOutButton = document.getElementById("signOutButton");

    if (sendButton) {
      sendButton.addEventListener("click", function () {
        sendSignInLink(emailInput && emailInput.value ? emailInput.value : "");
      });
    }

    if (signOutButton) {
      signOutButton.addEventListener("click", async function () {
        if (!auth) {
          return;
        }

        await auth.signOut();
        currentUser = null;
        renderMeta();
        setStatus("Signed out. Send a new sign-in link to continue.", false);
      });
    }
  }

  async function sendSignInLink(email) {
    if (!auth) {
      return;
    }

    var normalizedEmail = text(email).toLowerCase();
    if (!normalizedEmail) {
      setStatus("Enter the owner email address before sending a sign-in link.", true);
      return;
    }

    try {
      await auth.sendSignInLinkToEmail(normalizedEmail, {
        url: window.location.origin + window.location.pathname,
        handleCodeInApp: true
      });
      window.localStorage.setItem("curb-owner-email", normalizedEmail);
      setStatus("Sign-in link sent. Open it from the same email inbox to access the owner portal.", false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send sign-in link.", true);
    }
  }

  async function finishEmailLinkSignIn() {
    if (!auth || !auth.isSignInWithEmailLink(window.location.href)) {
      return;
    }

    var email = window.localStorage.getItem("curb-owner-email") || window.prompt("Confirm your owner email");
    if (!email) {
      setStatus("Email sign-in could not be completed because no owner email was provided.", true);
      return;
    }

    try {
      await auth.signInWithEmailLink(email, window.location.href);
      window.localStorage.setItem("curb-owner-email", text(email).toLowerCase());
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to complete sign-in.", true);
    }
  }

  function siteRef() {
    return db.collection("sites").doc(getSiteSlug());
  }

  function pageRef(pageKey) {
    return siteRef().collection("pages").doc(pageKey);
  }

  function productsCollection() {
    return siteRef().collection("products");
  }

  function renderMeta() {
    if (!metaNode) {
      return;
    }

    if (previewSession) {
      metaNode.innerHTML =
        badgeMarkup("Preview session", "azure") +
        badgeMarkup("Browser-only demo data", "blue") +
        badgeMarkup(
          commerceConfig.enabled
            ? commerceProviderLabel(currentCommerceProvider)
            : "CMS preview enabled",
          "green"
        );
      return;
    }

    metaNode.innerHTML =
      badgeMarkup(currentUser && currentUser.email ? currentUser.email : "Signed out", "blue") +
      badgeMarkup(cmsConfig.provider || "Firebase content pack", "purple") +
      badgeMarkup(
        commerceConfig.enabled ? commerceProviderLabel(currentCommerceProvider) : "No store",
        "green"
      );
  }

  function renderStoreProviderSummary() {
    if (!storeProviderNode) {
      return;
    }

    storeProviderNode.textContent = commerceProviderLabel(currentCommerceProvider);
  }

  function setPageCountSummary() {
    if (!pageCountNode) {
      return;
    }

    pageCountNode.textContent =
      schema && Array.isArray(schema.pages) ? String(schema.pages.length) : "0";
  }

  function setProductCountSummary(count) {
    if (!productCountNode) {
      return;
    }

    productCountNode.textContent = String(count);
  }

  function renderCommerceForm() {
    renderStoreProviderSummary();

    if (!commerceFormNode || !commerceProviderInput) {
      return;
    }

    var disabled = !commerceConfig.enabled;
    var selectedProvider =
      currentCommerceProvider === "shopify"
        ? "shopify"
        : "stripe-payment-links";
    commerceProviderInput.disabled = disabled;
    commerceProviderInput.value = selectedProvider;

    var submitButton = commerceFormNode.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = disabled;
    }
  }

  async function ensureSiteAccess() {
    if (previewSession) {
      currentCommerceProvider = commerceConfig.enabled
        ? readPreviewCommerceProvider()
        : "none";
      renderCommerceForm();
      renderMeta();
      return;
    }

    var email = currentUser && currentUser.email ? currentUser.email.toLowerCase() : "";
    if (!email) {
      throw new Error("Owner email is not available on this Firebase user.");
    }

    var ref = siteRef();
    var snapshot = await ref.get();
    var configuredOwner = getOwnerEmail();

    if (!snapshot.exists) {
      await ref.set({
        businessName: text(siteConfig.businessName || siteConfig.site && siteConfig.site.businessName || ""),
        ownerEmail: configuredOwner || email,
        cmsProvider: text(cmsConfig.provider || "firebase-auth-firestore"),
        commerceProvider: commerceConfig.enabled
          ? configuredCommerceProvider()
          : "none",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      snapshot = await ref.get();
    }

    var data = snapshot.data() || {};
    var ownerEmail = text(data.ownerEmail).toLowerCase();
    if (ownerEmail && ownerEmail !== email) {
      throw new Error("This Firebase project is locked to a different owner email.");
    }

    currentCommerceProvider = commerceConfig.enabled
      ? normalizeCommerceProvider(data.commerceProvider || configuredCommerceProvider())
      : "none";
    if (currentCommerceProvider === "none" && commerceConfig.enabled) {
      currentCommerceProvider = configuredCommerceProvider();
    }
    renderCommerceForm();
    renderMeta();
  }

  async function loadSchema() {
    var response = await fetch(schemaUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load the CMS schema manifest.");
    }

    schema = await response.json();
    document.title = schema.businessName + " Owner Portal";
    setPageCountSummary();
  }

  function renderPageList() {
    if (!pageListNode || !schema) {
      return;
    }

    if (!schema.pages.length) {
      pageListNode.innerHTML = emptyStateMarkup("No editable pages were discovered.");
      return;
    }

    pageListNode.innerHTML = "";
    schema.pages.forEach(function (page) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "list-group-item list-group-item-action";
      button.textContent = page.title;
      if (page.pageKey === selectedPageKey) {
        button.classList.add("active");
      }
      button.addEventListener("click", function () {
        selectedPageKey = page.pageKey;
        renderPageList();
        loadPageForm(page.pageKey);
      });
      pageListNode.appendChild(button);
    });
  }

  function buildFieldInput(field, value) {
    var wrapper = document.createElement("div");
    wrapper.className = "mb-3";
    var label = document.createElement("label");
    label.className = "form-label";
    label.textContent = field.label;
    wrapper.appendChild(label);

    if (field.type === "textarea") {
      var textarea = document.createElement("textarea");
      textarea.className = "form-control";
      textarea.rows = 5;
      textarea.name = field.key;
      textarea.value = value && typeof value.value === "string" ? value.value : (field.defaultValue || "");
      wrapper.appendChild(textarea);
      return wrapper;
    }

    if (field.type === "link") {
      var textInput = document.createElement("input");
      textInput.className = "form-control";
      textInput.name = field.key + "__text";
      textInput.value = value && typeof value.text === "string" ? value.text : (field.defaultValue || "");
      textInput.placeholder = "Link label";
      var hrefInput = document.createElement("input");
      hrefInput.className = "form-control mt-2";
      hrefInput.name = field.key + "__href";
      hrefInput.value = value && typeof value.href === "string" ? value.href : (field.defaultHref || "");
      hrefInput.placeholder = "https://example.com";
      wrapper.appendChild(textInput);
      wrapper.appendChild(hrefInput);
      return wrapper;
    }

    if (field.type === "image") {
      var srcInput = document.createElement("input");
      srcInput.className = "form-control";
      srcInput.name = field.key + "__src";
      srcInput.value = value && typeof value.src === "string" ? value.src : (field.defaultValue || "");
      srcInput.placeholder = "Image URL or local path";
      var altInput = document.createElement("input");
      altInput.className = "form-control mt-2";
      altInput.name = field.key + "__alt";
      altInput.value = value && typeof value.alt === "string" ? value.alt : (field.defaultAlt || "");
      altInput.placeholder = "Alt text";
      wrapper.appendChild(srcInput);
      wrapper.appendChild(altInput);
      return wrapper;
    }

    var input = document.createElement("input");
    input.className = "form-control";
    input.name = field.key;
    input.value = value && typeof value.value === "string" ? value.value : (field.defaultValue || "");
    wrapper.appendChild(input);
    return wrapper;
  }

  async function loadPageForm(pageKey) {
    if (!pageFormNode || !schema) {
      return;
    }

    var page = schema.pages.find(function (entry) { return entry.pageKey === pageKey; });
    if (!page) {
      return;
    }

    if (pageTitleNode) {
      pageTitleNode.textContent = page.title + " content";
    }

    var values = {};
    if (previewSession) {
      values = readPreviewPageFields(pageKey);
    } else {
      var snapshot = await pageRef(pageKey).get();
      values = snapshot.exists && snapshot.data() && snapshot.data().fields ? snapshot.data().fields : {};
    }

    pageFormNode.innerHTML = "";
    page.fields.forEach(function (field) {
      pageFormNode.appendChild(buildFieldInput(field, values[field.key]));
    });

    var saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "btn btn-primary";
    saveButton.textContent = "Save page changes";
    pageFormNode.appendChild(saveButton);

    pageFormNode.onsubmit = async function (event) {
      event.preventDefault();
      var formData = new FormData(pageFormNode);
      var nextFields = {};
      page.fields.forEach(function (field) {
        if (field.type === "link") {
          nextFields[field.key] = {
            text: String(formData.get(field.key + "__text") || "").trim(),
            href: String(formData.get(field.key + "__href") || "").trim()
          };
          return;
        }

        if (field.type === "image") {
          nextFields[field.key] = {
            src: String(formData.get(field.key + "__src") || "").trim(),
            alt: String(formData.get(field.key + "__alt") || "").trim()
          };
          return;
        }

        nextFields[field.key] = {
          value: String(formData.get(field.key) || "").trim()
        };
      });

      try {
        if (previewSession) {
          writePreviewPageFields(pageKey, nextFields);
          setStatus("Saved preview page changes for " + page.title + ".", false);
          return;
        }

        await pageRef(pageKey).set({
          fields: nextFields,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        setStatus("Saved page changes for " + page.title + ".", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to save page changes.", true);
      }
    };
  }

  function normalizePosition(value, fallback) {
    var parsed = Number(value);
    if (!isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.max(1, Math.round(parsed));
  }

  function nextProductPosition() {
    var highestPosition = 0;
    loadedProducts.forEach(function (product) {
      highestPosition = Math.max(
        highestPosition,
        normalizePosition(product && product.position, 0)
      );
    });
    return highestPosition + 1;
  }

  function makeProductId(title) {
    var base = text(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return base || "product-" + Date.now().toString(36);
  }

  function makeUniqueProductId(baseId, existingId) {
    var candidate = baseId || "product-" + Date.now().toString(36);
    var suffix = 2;
    while (loadedProducts.some(function (product) {
      return product && product.id === candidate && product.id !== existingId;
    })) {
      candidate = baseId + "-" + String(suffix);
      suffix += 1;
    }
    return candidate;
  }

  function buildProductDraft(product) {
    return {
      id: product && product.id ? product.id : "",
      title: product && typeof product.title === "string" ? product.title : "",
      priceLabel: product && typeof product.priceLabel === "string" ? product.priceLabel : "",
      position: normalizePosition(
        product && product.position,
        nextProductPosition()
      ),
      description: product && typeof product.description === "string" ? product.description : "",
      imageUrl: product && typeof product.imageUrl === "string" ? product.imageUrl : "",
      imageAlt: product && typeof product.imageAlt === "string" ? product.imageAlt : "",
      actionLabel: product && typeof product.actionLabel === "string" && product.actionLabel
        ? product.actionLabel
        : "Buy now",
      checkoutUrl: product && typeof product.checkoutUrl === "string" ? product.checkoutUrl : ""
    };
  }

  function findSelectedProduct() {
    if (!selectedProductId || selectedProductId === NEW_PRODUCT_ID) {
      return null;
    }

    return loadedProducts.find(function (product) {
      return product && product.id === selectedProductId;
    }) || null;
  }

  function syncSelectedProduct() {
    if (!commerceConfig.enabled) {
      selectedProductId = null;
      return;
    }

    if (!loadedProducts.length) {
      selectedProductId = NEW_PRODUCT_ID;
      return;
    }

    if (selectedProductId === NEW_PRODUCT_ID) {
      return;
    }

    var selectedProduct = findSelectedProduct();
    if (!selectedProduct) {
      selectedProductId = loadedProducts[0].id;
    }
  }

  function renderProductTable() {
    if (!productsNode) {
      return;
    }

    if (!commerceConfig.enabled) {
      productsNode.innerHTML = emptyStateRowMarkup(
        "This site does not include the lightweight store pack.",
        5
      );
      return;
    }

    if (!loadedProducts.length) {
      productsNode.innerHTML = emptyStateRowMarkup(
        previewSession
          ? "No preview products have been added yet."
          : "No products have been added yet.",
        5
      );
      return;
    }

    productsNode.innerHTML = "";
    loadedProducts.forEach(function (product) {
      var row = document.createElement("tr");
      if (selectedProductId === product.id) {
        row.className = "admin-product-row-active table-active";
      }

      row.innerHTML =
        '<td><div class="fw-medium">' + escapeHtml(product.title || "Untitled product") + '</div><div class="text-secondary small">' + escapeHtml(product.id || "") + "</div></td>" +
        '<td>' + (product.priceLabel ? escapeHtml(product.priceLabel) : '<span class="text-secondary">Not set</span>') + "</td>" +
        '<td>' +
        (product.checkoutUrl
          ? '<a href="' + escapeHtml(product.checkoutUrl) + '" target="_blank" rel="noopener noreferrer">Configured</a>'
          : '<span class="text-secondary">Missing URL</span>') +
        "</td>" +
        '<td>' + escapeHtml(String(normalizePosition(product.position, 1))) + "</td>" +
        '<td><div class="btn-list justify-content-end flex-nowrap">' +
        '<button class="btn btn-outline-primary btn-sm" type="button" data-edit-product="' + escapeHtml(product.id || "") + '">Edit</button>' +
        '<button class="btn btn-outline-danger btn-sm" type="button" data-delete-product="' + escapeHtml(product.id || "") + '">Delete</button>' +
        "</div></td>";

      var editButton = row.querySelector("[data-edit-product]");
      var deleteButton = row.querySelector("[data-delete-product]");

      if (editButton) {
        editButton.addEventListener("click", function () {
          selectedProductId = product.id;
          renderProductTable();
          renderProductEditor(findSelectedProduct());
        });
      }

      if (deleteButton) {
        deleteButton.addEventListener("click", async function () {
          await deleteProduct(product.id);
        });
      }

      productsNode.appendChild(row);
    });
  }

  function renderProductEditor(product) {
    if (!productFormNode || !productFormTitleNode) {
      return;
    }

    if (!commerceConfig.enabled) {
      productFormTitleNode.textContent = "Product editor";
      productFormNode.innerHTML = emptyStateMarkup(
        "This site does not include the lightweight store pack."
      );
      productFormNode.onsubmit = null;
      return;
    }

    var draft = buildProductDraft(product);
    var isExistingProduct = !!(product && product.id);
    productFormTitleNode.textContent = isExistingProduct
      ? "Editing " + (draft.title || draft.id)
      : "New product";
    productFormNode.innerHTML =
      '<div class="row g-3">' +
      '<div class="col-md-5"><label class="form-label">Title</label><input class="form-control" name="title" value="' + escapeHtml(draft.title) + '" placeholder="Signature service"></div>' +
      '<div class="col-md-4"><label class="form-label">Price label</label><input class="form-control" name="priceLabel" value="' + escapeHtml(draft.priceLabel) + '" placeholder="$49"></div>' +
      '<div class="col-md-3"><label class="form-label">Position</label><input class="form-control" name="position" type="number" min="1" value="' + escapeHtml(String(draft.position)) + '"></div>' +
      '<div class="col-12"><label class="form-label">Description</label><textarea class="form-control" name="description" rows="4">' + escapeHtml(draft.description) + "</textarea></div>" +
      '<div class="col-md-6"><label class="form-label">Image URL</label><input class="form-control" name="imageUrl" value="' + escapeHtml(draft.imageUrl) + '" placeholder="https://..."></div>' +
      '<div class="col-md-6"><label class="form-label">Image alt</label><input class="form-control" name="imageAlt" value="' + escapeHtml(draft.imageAlt) + '" placeholder="Product image description"></div>' +
      '<div class="col-md-5"><label class="form-label">Button label</label><input class="form-control" name="actionLabel" value="' + escapeHtml(draft.actionLabel) + '" placeholder="Buy now"></div>' +
      '<div class="col-md-7"><label class="form-label">' + escapeHtml(checkoutUrlLabel(currentCommerceProvider)) + '</label><input class="form-control" name="checkoutUrl" value="' + escapeHtml(draft.checkoutUrl) + '" placeholder="' + escapeHtml(checkoutUrlPlaceholder(currentCommerceProvider)) + '"></div>' +
      '<div class="col-12 text-secondary small">Product checkout links currently use ' + escapeHtml(commerceProviderLabel(currentCommerceProvider)) + ".</div>" +
      '<div class="col-12"><div class="d-flex flex-column flex-sm-row gap-2 justify-content-between">' +
      '<div class="d-flex flex-wrap gap-2">' +
      '<button class="btn btn-primary" type="submit">Save product</button>' +
      (isExistingProduct
        ? '<button class="btn btn-outline-danger" type="button" data-delete-current="true">Delete product</button>'
        : "") +
      "</div>" +
      (isExistingProduct
        ? '<div class="text-secondary small align-self-center">Editing product id ' + escapeHtml(draft.id) + "</div>"
        : '<div class="text-secondary small align-self-center">New products appear in the table after saving.</div>') +
      "</div></div>" +
      "</div>";

    productFormNode.onsubmit = async function (event) {
      event.preventDefault();
      await saveProduct(isExistingProduct ? draft.id : "", new FormData(productFormNode));
    };

    var deleteButton = productFormNode.querySelector("[data-delete-current]");
    if (deleteButton && draft.id) {
      deleteButton.addEventListener("click", async function () {
        await deleteProduct(draft.id);
      });
    }
  }

  function renderProductsView() {
    renderProductTable();
    renderProductEditor(findSelectedProduct());
  }

  async function saveProduct(existingProductId, formData) {
    if (!commerceConfig.enabled) {
      setStatus("This site does not include the lightweight store pack.", true);
      return;
    }

    var title = String(formData.get("title") || "").trim();
    if (!title) {
      setStatus("Enter a product title before saving.", true);
      return;
    }

    var baseProductId = existingProductId || makeProductId(title);
    var productId = existingProductId || makeUniqueProductId(baseProductId, "");
    var existingProduct = loadedProducts.find(function (product) {
      return product && product.id === existingProductId;
    }) || null;
    var payload = {
      title: title,
      priceLabel: String(formData.get("priceLabel") || "").trim(),
      position: normalizePosition(
        formData.get("position"),
        existingProduct ? normalizePosition(existingProduct.position, 1) : nextProductPosition()
      ),
      description: String(formData.get("description") || "").trim(),
      imageUrl: String(formData.get("imageUrl") || "").trim(),
      imageAlt: String(formData.get("imageAlt") || "").trim(),
      actionLabel: String(formData.get("actionLabel") || "").trim() || "Buy now",
      checkoutUrl: String(formData.get("checkoutUrl") || "").trim()
    };

    try {
      if (previewSession) {
        upsertPreviewProduct({
          id: productId,
          title: payload.title,
          priceLabel: payload.priceLabel,
          position: payload.position,
          description: payload.description,
          imageUrl: payload.imageUrl,
          imageAlt: payload.imageAlt,
          actionLabel: payload.actionLabel,
          checkoutUrl: payload.checkoutUrl
        });
      } else {
        await productsCollection().doc(productId).set({
          title: payload.title,
          priceLabel: payload.priceLabel,
          position: payload.position,
          description: payload.description,
          imageUrl: payload.imageUrl,
          imageAlt: payload.imageAlt,
          actionLabel: payload.actionLabel,
          checkoutUrl: payload.checkoutUrl,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      selectedProductId = productId;
      await loadProducts();
      setStatus(
        (previewSession ? "Saved preview product " : "Saved product ") + (title || productId) + ".",
        false
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save product.", true);
    }
  }

  async function deleteProduct(productId) {
    if (!productId) {
      selectedProductId = NEW_PRODUCT_ID;
      renderProductsView();
      return;
    }

    try {
      if (previewSession) {
        deletePreviewProduct(productId);
      } else {
        await productsCollection().doc(productId).delete();
      }

      selectedProductId = null;
      await loadProducts();
      setStatus(
        (previewSession ? "Deleted preview product " : "Deleted product ") + productId + ".",
        false
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete product.", true);
    }
  }

  async function loadProducts() {
    if (addProductButton) {
      addProductButton.hidden = !commerceConfig.enabled;
    }

    if (!commerceConfig.enabled) {
      loadedProducts = [];
      selectedProductId = null;
      setProductCountSummary(0);
      renderProductsView();
      return;
    }

    if (previewSession) {
      loadedProducts = readPreviewProducts();
    } else {
      var snapshot = await productsCollection().orderBy("position").get();
      var products = [];
      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        products.push(data);
      });
      loadedProducts = sortProducts(products);
    }

    syncSelectedProduct();
    setProductCountSummary(loadedProducts.length);
    renderProductsView();
  }

  function bindAddProduct() {
    if (!addProductButton) {
      return;
    }

    addProductButton.addEventListener("click", function () {
      selectedProductId = NEW_PRODUCT_ID;
      renderProductsView();
      if (productFormNode) {
        productFormNode.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function bindCommerceForm() {
    if (!commerceFormNode || !commerceProviderInput) {
      return;
    }

    commerceFormNode.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!commerceConfig.enabled) {
        setStatus("This site does not include the lightweight store pack.", true);
        return;
      }

      var nextProvider = normalizeCommerceProvider(commerceProviderInput.value);
      if (nextProvider === "none") {
        setStatus("Choose Stripe or Shopify for product checkout links.", true);
        return;
      }

      if (previewSession) {
        currentCommerceProvider = nextProvider;
        writePreviewCommerceProvider(nextProvider);
        renderCommerceForm();
        renderMeta();
        renderProductsView();
        setStatus("Saved preview store settings.", false);
        return;
      }

      if (!currentUser) {
        setStatus("Sign in before updating store settings.", true);
        return;
      }

      await siteRef().set({
        commerceProvider: nextProvider,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      currentCommerceProvider = nextProvider;
      renderCommerceForm();
      renderMeta();
      renderProductsView();
      setStatus("Saved store settings.", false);
    });
  }

  async function bootAfterLogin() {
    await ensureSiteAccess();
    await loadSchema();
    selectedPageKey = schema.pages[0] ? schema.pages[0].pageKey : null;
    renderPageList();
    if (selectedPageKey) {
      await loadPageForm(selectedPageKey);
    } else if (pageFormNode) {
      pageFormNode.innerHTML = emptyStateMarkup("No editable fields were discovered in the generated pages.");
    }
    await loadProducts();
    setStatus(previewSession ? "Preview owner portal ready." : "Owner portal ready.", false);
  }

  async function boot() {
    try {
      previewSession = activatePreviewSessionFromUrl();
      currentCommerceProvider = previewSession
        ? readPreviewCommerceProvider()
        : configuredCommerceProvider();
      renderAuthPanel();
      renderCommerceForm();
      renderMeta();
      bindAddProduct();
      bindCommerceForm();

      if (previewSession) {
        setStatus("Loading preview admin...", false);
        await bootAfterLogin();
        return;
      }

      if (!hasFirebaseConfig()) {
        setStatus(
          isPreviewConfigured()
            ? "Open the Curb admin preview URL for a browser-only demo, or add Firebase config to enable live owner editing."
            : "Add Firebase config values in assets/curb-site-config.js before using the owner portal.",
          true
        );
        return;
      }

      initializeFirebase();
      renderAuthPanel();
      await finishEmailLinkSignIn();
      auth.onAuthStateChanged(async function (user) {
        currentUser = user || null;
        renderMeta();
        if (!user) {
          setStatus("Send a sign-in link to the owner email to begin editing.", false);
          return;
        }

        try {
          setStatus("Loading customer-owned content...", false);
          await bootAfterLogin();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Failed to load owner portal.", true);
        }
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Owner portal failed to start.", true);
    }
  }

  boot();
})();
