import fs from "fs";
import path from "path";
import { chromium, type BrowserContext } from "playwright";
import { resolveReachableUrl } from "./website-screenshot";

const HTML_LIKE_EXTENSIONS = new Set([
  "",
  ".html",
  ".htm",
  ".php",
  ".asp",
  ".aspx",
  ".jsp",
  ".cfm",
]);
const DEFAULT_MAX_PAGES = 25;
const MAX_TEXT_LENGTH_PER_PAGE = 20000;

type CrawlOptions = {
  maxPages?: number;
  siteDir?: string;
};

type CrawledPage = {
  url: string;
  localPath: string;
  title: string | null;
  description: string | null;
  headings: string[];
  navLinks: Array<{ text: string; href: string }>;
  callToActions: string[];
  forms: Array<{
    action: string | null;
    method: string | null;
    fields: string[];
  }>;
  images: Array<{ src: string; alt: string }>;
  detectedFeatures: string[];
  textContent: string;
  colorPalette: string[];
  backgroundPalette: string[];
  fontFamilies: string[];
  logoCandidates: string[];
};

export interface WebsiteSourceSnapshot {
  requestedUrl: string;
  finalUrl: string;
  pageCount: number;
  pages: CrawledPage[];
  brand: {
    colorPalette: string[];
    backgroundPalette: string[];
    fontFamilies: string[];
    logoCandidates: string[];
  };
}

export interface WebsiteMirrorResult extends WebsiteSourceSnapshot {
  savedFiles: string[];
}

function getPathExtension(lastSegment: string): string {
  const match = lastSegment.match(/\.[^./]+$/);
  return match ? match[0].toLowerCase() : "";
}

function isMirrorablePageUrl(url: URL): boolean {
  if (!/^https?:$/i.test(url.protocol)) {
    return false;
  }

  if (url.search) {
    return false;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1) ?? "";
  const extension = getPathExtension(lastSegment);
  return HTML_LIKE_EXTENSIONS.has(extension);
}

function toLogicalPagePath(urlValue: string): string | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  if (!isMirrorablePageUrl(url)) {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 0) {
    return "index.html";
  }

  const lastSegment = segments.at(-1) ?? "";
  const extension = getPathExtension(lastSegment);
  if (extension) {
    segments[segments.length - 1] = lastSegment.slice(0, -extension.length);
  }

  const cleanSegments = segments.filter(Boolean);
  return cleanSegments.length === 0
    ? "index.html"
    : path.posix.join(...cleanSegments, "index.html");
}

function toFilesystemPath(siteDir: string, urlValue: string): string {
  const logicalPath = toLogicalPagePath(urlValue);
  if (!logicalPath) {
    throw new Error(`Cannot determine local path for URL: ${urlValue}`);
  }

  return path.join(siteDir, ...logicalPath.split("/"));
}

