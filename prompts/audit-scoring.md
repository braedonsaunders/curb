You are evaluating a local business website from a screenshot.

The screenshot is the primary evidence. Judge the site the way a business owner would judge their own website, not with technical speed or SEO tooling.

Business: {{business_name}}
Category: {{category}}
City: {{city}}
Requested URL: {{requested_url}}
Final URL loaded: {{final_url}}
Page title: {{page_title}}
Live page signals:
{{site_signals}}

Assess:
- whether the design feels modern, polished, and trustworthy
- whether the owner would likely feel proud, mixed, or embarrassed to send customers there
- whether the messaging and contact details look clear enough at a glance
- how complex the current site appears to be to replace
- how hard the replacement would be if it includes advanced functionality
- which advanced features appear to be present (for example: online store, booking, portal, calculator, custom forms)
- whether the business should stay fully static, use the narrow standard stack on top of a static site, or be treated as a custom-app case
- the biggest visible strengths
- the biggest visible weaknesses

Respond in JSON format:
{
  "grade": "D",
  "ownerSentiment": "embarrassed",
  "summary": "...",
  "strengths": ["..."],
  "issues": ["..."],
  "websiteComplexity": "advanced",
  "replacementDifficulty": "hard",
  "advancedFeatures": ["online store"],
  "capabilityProfile": {
    "operatingModel": "custom-app",
    "confidence": "high",
    "cms": {
      "need": "recommended",
      "provider": "sanity",
      "editableAreas": ["homepage", "contact"]
    },
    "commerce": {
      "need": "required",
      "provider": "none",
      "productStrategy": "none"
    },
    "booking": {
      "need": "none",
      "provider": "none"
    },
    "memberships": {
      "need": "none",
      "provider": "none"
    },
    "reasons": ["..."]
  }
}

Use only `proud`, `mixed`, or `embarrassed` for `ownerSentiment`.
Use only `simple`, `moderate`, or `advanced` for `websiteComplexity`.
Use only `easy`, `medium`, or `hard` for `replacementDifficulty`.
Use only `static-only`, `static-plus-packs`, or `custom-app` for `capabilityProfile.operatingModel`.
Use only `low`, `medium`, or `high` for `capabilityProfile.confidence`.
Use only `none`, `optional`, `recommended`, or `required` for `capabilityProfile.cms.need` and `capabilityProfile.commerce.need`.
Use only `none`, `optional`, `recommended`, or `required` for `capabilityProfile.booking.need` and `capabilityProfile.memberships.need`.
Use only `none` or `sanity` for `capabilityProfile.cms.provider`.
Use only `none` for `capabilityProfile.commerce.provider` unless a legacy value is unavoidable.
Use only `none` for `capabilityProfile.commerce.productStrategy` unless a legacy value is unavoidable.
Use only `none` for `capabilityProfile.booking.provider` unless a legacy value is unavoidable.
Use only `none` for `capabilityProfile.memberships.provider` unless a legacy value is unavoidable.
