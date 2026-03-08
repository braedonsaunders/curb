export function normalizeEmailRecord(email: Record<string, unknown>) {
  return {
    ...email,
    businessId: email.business_id,
    businessName: email.business_name,
    businessCategory: email.business_category,
    toAddress: email.to_address,
    createdAt: email.created_at,
    sentAt: email.sent_at,
  };
}
