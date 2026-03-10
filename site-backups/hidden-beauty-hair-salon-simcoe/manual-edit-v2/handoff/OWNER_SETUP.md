# Owner Setup Checklist

Use this when handing the site to the customer.

## 1. Customer-Owned Accounts

Ask the customer to create and own:

1. A Firebase project
2. A Stripe account
3. Their domain or DNS records

## 2. Firebase

1. Enable Firebase Hosting
2. Enable Firestore in production mode
3. Enable Authentication with Email Link sign-in
4. Add the final site domain and preview domain to Authentication authorized domains
5. Deploy `handoff/firestore.rules` and `handoff/firestore.indexes.json`

## 3. Site Config

Update `assets/curb-site-config.js` with:

- Firebase API key
- Auth domain
- Project ID
- App ID
- Storage bucket if used
- Messaging sender ID if used
- Owner email
- Stripe Payment Links for each product

## 4. First Login

1. Customer visits `/admin/`
2. Customer signs in with their owner email
3. The owner portal creates the site record automatically on first login
4. Customer edits page content and publishes products

## 5. Recommended Commercial Offer

- One-time design/build fee
- Optional launch/setup fee for Firebase + DNS + Stripe configuration
- Optional monthly support plan only if the customer explicitly wants ongoing help

Default positioning: customer-owned stack, not agency-owned hosting.
