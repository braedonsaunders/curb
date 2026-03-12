const LEGACY_ADMIN_ARTIFACT_PREFIXES = ["admin/"];

const LEGACY_ADMIN_ARTIFACT_PATHS = new Set([
  "assets/curb-admin-pack.css",
  "assets/curb-admin-pack.js",
  "assets/vendor/tabler.min.css",
  "assets/vendor/tabler.min.js",
  "handoff/OWNER_SETUP.md",
  "handoff/firebase.json",
  "handoff/firestore.indexes.json",
  "handoff/firestore.rules",
]);

const LEGACY_MANAGED_ARTIFACT_PATHS = new Set([
  ...LEGACY_ADMIN_ARTIFACT_PATHS,
  "assets/curb-cms-schema.json",
  "assets/curb-products.json",
  "assets/curb-public-pack.js",
]);

export function normalizeSiteArtifactPath(filePath: string): string {
  return String(filePath ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
}

export function isLegacyAdminArtifactPath(filePath: string): boolean {
  const normalized = normalizeSiteArtifactPath(filePath);

  return (
    LEGACY_ADMIN_ARTIFACT_PATHS.has(normalized) ||
    LEGACY_ADMIN_ARTIFACT_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  );
}

export function isLegacyManagedArtifactPath(filePath: string): boolean {
  const normalized = normalizeSiteArtifactPath(filePath);

  return (
    LEGACY_MANAGED_ARTIFACT_PATHS.has(normalized) ||
    LEGACY_ADMIN_ARTIFACT_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  );
}

export function isLegacyAdminRequestPath(segments: string[]): boolean {
  const normalized = normalizeSiteArtifactPath(
    segments.filter(Boolean).join("/")
  );

  if (!normalized) {
    return false;
  }

  const [, ...siteRelativeSegments] = normalized.split("/");
  return isLegacyAdminArtifactPath(siteRelativeSegments.join("/"));
}

