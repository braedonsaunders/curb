# Customer-Owned Handoff

This site was packaged for customer-owned hosting and customer-owned billing.

## Stack

- Public site: static files
- Owner portal: `/admin/`
- Content store: Firebase Auth + Firestore
- Commerce: Stripe Payment Links

## What You Should Hand Off

1. A Firebase project owned by the customer
2. A Firebase Hosting site owned by the customer
3. A Stripe account owned by the customer
4. The customer's domain account or DNS access

## Files In This Folder

- `firebase.json`: Hosting config
- `firestore.rules`: Firestore security rules template
- `firestore.indexes.json`: Firestore indexes file
- `OWNER_SETUP.md`: Exact customer setup checklist

## Ownership Model

The goal is one sale, one setup, then the customer runs their own stack.
Do not leave this running on your own Firebase, Stripe, or Shopify account unless you
intentionally want recurring hosting/support responsibility.
