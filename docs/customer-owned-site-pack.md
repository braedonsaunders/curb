# Customer-Owned Site Pack

This is the default operating model for Curb when a sold website needs light
owner edits and optional lightweight commerce without turning the agency into
the long-term hosting bottleneck.

## Decision Tree

Choose `static-only` when:

- The site is a brochure site
- Content will rarely change
- No product catalog or recurring updates are needed

Choose `static-plus-cms` when:

- The owner needs to update copy, links, images, or simple supporting pages
- The site has recurring content such as services, specials, events, menus, or
  announcements
- The public site should still stay cheap, static, and easy to hand off

Choose `static-plus-cms-and-store` when:

- The owner needs a lightweight product catalog
- Each product can sell through a direct Stripe or Shopify checkout link
- Cart, inventory, shipping logic, subscriptions, or account dashboards are not
  required

Choose `custom-app` when:

- The source site has login/member/portal behavior
- The customer needs carts, account dashboards, complex checkout, subscriptions,
  shipping workflows, inventory management, or multi-step back office logic
- The business expects the storefront to behave like software, not like a
  static site with structured product cards

## Standard Stack

- Public site: static HTML bundle
- Owner portal: `/admin/` inside the same site bundle
- Auth: Firebase Email Link sign-in
- Content store: Firestore
- Commerce: Stripe Payment Links or Shopify checkout links
- Hosting: customer-owned Firebase Hosting or other static hosting

## What You Sell

Base package:

- Discovery and redesign
- Static site build
- Launch-ready exported bundle
- Customer-owned handoff docs

Launch package:

- Firebase project setup
- Firestore/Auth/Hosting setup
- Domain cutover
- Owner login setup
- Initial Stripe or Shopify product link hookup

Optional support package:

- Monthly edits
- Quarterly refreshes
- Conversion improvements
- Product upload help
- Emergency support

Default position:

- The customer owns the stack
- You are not the required long-term operator
- Ongoing support is optional, not structurally required

## Handoff Checklist

1. Customer owns the Firebase account
2. Customer owns the Stripe or Shopify account
3. Customer owns the domain or DNS
4. Customer receives the exported site bundle
5. `assets/curb-site-config.js` is filled with the customer's Firebase config
6. Firestore rules and indexes are deployed
7. Customer signs in to `/admin/`
8. Customer confirms at least one successful content edit
9. If store pack is enabled, customer confirms at least one working checkout
   link

## Red Flags

Do not sell the lightweight pack as if it were a full ecommerce or portal
solution. Escalate to `custom-app` when the customer is really buying software.
