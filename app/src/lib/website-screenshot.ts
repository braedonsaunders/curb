import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const AUDIT_SCREENSHOTS_DIR = path.resolve(
  process.cwd(),
  "public",
  "audit-screenshots"
);

export interface ReachabilityResult {
  reachable: boolean;
  finalUrl: string | null;
  isSsl: boolean;
}

export interface WebsiteScreenshot {
  relativePath: string;
  publicUrl: string;
  absolutePath: string;
  finalUrl: string;
  pageTitle: string | null;
  mediaType: "image/jpeg";
  base64: string;
  pageSignals: WebsitePageSignals;
}

export interface WebsitePageSignals {
  navLinkCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  formCount: number;
  buttonCount: number;
  headingSamples: string[];
  detectedFeatures: string[];
}

function buildCandidateUrls(url: string): string[] {
  const trimmed = url.trim();
  if (!trimmed) return [];

  if (/^https?:\/\//i.test(trimmed)) {
    return [trimmed];
  }

  return [`https://${trimmed}`, `http://${trimmed}`];
}

export async function resolveReachableUrl(
  rawUrl: string
): Promise<ReachabilityResult> {
  const candidates = buildCandidateUrls(rawUrl);

  for (const candidate of candidates) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(candidate, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok && response.status >= 500) {
        continue;
      }

      const finalUrl = response.url || candidate;
      return {
        reachable: true,
        finalUrl,
        isSsl: finalUrl.startsWith("https://"),
      };
    } catch {
      continue;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return {
    reachable: false,
    finalUrl: candidates[0] ?? null,
    isSsl: false,
  };
}

export async function captureWebsiteScreenshot(
  url: string,
  slug: string
): Promise<WebsiteScreenshot> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1280 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(
      () => undefined
    );
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));

    const dir = path.join(AUDIT_SCREENSHOTS_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${Date.now()}.jpg`;
    const absolutePath = path.join(dir, fileName);
    const relativePath = path.posix.join("audit-screenshots", slug, fileName);
    const publicUrl = `/${relativePath}`;
    const finalUrl = page.url() || url;
    const pageTitle = (await page.title()) || null;
    const finalOrigin = (() => {
      try {
        return new URL(finalUrl).origin;
      } catch {
        return "";
      }
    })();
    const pageSignals = await page.evaluate((origin) => {
      const normalizeText = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const bodyText = normalizeText(document.body?.innerText);
      const links = Array.from(document.querySelectorAll("a[href]"));
      const buttons = Array.from(
        document.querySelectorAll("button, input[type='submit'], input[type='button']")
      );
      const linkInfos = links.map((link) => {
        const href = link.getAttribute("href") ?? "";
        const text = normalizeText(link.textContent);
        return { href, text };
      });

      const internalLinkCount = linkInfos.filter(({ href }) => {
        if (!href || href.startsWith("#")) {
          return false;
        }

        if (href.startsWith("/")) {
          return true;
        }

        try {
          return origin ? new URL(href, origin).origin === origin : false;
        } catch {
          return false;
        }
      }).length;

      const externalLinkCount = linkInfos.filter(({ href }) => {
        if (!href) {
          return false;
        }

        if (href.startsWith("mailto:") || href.startsWith("tel:")) {
          return false;
        }

        try {
          return origin ? new URL(href, origin).origin !== origin : href.startsWith("http");
        } catch {
          return href.startsWith("http");
        }
      }).length;

      const navLinkCount = document.querySelectorAll(
        "nav a[href], header a[href]"
      ).length;
      const formCount = document.forms.length;
      const buttonCount = buttons.length;
      const headingSamples = Array.from(
        document.querySelectorAll("h1, h2, h3")
      )
        .map((heading) => normalizeText(heading.textContent))
        .filter(Boolean)
        .slice(0, 8);

      const haystack = [
        bodyText,
        ...linkInfos.map(({ href, text }) => `${text} ${href}`),
        ...buttons.map((button) =>
          normalizeText(
            button instanceof HTMLInputElement ? button.value : button.textContent
          )
        ),
      ]
        .join(" ")
        .toLowerCase();

      const includesAny = (terms: string[]) =>
        terms.some((term) => haystack.includes(term));

      const detectedFeatures: string[] = [];

      if (
        includesAny([
          "add to cart",
          "cart",
          "checkout",
          "shop now",
          "shop all",
          "product",
          "woocommerce",
          "shopify",
        ])
      ) {
        detectedFeatures.push("online store");
      }

      if (
        includesAny([
          "book now",
          "book online",
          "appointment",
          "appointments",
          "reserve",
          "reservation",
          "schedule",
          "booking",
        ])
      ) {
        detectedFeatures.push("appointment booking");
      }

      if (
        includesAny([
          "login",
          "log in",
          "sign in",
          "my account",
          "member",
          "portal",
          "dashboard",
        ])
      ) {
        detectedFeatures.push("customer portal");
      }

      if (
        includesAny([
          "request quote",
          "get quote",
          "estimate",
          "application",
          "apply now",
        ]) ||
        formCount > 1
      ) {
        detectedFeatures.push("advanced lead capture");
      }

      if (
        document.querySelector(
          "iframe[src*='maps'], iframe[src*='google.com/maps']"
        )
      ) {
        detectedFeatures.push("embedded map");
      }

      if (
        document.querySelector(
          "video, iframe[src*='youtube'], iframe[src*='youtu.be'], iframe[src*='vimeo']"
        )
      ) {
        detectedFeatures.push("video or rich media");
      }

      if (internalLinkCount >= 20 || navLinkCount >= 8) {
        detectedFeatures.push("large multi-page navigation");
      }

      return {
        navLinkCount,
        internalLinkCount,
        externalLinkCount,
        formCount,
        buttonCount,
        headingSamples,
        detectedFeatures,
      };
    }, finalOrigin);

    const screenshotBuffer = await page.screenshot({
      type: "jpeg",
      quality: 75,
      fullPage: false,
      animations: "disabled",
    });

    fs.writeFileSync(absolutePath, screenshotBuffer);
    return {
      relativePath,
      publicUrl,
      absolutePath,
      finalUrl,
      pageTitle,
      mediaType: "image/jpeg",
      base64: screenshotBuffer.toString("base64"),
      pageSignals,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
