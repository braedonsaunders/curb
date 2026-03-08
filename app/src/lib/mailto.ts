export interface MailtoDraft {
  toAddress: string | null | undefined;
  subject: string | null | undefined;
  body: string | null | undefined;
}

export function getMailtoRecipient(
  value: string | null | undefined
): string | null {
  const recipient = value?.trim() ?? "";
  return recipient.length > 0 ? recipient : null;
}

export function buildMailtoUrl({
  toAddress,
  subject,
  body,
}: MailtoDraft): string | null {
  const recipient = getMailtoRecipient(toAddress);
  if (!recipient) {
    return null;
  }

  const params = new URLSearchParams();
  const trimmedSubject = subject?.trim() ?? "";
  const normalizedBody = (body ?? "").replace(/\r?\n/g, "\r\n");

  if (trimmedSubject) {
    params.set("subject", trimmedSubject);
  }

  if (normalizedBody) {
    params.set("body", normalizedBody);
  }

  const query = params.toString();
  return `mailto:${encodeURIComponent(recipient)}${query ? `?${query}` : ""}`;
}
