export const NOT_APPLICABLE_STATUS = "skipped" as const;

export const BUSINESS_STATUSES = [
  "discovered",
  "audited",
  "flagged",
  "generated",
  "reviewed",
  "emailed",
  "sold",
  NOT_APPLICABLE_STATUS,
  "archived",
] as const;

export const BUSINESS_BOARD_COLUMNS = [
  "discovered",
  "audited",
  "flagged",
  "generated",
  "reviewed",
  "emailed",
  "sold",
  NOT_APPLICABLE_STATUS,
] as const;

const BUSINESS_STATUS_LABELS: Record<string, string> = {
  discovered: "Discovered",
  audited: "Audited",
  flagged: "Flagged",
  generated: "Generated",
  reviewed: "Reviewed",
  emailed: "Emailed",
  sold: "Sold",
  [NOT_APPLICABLE_STATUS]: "Not Applicable",
  archived: "Archived",
};

export function getBusinessStatusLabel(status: string): string {
  return (
    BUSINESS_STATUS_LABELS[status] ??
    status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}
