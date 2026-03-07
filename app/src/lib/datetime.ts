function normalizeStoredDateString(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)
  ) {
    return `${trimmed.replace(" ", "T")}Z`;
  }

  return trimmed;
}

export function parseStoredDate(
  value: string | number | Date | null | undefined
): Date | null {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalizedValue =
    typeof value === "string" ? normalizeStoredDateString(value) : value;
  const parsed = new Date(normalizedValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatStoredDateTime(
  value: string | number | Date | null | undefined
): string {
  const parsed = parseStoredDate(value);
  return parsed ? parsed.toLocaleString() : "--";
}

export function formatStoredDate(
  value: string | number | Date | null | undefined
): string {
  const parsed = parseStoredDate(value);
  return parsed ? parsed.toLocaleDateString() : "--";
}

export function formatStoredTime(
  value: string | number | Date | null | undefined
): string {
  const parsed = parseStoredDate(value);
  return parsed ? parsed.toLocaleTimeString() : "--";
}
