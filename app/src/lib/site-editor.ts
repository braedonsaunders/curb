import fs from "fs";
import path from "path";

import { getDb } from "@/lib/db";
import { initializeDatabase } from "@/lib/schema";

const SITES_ROOT = path.resolve(process.cwd(), "..", "sites");
const SITE_BACKUPS_ROOT = path.resolve(process.cwd(), "..", "site-backups");

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".md",
  ".mjs",
  ".svg",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".css": "css",
  ".csv": "plaintext",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".map": "json",
  ".md": "markdown",
  ".mjs": "javascript",
  ".svg": "xml",
  ".text": "plaintext",
  ".toml": "ini",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".txt": "plaintext",
  ".webmanifest": "json",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

type GeneratedSiteRow = {
  id: number;
  slug: string;
  version: number;
  site_path: string;
  created_at: string;
};

export type SiteEditorFileNode = {
  type: "file";
  name: string;
  path: string;
  size: number;
  isText: boolean;
  language: string;
};

export type SiteEditorDirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: SiteEditorTreeNode[];
};

export type SiteEditorTreeNode =
  | SiteEditorFileNode
  | SiteEditorDirectoryNode;

export type ResolvedGeneratedSite = GeneratedSiteRow & {
  siteDir: string;
};

export class SiteEditorError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SiteEditorError";
    this.status = status;
  }
}

function isWithinDirectory(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function resolveSiteDirFromSlug(siteSlug: string): string {
  const trimmedSlug = String(siteSlug).trim();
  if (!trimmedSlug) {
    throw new SiteEditorError("A site slug is required.", 400);
  }

  const siteDir = path.resolve(SITES_ROOT, trimmedSlug);
  if (!isWithinDirectory(siteDir, SITES_ROOT)) {
    throw new SiteEditorError("Invalid site slug.", 400);
  }

  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new SiteEditorError("Generated site directory is missing.", 404);
  }

  return siteDir;
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = path.posix.normalize(
    relativePath.replaceAll("\\", "/").replace(/^\/+/, "")
  );

  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new SiteEditorError("Invalid site file path.", 400);
  }

  return normalized;
}

function getLanguageForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

function isLikelyTextFile(filePath: string, buffer: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return !buffer.subarray(0, 8000).includes(0);
}

function resolveSitePath(siteDir: string, relativePath: string): {
  normalizedPath: string;
  absolutePath: string;
} {
  const normalizedPath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(siteDir, normalizedPath);

  if (!isWithinDirectory(absolutePath, siteDir)) {
    throw new SiteEditorError("Requested file is outside the site directory.", 400);
  }

  return { normalizedPath, absolutePath };
}

function buildTreeNode(siteDir: string, absolutePath: string): SiteEditorTreeNode {
  const stat = fs.statSync(absolutePath);
  const relativePath = path.relative(siteDir, absolutePath).replaceAll("\\", "/");
  const name = path.basename(absolutePath);

  if (stat.isDirectory()) {
    const children = fs
      .readdirSync(absolutePath)
      .sort((left, right) => left.localeCompare(right))
      .map((entry) => buildTreeNode(siteDir, path.join(absolutePath, entry)))
      .sort((left, right) => {
        if (left.type === right.type) {
          return left.name.localeCompare(right.name);
        }

        return left.type === "directory" ? -1 : 1;
      });

    return {
      type: "directory",
      name,
      path: relativePath,
      children,
    };
  }

  const buffer = fs.readFileSync(absolutePath);

  return {
    type: "file",
    name,
    path: relativePath,
    size: stat.size,
    isText: isLikelyTextFile(absolutePath, buffer),
    language: getLanguageForPath(relativePath),
  };
}

export function getLatestGeneratedSiteForBusiness(
  businessId: number
): ResolvedGeneratedSite {
  initializeDatabase();
  const db = getDb();

  const site = db
    .prepare(
      "SELECT id, slug, version, site_path, created_at FROM generated_sites WHERE business_id = ? ORDER BY version DESC LIMIT 1"
    )
    .get(businessId) as GeneratedSiteRow | undefined;

  if (!site) {
    throw new SiteEditorError("No generated site exists for this business.", 404);
  }

  const siteDir = path.resolve(process.cwd(), "..", site.site_path);

  if (!isWithinDirectory(siteDir, SITES_ROOT)) {
    throw new SiteEditorError("Generated site path is invalid.", 500);
  }

  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new SiteEditorError("Generated site directory is missing.", 404);
  }

  return {
    ...site,
    siteDir,
  };
}