function normalizePageUrl(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type PageExtractionPayload = {
  finalUrl: string;
  html: string;
  discoveredPageUrls: string[];
  title: string | null;
  description: string | null;
  headings: string[];
  navLinks: Array<{ text: string; href: string }>;
  callToActions: string[];
  forms: Array<{
    action: string | null;
    method: string | null;
    fields: string[];
  }>;
  images: Array<{ src: string; alt: string }>;
  detectedFeatures: string[];
  textContent: string;
  colorPalette: string[];
  backgroundPalette: string[];
  fontFamilies: string[];
  logoCandidates: string[];
};

async function extractPage(
  context: BrowserContext,
  pageUrl: string,
  browserBaseUrl: string
): Promise<PageExtractionPayload | null> {
  const page = await context.newPage();
  try {
    const response = await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      return null;
    }

    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(
      () => undefined
    );
    await page.waitForTimeout(1500);

    const extracted = await page.evaluate(
      ({ rootUrl, maxTextLength }) => {
        const htmlLikeExtensions = new Set([
          "",
          ".html",
          ".htm",
          ".php",
          ".asp",
          ".aspx",
          ".jsp",
          ".cfm",
        ]);

        const normalizeText = (value: string | null | undefined): string =>
          (value ?? "").replace(/\s+/g, " ").trim();

        const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

        const getPathExtension = (pathname: string): string => {
          const match = pathname.match(/\.[^./]+$/);
          return match ? match[0].toLowerCase() : "";
        };

        const absolutizeUrl = (rawValue: string | null): string | null => {
          if (!rawValue) {
            return null;
          }

          const trimmed = rawValue.trim();
          if (
            !trimmed ||
            trimmed.startsWith("#") ||
            trimmed.startsWith("mailto:") ||
            trimmed.startsWith("tel:") ||
            trimmed.startsWith("javascript:") ||
            trimmed.startsWith("data:")
          ) {
            return trimmed;
          }

          try {
            return new URL(trimmed, document.baseURI).toString();
          } catch {
            return trimmed;
          }
        };

        const toLogicalPagePath = (urlValue: string): string | null => {
          let url: URL;
          try {
            url = new URL(urlValue);
          } catch {
            return null;
          }

          if (url.origin !== location.origin || url.search) {
            return null;
          }

          const segments = url.pathname
            .split("/")
            .filter(Boolean)
            .map((segment) => decodeURIComponent(segment));
          const lastSegment = segments.at(-1) ?? "";
          const extension = getPathExtension(lastSegment);

          if (!htmlLikeExtensions.has(extension)) {
            return null;
          }

          if (extension && segments.length > 0) {
            segments[segments.length - 1] = lastSegment.slice(
              0,
              -extension.length
            );
          }

          const cleanSegments = segments.filter(Boolean);
          return cleanSegments.length === 0
            ? "index.html"
            : `${cleanSegments.join("/")}/index.html`;
        };

        const toRelativePageHref = (fromUrlValue: string, toUrlValue: string): string => {
          const fromPath = toLogicalPagePath(fromUrlValue) ?? "index.html";
          const toPath = toLogicalPagePath(toUrlValue);
          if (!toPath) {
            return toUrlValue;
          }

          const fromParts = fromPath.split("/");
          fromParts.pop();
          const toParts = toPath.split("/");

          let commonIndex = 0;
          while (
            commonIndex < fromParts.length &&
            commonIndex < toParts.length &&
            fromParts[commonIndex] === toParts[commonIndex]
          ) {
            commonIndex += 1;
          }

          const up = fromParts.slice(commonIndex).map(() => "..");
          const down = toParts.slice(commonIndex);
          let relativePath = [...up, ...down].join("/");
          if (!relativePath) {
            relativePath = "index.html";
          }

          if (relativePath === "index.html") {
            relativePath = "./";
          } else if (relativePath.endsWith("/index.html")) {
            relativePath = relativePath.slice(0, -"index.html".length);
          }

          try {
            const targetUrl = new URL(toUrlValue);
            if (targetUrl.hash) {
              relativePath += targetUrl.hash;
            }
          } catch {
            // Ignore hash extraction when the URL cannot be parsed.
          }

          return relativePath;
        };

        const absolutizeSrcset = (value: string | null): string | null => {
          if (!value) {
            return value;
          }

          return value
            .split(",")
            .map((part) => {
              const trimmed = part.trim();
              if (!trimmed) {
                return trimmed;
              }

              const tokens = trimmed.split(/\s+/);
              const candidate = tokens.shift();
              if (!candidate) {
                return trimmed;
              }

              const absolute = absolutizeUrl(candidate);
              return [absolute ?? candidate, ...tokens].join(" ");
            })
            .join(", ");
        };

        const absolutizeCssUrls = (cssText: string): string =>
          cssText.replace(
            /url\((['"]?)([^'")]+)\1\)/gi,
            (_full, quote: string, rawValue: string) => {
              const absolute = absolutizeUrl(rawValue);
              if (!absolute) {
                return `url(${quote}${rawValue}${quote})`;
              }
              return `url(${quote}${absolute}${quote})`;
            }
          );

        const tagName = (element: Element): string =>
          element.tagName.toLowerCase();

        document.querySelector("base")?.remove();

        for (const element of Array.from(document.querySelectorAll("[style]"))) {
          const styleValue = element.getAttribute("style");
          if (styleValue) {
            element.setAttribute("style", absolutizeCssUrls(styleValue));
          }
        }

        for (const styleTag of Array.from(document.querySelectorAll("style"))) {
          if (styleTag.textContent) {
            styleTag.textContent = absolutizeCssUrls(styleTag.textContent);
          }
        }

        const discoveredPageUrls = new Set<string>();
        const currentPageUrl = location.href;

        for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
          const rawHref = anchor.getAttribute("href");
          const absoluteHref = absolutizeUrl(rawHref);
          if (!absoluteHref) {
            continue;
          }

          try {
            const targetUrl = new URL(absoluteHref, currentPageUrl);
            const sameOrigin = targetUrl.origin === location.origin;
            const logicalTargetPath = toLogicalPagePath(targetUrl.toString());
            const sameDocumentTarget =
              targetUrl.pathname === location.pathname &&
              targetUrl.search === location.search;

            if (sameOrigin && logicalTargetPath) {
              if (!sameDocumentTarget) {
                discoveredPageUrls.add(
                  `${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`
                );
              }

              anchor.setAttribute(
                "href",
                sameDocumentTarget && targetUrl.hash
                  ? targetUrl.hash
                  : toRelativePageHref(currentPageUrl, targetUrl.toString())
              );
            } else {
              anchor.setAttribute("href", targetUrl.toString());
            }
          } catch {
            anchor.setAttribute("href", absoluteHref);
          }
        }

        for (const element of Array.from(document.querySelectorAll("[src]"))) {
          const rawValue = element.getAttribute("src");
          const absoluteValue = absolutizeUrl(rawValue);
          if (absoluteValue) {
            element.setAttribute("src", absoluteValue);
          }
        }

        for (const element of Array.from(document.querySelectorAll("[href]"))) {
          if (tagName(element) === "a") {
            continue;
          }

          const rawValue = element.getAttribute("href");
          const absoluteValue = absolutizeUrl(rawValue);
          if (absoluteValue) {
            element.setAttribute("href", absoluteValue);
          }
        }

        for (const element of Array.from(document.querySelectorAll("[action]"))) {
          const rawValue = element.getAttribute("action");
          const absoluteValue = absolutizeUrl(rawValue);
          if (absoluteValue) {
            element.setAttribute("action", absoluteValue);
          }
        }

        for (const element of Array.from(document.querySelectorAll("[poster]"))) {
          const rawValue = element.getAttribute("poster");
          const absoluteValue = absolutizeUrl(rawValue);
          if (absoluteValue) {
            element.setAttribute("poster", absoluteValue);
          }
        }

        for (const element of Array.from(document.querySelectorAll("[srcset]"))) {
          const rawValue = element.getAttribute("srcset");
          const absoluteValue = absolutizeSrcset(rawValue);
          if (absoluteValue) {
            element.setAttribute("srcset", absoluteValue);
          }
        }

        const navLinks = Array.from(
          document.querySelectorAll("nav a[href], header a[href]")
        )
          .map((anchor) => ({
            text: normalizeText(anchor.textContent),
            href: anchor.getAttribute("href") ?? "",
          }))
          .filter((entry) => entry.text || entry.href)
          .slice(0, 40);

        const callToActions = Array.from(
          document.querySelectorAll("a, button, input[type='submit'], input[type='button']")
        )
          .map((element) =>
            normalizeText(
              element instanceof HTMLInputElement
                ? element.value
                : element.textContent
            )
          )
          .filter(Boolean)
          .slice(0, 40);

        const forms = Array.from(document.forms)
          .map((form) => ({
            action: absolutizeUrl(form.getAttribute("action")),
            method: form.getAttribute("method"),
            fields: Array.from(
              form.querySelectorAll("label, input, select, textarea, button")
            )
              .map((field) => {
                if (field instanceof HTMLInputElement) {
                  return normalizeText(
                    field.getAttribute("aria-label") ??
                      field.getAttribute("placeholder") ??
                      field.name ??
                      field.id
                  );
                }

                if (field instanceof HTMLTextAreaElement) {
                  return normalizeText(
                    field.getAttribute("aria-label") ??
                      field.getAttribute("placeholder") ??
                      field.name ??
                      field.id
                  );
                }

                if (field instanceof HTMLSelectElement) {
                  return normalizeText(
                    field.getAttribute("aria-label") ??
                      field.name ??
                      field.id
                  );
                }

                return normalizeText(field.textContent);
              })
              .filter(Boolean)
              .slice(0, 20),
          }))
          .slice(0, 10);

        const images = Array.from(document.images)
          .map((image) => ({
            src: absolutizeUrl(image.currentSrc || image.src) ?? "",
            alt: normalizeText(image.alt),
          }))
          .filter((entry) => entry.src)
          .slice(0, 24);

        const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
          .map((heading) => normalizeText(heading.textContent))
          .filter(Boolean)
          .slice(0, 24);

        const bodyText = normalizeText(document.body?.innerText).slice(
          0,
          maxTextLength
        );
        const haystack = [
          bodyText,
          ...navLinks.map((entry) => `${entry.text} ${entry.href}`),
          ...callToActions,
          ...forms.flatMap((form) => form.fields),
        ]
          .join(" ")
          .toLowerCase();
        const includesAny = (terms: string[]) =>
          terms.some((term) => haystack.includes(term));

        const detectedFeatures: string[] = [];

        if (
          includesAny([
            "shop",
            "add to cart",
            "cart",
            "checkout",
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

        if (document.querySelector("iframe[src*='maps']")) {
          detectedFeatures.push("embedded map");
        }

        if (
          document.querySelector(
            "video, iframe[src*='youtube'], iframe[src*='vimeo']"
          )
        ) {
          detectedFeatures.push("video or rich media");
        }

        const colorCounts = new Map<string, number>();
        const backgroundCounts = new Map<string, number>();
        const fontCounts = new Map<string, number>();

        for (const element of Array.from(
          document.querySelectorAll("body, header, nav, main, section, footer, h1, h2, h3, p, a, button")
        )) {
          const style = window.getComputedStyle(element);

          const color = normalizeText(style.color);
          if (color && color !== "rgba(0, 0, 0, 0)") {
            colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
          }

          const background = normalizeText(style.backgroundColor);
          if (background && background !== "rgba(0, 0, 0, 0)") {
            backgroundCounts.set(
              background,
              (backgroundCounts.get(background) ?? 0) + 1
            );
          }

          const fontFamily = normalizeText(style.fontFamily);
          if (fontFamily) {
            fontCounts.set(fontFamily, (fontCounts.get(fontFamily) ?? 0) + 1);
          }
        }

        const sortCounts = (entries: Map<string, number>) =>
          Array.from(entries.entries())
            .sort((left, right) => right[1] - left[1])
            .map(([value]) => value);

        const logoCandidates = unique(
          Array.from(
            document.querySelectorAll(
              "header img, nav img, a[aria-label*='logo' i] img, img[alt*='logo' i], img[src*='logo' i]"
            )
          )
            .map((image) =>
              image instanceof HTMLImageElement
                ? absolutizeUrl(image.currentSrc || image.src) ?? ""
                : ""
            )
            .filter(Boolean)
        ).slice(0, 12);

        const doctype = document.doctype
          ? `<!DOCTYPE ${document.doctype.name}>`
          : "<!DOCTYPE html>";

        const rootAbsoluteUrl = absolutizeUrl(rootUrl);
        if (rootAbsoluteUrl) {
          discoveredPageUrls.add(rootAbsoluteUrl);
        }

        return {
          finalUrl: location.href,
          html: `${doctype}\n${document.documentElement.outerHTML}`,
          discoveredPageUrls: Array.from(discoveredPageUrls).slice(0, 80),
          title: normalizeText(document.title) || null,
          description:
            normalizeText(
              document
                .querySelector("meta[name='description']")
                ?.getAttribute("content")
            ) || null,
          headings,
          navLinks,
          callToActions,
          forms,
          images,
          detectedFeatures,
          textContent: bodyText,
          colorPalette: sortCounts(colorCounts).slice(0, 8),
          backgroundPalette: sortCounts(backgroundCounts).slice(0, 8),
          fontFamilies: sortCounts(fontCounts).slice(0, 6),
          logoCandidates,
        };
      },
      {
        rootUrl: browserBaseUrl,
        maxTextLength: MAX_TEXT_LENGTH_PER_PAGE,
      }
    );

    return extracted;
  } finally {
    await page.close();
  }
}

async function crawlWebsite(
  rawUrl: string,
  options: CrawlOptions = {}
): Promise<WebsiteMirrorResult> {
  const reachability = await resolveReachableUrl(rawUrl);
  if (!reachability.reachable || !reachability.finalUrl) {
    throw new Error(`Website could not be reached: ${rawUrl}`);
  }

  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const rootUrl = new URL(reachability.finalUrl);
  const rootPageUrl = normalizePageUrl(reachability.finalUrl);
  if (!rootPageUrl) {
    throw new Error(`Website URL could not be normalized: ${reachability.finalUrl}`);
  }

  const queue: string[] = [rootPageUrl];
  const seen = new Set<string>();
  const queued = new Set<string>(queue);
  const pages: CrawledPage[] = [];
  const savedFiles: string[] = [];
  const colorCounts = new Map<string, number>();
  const backgroundCounts = new Map<string, number>();
  const fontCounts = new Map<string, number>();
  const logoCounts = new Map<string, number>();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1280 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });

  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const nextUrl = queue.shift();
      if (!nextUrl) {
        continue;
      }

      queued.delete(nextUrl);

      let normalizedUrl: URL;
      try {
        normalizedUrl = new URL(nextUrl);
      } catch {
        continue;
      }

      if (normalizedUrl.origin !== rootUrl.origin) {
        continue;
      }

      const logicalPath = toLogicalPagePath(normalizedUrl.toString());
      if (!logicalPath) {
        continue;
      }

      if (seen.has(normalizedUrl.toString())) {
        continue;
      }
      seen.add(normalizedUrl.toString());

      const extracted = await extractPage(
        context,
        normalizedUrl.toString(),
        reachability.finalUrl
      );
      if (!extracted) {
        continue;
      }

      const filesystemPath =
        options.siteDir == null
          ? logicalPath
          : path.relative(
              options.siteDir,
              toFilesystemPath(options.siteDir, extracted.finalUrl)
            );

      pages.push({
        url: extracted.finalUrl,
        localPath: filesystemPath,
        title: extracted.title,
        description: extracted.description,
        headings: extracted.headings,
        navLinks: extracted.navLinks,
        callToActions: extracted.callToActions,
        forms: extracted.forms,
        images: extracted.images,
        detectedFeatures: extracted.detectedFeatures,
        textContent: extracted.textContent,
        colorPalette: extracted.colorPalette,
        backgroundPalette: extracted.backgroundPalette,
        fontFamilies: extracted.fontFamilies,
        logoCandidates: extracted.logoCandidates,
      });

      for (const color of extracted.colorPalette) {
        colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      }

      for (const background of extracted.backgroundPalette) {
        backgroundCounts.set(
          background,
          (backgroundCounts.get(background) ?? 0) + 1
        );
      }

      for (const fontFamily of extracted.fontFamilies) {
        fontCounts.set(fontFamily, (fontCounts.get(fontFamily) ?? 0) + 1);
      }

      for (const logo of extracted.logoCandidates) {
        logoCounts.set(logo, (logoCounts.get(logo) ?? 0) + 1);
      }

      if (options.siteDir) {
        const outputPath = toFilesystemPath(options.siteDir, extracted.finalUrl);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, extracted.html, "utf-8");
        savedFiles.push(outputPath);
      }

      for (const discoveredUrl of extracted.discoveredPageUrls) {
        if (pages.length + queue.length >= maxPages) {
          break;
        }

        try {
          const candidate = new URL(discoveredUrl);
          if (candidate.origin !== rootUrl.origin) {
            continue;
          }

          const normalizedCandidate = normalizePageUrl(candidate.toString());
          if (!normalizedCandidate) {
            continue;
          }

          if (!toLogicalPagePath(normalizedCandidate)) {
            continue;
          }

          if (
            !seen.has(normalizedCandidate) &&
            !queued.has(normalizedCandidate)
          ) {
            queued.add(normalizedCandidate);
            queue.push(normalizedCandidate);
          }
        } catch {
          continue;
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const summarizeCounts = (counts: Map<string, number>, limit: number): string[] =>
    Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([value]) => value)
      .slice(0, limit);

  const snapshot: WebsiteMirrorResult = {
    requestedUrl: rawUrl,
    finalUrl: reachability.finalUrl,
    pageCount: pages.length,
    pages,
    brand: {
      colorPalette: summarizeCounts(colorCounts, 8),
      backgroundPalette: summarizeCounts(backgroundCounts, 8),
      fontFamilies: summarizeCounts(fontCounts, 6),
      logoCandidates: summarizeCounts(logoCounts, 12),
    },
    savedFiles,
  };

  if (options.siteDir) {
    const entryPage = pages[0];
    if (entryPage && entryPage.localPath !== "index.html") {
      const indexSuffix = "index.html";
      const entryHref = entryPage.localPath.endsWith("index.html")
        ? entryPage.localPath.slice(0, -indexSuffix.length) || "./"
        : entryPage.localPath;
      const redirectHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=${entryHref}" />
    <title>Redirecting...</title>
    <script>
      window.location.replace(${JSON.stringify(entryHref)});
    </script>
  </head>
  <body>
    <p><a href="${entryHref}">Open mirrored homepage</a></p>
  </body>
</html>`;
      const rootIndexPath = path.join(options.siteDir, "index.html");
      fs.writeFileSync(rootIndexPath, redirectHtml, "utf-8");
      savedFiles.push(rootIndexPath);
    }

    const manifestPath = path.join(options.siteDir, "__source_snapshot.json");
    fs.writeFileSync(manifestPath, JSON.stringify(snapshot, null, 2), "utf-8");
    savedFiles.push(manifestPath);
  }

  return snapshot;
}

export async function captureWebsiteSourceSnapshot(
  rawUrl: string,
  options: Omit<CrawlOptions, "siteDir"> = {}
): Promise<WebsiteSourceSnapshot> {
  const snapshot = await crawlWebsite(rawUrl, options);
  return {
    requestedUrl: snapshot.requestedUrl,
    finalUrl: snapshot.finalUrl,
    pageCount: snapshot.pageCount,
    pages: snapshot.pages,
    brand: snapshot.brand,
  };
}

export async function mirrorWebsiteToDirectory(
  rawUrl: string,
  siteDir: string,
  options: Omit<CrawlOptions, "siteDir"> = {}
): Promise<WebsiteMirrorResult> {
  return crawlWebsite(rawUrl, {
    ...options,
    siteDir,
  });
}
