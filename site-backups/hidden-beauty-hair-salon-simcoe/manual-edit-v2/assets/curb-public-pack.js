(function () {
  var siteConfig = window.CURB_SITE_CONFIG || {};
  var cmsConfig = siteConfig.cms || {};
  var commerceConfig = siteConfig.commerce || {};
  var firebaseConfig = cmsConfig.firebase || {};
  var previewConfig = cmsConfig.previewMode || {};
  var runtimeBaseUrl = (function () {
    try {
      var currentScript = document.currentScript;
      return currentScript && currentScript.src ? currentScript.src : window.location.href;
    } catch (error) {
      void error;
      return window.location.href;
    }
  })();
  var productsFilePath = "curb-products.json";
  var productsFileUrl = (function () {
    try {
      return new URL(productsFilePath, runtimeBaseUrl).toString();
    } catch (error) {
      void error;
      return productsFilePath;
    }
  })();
  var firebaseReady = false;

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

  function hasLocalStorage() {
    try {
      return typeof window.localStorage !== "undefined";
    } catch (error) {
      void error;
      return false;
    }
  }

  function hasFirebaseConfig() {
    return !!(
      text(firebaseConfig.apiKey) &&
      text(firebaseConfig.authDomain) &&
      text(firebaseConfig.projectId) &&
      text(firebaseConfig.appId)
    );
  }

  function ensureFirebase() {
    if (firebaseReady || !window.firebase || !hasFirebaseConfig()) {
      return;
    }

    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp({
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        appId: firebaseConfig.appId,
        storageBucket: firebaseConfig.storageBucket || undefined,
        messagingSenderId: firebaseConfig.messagingSenderId || undefined
      });
    }

    firebaseReady = true;
  }

  function getDb() {
    ensureFirebase();
    return window.firebase && firebaseReady ? window.firebase.firestore() : null;
  }

  function getSiteSlug() {
    return text(siteConfig.site && siteConfig.site.slug);
  }

  function getPageKey() {
    var body = document.body;
    return body ? text(body.getAttribute("data-curb-page-key")) || "index.html" : "index.html";
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

  function readPreviewPageFields() {
    var fields = readStoredJson(getPreviewStorageKey("page:" + getPageKey()), {});
    return fields && typeof fields === "object" ? fields : {};
  }

  function readPreviewProducts() {
    var products = readStoredJson(getPreviewStorageKey("products"), []);
    return Array.isArray(products) ? products : [];
  }

  function applyFieldOverride(node, type, value) {
    if (!node || !value || typeof value !== "object") {
      return;
    }

    if (type === "text" || type === "textarea") {
      if (typeof value.value === "string") {
        node.textContent = value.value;
      }
      return;
    }

    if (type === "link") {
      if (typeof value.text === "string") {
        node.textContent = value.text;
      }
      if (typeof value.href === "string" && value.href.trim()) {
        node.setAttribute("href", value.href.trim());
      }
      return;
    }

    if (type === "image") {
      if (typeof value.src === "string" && value.src.trim()) {
        node.setAttribute("src", value.src.trim());
      }
      if (typeof value.alt === "string") {
        node.setAttribute("alt", value.alt);
      }
    }
  }

  function applyPageOverrides(fields) {
    Object.keys(fields || {}).forEach(function (key) {
      var node = document.querySelector('[data-curb-key="' + key + '"]');
      if (!node) {
        return;
      }

      var type = text(node.getAttribute("data-curb-type"));
      applyFieldOverride(node, type, fields[key]);
    });
  }

  function renderProducts(products) {
    var container = document.querySelector("[data-curb-products]");
    var emptyState = document.querySelector("[data-curb-products-empty]");
    if (!container) {
      return;
    }

    container.innerHTML = "";
    if (!products.length) {
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    products.forEach(function (product) {
      var card = document.createElement("article");
      card.className = "shop-card";
      var image = product.imageUrl
        ? '<img src="' + escapeHtml(product.imageUrl) + '" alt="' + escapeHtml(product.imageAlt || product.title || "Product") + '">'
        : "";
      card.innerHTML =
        image +
        '<div class="shop-card-body">' +
        '<h2>' + escapeHtml(product.title || "Untitled product") + '</h2>' +
        (product.description ? '<p>' + escapeHtml(product.description) + '</p>' : "") +
        (product.priceLabel ? '<p class="shop-card-price">' + escapeHtml(product.priceLabel) + '</p>' : "") +
        (product.checkoutUrl
          ? '<a href="' + escapeHtml(product.checkoutUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(product.actionLabel || "Buy now") + '</a>'
          : '<p>Set a checkout link in the owner portal to enable checkout.</p>') +
        "</div>";
      container.appendChild(card);
    });
  }

  async function loadStaticProducts() {
    try {
      var response = await fetch(productsFileUrl, { cache: "no-store" });
      if (!response.ok) {
        return false;
      }

      var products = await response.json();
      if (!Array.isArray(products)) {
        return false;
      }

      renderProducts(products);
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }

  function ensureShopLink() {
    if (!commerceConfig.enabled) {
      return;
    }

    var hasShopLink = document.querySelector('a[href*="shop"], a[href*="products"]');
    if (hasShopLink) {
      return;
    }

    var footer = document.querySelector("footer") || document.body;
    if (!footer) {
      return;
    }

    var body = document.body;
    var shopPath = body ? text(body.getAttribute("data-curb-shop-path")) : "";

    var wrapper = document.createElement("p");
    wrapper.style.marginTop = "1rem";
    wrapper.innerHTML = '<a href="' + (shopPath || text(commerceConfig.shopPath) || "./shop/") + '">Shop</a>';
    footer.appendChild(wrapper);
  }

  async function loadPageContent() {
    activatePreviewSessionFromUrl();

    if (hasPreviewSession()) {
      applyPageOverrides(readPreviewPageFields());
      ensureShopLink();
      return;
    }

    if (!cmsConfig.enabled || !hasFirebaseConfig()) {
      ensureShopLink();
      return;
    }

    var db = getDb();
    if (!db) {
      ensureShopLink();
      return;
    }

    try {
      var slug = getSiteSlug();
      if (!slug) {
        ensureShopLink();
        return;
      }

      var pageSnapshot = await db
        .collection("sites")
        .doc(slug)
        .collection("pages")
        .doc(getPageKey())
        .get();

      if (pageSnapshot.exists) {
        var data = pageSnapshot.data() || {};
        if (data.fields && typeof data.fields === "object") {
          applyPageOverrides(data.fields);
        }
      }

      ensureShopLink();
    } catch (error) {
      console.error("Failed to load managed page content", error);
      ensureShopLink();
    }
  }

  async function loadProducts() {
    activatePreviewSessionFromUrl();

    if (hasPreviewSession()) {
      renderProducts(readPreviewProducts());
      return;
    }

    var container = document.querySelector("[data-curb-products]");
    if (!container) {
      return;
    }

    if (await loadStaticProducts()) {
      return;
    }

    if (!commerceConfig.enabled || !hasFirebaseConfig()) {
      return;
    }

    var db = getDb();
    if (!db) {
      return;
    }

    try {
      var slug = getSiteSlug();
      if (!slug) {
        return;
      }

      var snapshot = await db
        .collection("sites")
        .doc(slug)
        .collection("products")
        .orderBy("position")
        .get();

      var products = [];
      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        products.push(data);
      });
      renderProducts(products);
    } catch (error) {
      console.error("Failed to load managed products", error);
    }
  }

  function boot() {
    activatePreviewSessionFromUrl();
    loadPageContent();
    loadProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