export function getLatestGeneratedSiteForSlug(
  siteSlug: string
): ResolvedGeneratedSite {
  const normalizedSlug = String(siteSlug).trim();
  if (!normalizedSlug) {
    throw new SiteEditorError("A site slug is required.", 400);
  }

  initializeDatabase();
  const db = getDb();

  const site = db
    .prepare(
      "SELECT id, slug, version, site_path, created_at FROM generated_sites WHERE slug = ? ORDER BY version DESC LIMIT 1"
    )
    .get(normalizedSlug) as GeneratedSiteRow | undefined;

  if (site) {
    const siteDir = path.resolve(process.cwd(), "..", site.site_path);
    if (
      isWithinDirectory(siteDir, SITES_ROOT) &&
      fs.existsSync(siteDir) &&
      fs.statSync(siteDir).isDirectory()
    ) {
      return {
        ...site,
        siteDir,
      };
    }
  }

  const siteDir = resolveSiteDirFromSlug(normalizedSlug);
  const stat = fs.statSync(siteDir);

  return {
    id: 0,
    slug: normalizedSlug,
    version: 0,
    site_path: path
      .relative(path.resolve(process.cwd(), ".."), siteDir)
      .replaceAll("\\", "/"),
    created_at: stat.mtime.toISOString(),
    siteDir,
  };
}

export function listSiteFiles(siteDir: string): SiteEditorTreeNode[] {
  return fs
    .readdirSync(siteDir)
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => buildTreeNode(siteDir, path.join(siteDir, entry)))
    .sort((left, right) => {
      if (left.type === right.type) {
        return left.name.localeCompare(right.name);
      }

      return left.type === "directory" ? -1 : 1;
    });
}

export function readSiteTextFile(siteDir: string, relativePath: string): {
  path: string;
  content: string;
  language: string;
  size: number;
  modifiedAt: string;
} {
  const { normalizedPath, absolutePath } = resolveSitePath(siteDir, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new SiteEditorError("Site file not found.", 404);
  }

  const buffer = fs.readFileSync(absolutePath);
  if (!isLikelyTextFile(absolutePath, buffer)) {
    throw new SiteEditorError("This file is binary and cannot be edited here.", 400);
  }

  const stat = fs.statSync(absolutePath);

  return {
    path: normalizedPath,
    content: buffer.toString("utf-8"),
    language: getLanguageForPath(normalizedPath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function ensureSiteBackup(site: ResolvedGeneratedSite): {
  backupPath: string;
  created: boolean;
} {
  const backupPath = path.join(
    SITE_BACKUPS_ROOT,
    site.slug,
    `manual-edit-v${site.version}`
  );

  if (fs.existsSync(backupPath)) {
    return { backupPath, created: false };
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.cpSync(site.siteDir, backupPath, {
    recursive: true,
    dereference: true,
    force: false,
    errorOnExist: false,
  });

  return { backupPath, created: true };
}

export function writeSiteTextFile(
  siteDir: string,
  relativePath: string,
  content: string
): {
  path: string;
  size: number;
  modifiedAt: string;
} {
  const { normalizedPath, absolutePath } = resolveSitePath(siteDir, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new SiteEditorError("Site file not found.", 404);
  }

  const existingBuffer = fs.readFileSync(absolutePath);
  if (!isLikelyTextFile(absolutePath, existingBuffer)) {
    throw new SiteEditorError("This file is binary and cannot be edited here.", 400);
  }

  fs.writeFileSync(absolutePath, content, "utf-8");
  const stat = fs.statSync(absolutePath);

  return {
    path: normalizedPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function writeSiteBinaryFile(
  siteDir: string,
  relativePath: string,
  content: Buffer
): {
  path: string;
  size: number;
  modifiedAt: string;
} {
  const { normalizedPath, absolutePath } = resolveSitePath(siteDir, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new SiteEditorError("Site file not found.", 404);
  }

  const existingBuffer = fs.readFileSync(absolutePath);
  if (isLikelyTextFile(absolutePath, existingBuffer)) {
    throw new SiteEditorError(
      "This file is text-based. Use the editor to update it.",
      400
    );
  }

  fs.writeFileSync(absolutePath, content);
  const stat = fs.statSync(absolutePath);

  return {
    path: normalizedPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}
