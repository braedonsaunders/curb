import type { Config } from "./config";

export type CloudflareAccountPoolEntry = {
  accountId: string;
  apiToken: string;
  customerProductionBranch: string;
  label: string;
  previewProjectName: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLabel(value: unknown, fallback: string): string {
  return text(value) || fallback;
}

function normalizeAccountEntry(
  value: unknown,
  index: number
): CloudflareAccountPoolEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const accountId = text(source.accountId);
  const apiToken = text(source.apiToken);

  if (!accountId || !apiToken) {
    return null;
  }

  return {
    accountId,
    apiToken,
    customerProductionBranch: text(source.customerProductionBranch) || "production",
    label: normalizeLabel(source.label, `account-${index + 1}`),
    previewProjectName: text(source.previewProjectName),
  };
}

export function getCloudflareAccountPool(
  config: Config
): CloudflareAccountPoolEntry[] {
  const pooledEntries = (() => {
    const raw = text(config.cloudflareAccountsJson);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry, index) => normalizeAccountEntry(entry, index))
        .filter((entry): entry is CloudflareAccountPoolEntry => entry !== null);
    } catch {
      return [];
    }
  })();

  if (pooledEntries.length > 0) {
    return pooledEntries;
  }

  const primaryAccount = normalizeAccountEntry(
    {
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
      customerProductionBranch: config.cloudflareCustomerProductionBranch,
      label: "primary",
      previewProjectName: config.cloudflarePreviewProjectName,
    },
    0
  );

  return primaryAccount ? [primaryAccount] : [];
}

export function selectCloudflarePreviewAccount(
  config: Config
): CloudflareAccountPoolEntry | null {
  const pool = getCloudflareAccountPool(config);
  return (
    pool.find((entry) => text(entry.previewProjectName).length > 0) ?? pool[0] ?? null
  );
}

export function selectCloudflareCustomerAccount(
  config: Config,
  businessId: number,
  stickyAccountId?: string | null,
  stickyLabel?: string | null
): CloudflareAccountPoolEntry | null {
  const pool = getCloudflareAccountPool(config);
  if (pool.length === 0) {
    return null;
  }

  const sticky = pool.find(
    (entry) =>
      (stickyAccountId && entry.accountId === text(stickyAccountId)) ||
      (stickyLabel && entry.label === text(stickyLabel))
  );
  if (sticky) {
    return sticky;
  }

  const index = Math.abs(Number(businessId) || 0) % pool.length;
  return pool[index] ?? pool[0] ?? null;
}
