# Curb

**Automated local business website prospecting pipeline.**

Find local businesses with no website or a bad one, generate a custom replacement using AI, and pitch it to them with a live preview.

---

## Overview

Curb is a local-first monorepo tool that runs a five-stage pipeline:

1. **Discover** — Find local businesses via Google Places API
2. **Audit** — Score their existing web presence (or lack thereof)
3. **Generate** — Build a custom static site using Claude's API
4. **Preview** — Serve generated sites locally for review
5. **Outreach** — Draft CASL-compliant emails with the preview link

The tool runs as a Next.js app on `localhost`. Generated sites are self-contained static HTML files that can be exported and handed off to customers as a deliverable.

---

## Architecture

### Monorepo Structure

```
curb/
├── app/                          # Next.js dashboard (local tool)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                # Dashboard home — pipeline stats, recent activity
│   │   │   ├── discover/
│   │   │   │   └── page.tsx            # Search UI — location, radius, category inputs, map
│   │   │   ├── businesses/
│   │   │   │   ├── page.tsx            # Pipeline kanban/list view
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx        # Business detail — data, audit, site, emails
│   │   │   ├── sites/
│   │   │   │   ├── page.tsx            # Gallery of generated sites
│   │   │   │   └── [slug]/
│   │   │   │       └── page.tsx        # Site preview with iframe + actions
│   │   │   ├── outreach/
│   │   │   │   └── page.tsx            # Email queue — drafts, approved, sent
│   │   │   └── settings/
│   │   │       └── page.tsx            # API keys, defaults, templates
│   │   ├── api/
│   │   │   ├── discover/
│   │   │   │   └── route.ts            # POST — run discovery for location/category
│   │   │   ├── audit/
│   │   │   │   └── route.ts            # POST — audit a business or batch
│   │   │   ├── generate/
│   │   │   │   └── route.ts            # POST — generate site for a business
│   │   │   ├── outreach/
│   │   │   │   └── route.ts            # POST — generate email draft
│   │   │   ├── export/
│   │   │   │   └── route.ts            # GET — zip and download a site for handoff
│   │   │   └── businesses/
│   │   │       └── route.ts            # CRUD for business records
│   │   ├── components/
│   │   │   ├── BusinessCard.tsx
│   │   │   ├── PipelineKanban.tsx
│   │   │   ├── SitePreview.tsx
│   │   │   ├── AuditScoreCard.tsx
│   │   │   ├── EmailDraftEditor.tsx
│   │   │   ├── DiscoverMap.tsx
│   │   │   └── ExportButton.tsx
│   │   └── lib/
│   │       ├── core/                   # Pipeline logic
│   │       │   ├── discover.ts
│   │       │   ├── audit.ts
│   │       │   ├── generate.ts
│   │       │   ├── outreach.ts
│   │       │   └── export.ts
│   │       ├── db.ts                   # SQLite client (better-sqlite3)
│   │       ├── schema.ts              # Database schema + migrations
│   │       ├── claude.ts              # Claude API wrapper
│   │       ├── places.ts             # Google Places API wrapper
│   │       └── config.ts             # Env + settings loader
│   ├── public/
│   └── package.json
├── sites/                             # Generated static sites (gitignored)
│   ├── joes-pizza-hamilton/
│   │   ├── index.html
│   │   └── assets/
│   │       └── photos/
│   ├── maple-leaf-plumbing/
│   │   ├── index.html
│   │   └── assets/
│   │       └── photos/
│   └── ...
├── prompts/                           # Claude system prompts
│   ├── site-generation.md             # Main site generation prompt
│   ├── email-outreach.md             # Email drafting prompt
│   └── audit-scoring.md             # Website quality scoring prompt
├── curb.db                           # SQLite database
├── .env.local                        # API keys (not committed)
├── .env.example                      # Template
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── README.md
```

### Tech Stack

| Layer         | Technology                        |
| ------------- | --------------------------------- |
| Framework     | Next.js 15 (App Router)          |
| Language      | TypeScript                        |
| UI            | Tailwind CSS + shadcn/ui          |
| Database      | SQLite via better-sqlite3         |
| AI            | Claude API (Anthropic SDK)        |
| Discovery     | Google Places API (New)           |
| Audit         | Google PageSpeed Insights API     |
| Maps          | Leaflet or Google Maps embed      |
| Export        | Archiver (zip generation)         |

No auth required. This is a local development tool — runs on `localhost:3000`.

---

## Database Schema

SQLite database at `./curb.db`.

### `businesses`

Core table. One row per discovered business.

```sql
CREATE TABLE businesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id      TEXT UNIQUE NOT NULL,          -- Google Places ID (dedup key)
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,          -- URL-safe name (e.g., "joes-pizza-hamilton")
  category      TEXT,                          -- Primary business type
  address       TEXT,
  city          TEXT,
  province      TEXT,
  postal_code   TEXT,
  phone         TEXT,
  email         TEXT,                          -- If discoverable
  website_url   TEXT,                          -- Their current site (nullable)
  google_maps_url TEXT,
  latitude      REAL,
  longitude     REAL,
  rating        REAL,                          -- Google rating
  review_count  INTEGER,
  hours_json    TEXT,                          -- JSON string of operating hours
  photos_json   TEXT,                          -- JSON array of photo references/local paths
  status        TEXT DEFAULT 'discovered',     -- Pipeline status (see below)
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
```

**Status values (pipeline stages):**
- `discovered` — Found via Google Places
- `audited` — Website scored
- `flagged` — Marked as needing a site (no site or bad score)
- `skipped` — Has a decent site, not pursuing
- `generated` — Site has been generated
- `reviewed` — You've reviewed the generated site
- `emailed` — Outreach email sent
- `responded` — Business owner replied
- `sold` — Deal closed
- `archived` — Dead lead

### `audits`

```sql
CREATE TABLE audits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id     INTEGER NOT NULL REFERENCES businesses(id),
  has_website     BOOLEAN NOT NULL,
  url_reachable   BOOLEAN,                    -- Does the URL actually load?
  is_ssl          BOOLEAN,
  is_mobile_friendly BOOLEAN,
  performance_score INTEGER,                  -- Lighthouse 0-100
  accessibility_score INTEGER,               -- Lighthouse 0-100
  seo_score       INTEGER,                   -- Lighthouse 0-100
  load_time_ms    INTEGER,
  overall_grade   TEXT,                       -- A/B/C/D/F computed grade
  notes           TEXT,                       -- Claude's qualitative assessment
  raw_json        TEXT,                       -- Full PageSpeed API response
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### `generated_sites`

```sql
CREATE TABLE generated_sites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id     INTEGER NOT NULL REFERENCES businesses(id),
  version         INTEGER DEFAULT 1,          -- Allows regeneration
  slug            TEXT NOT NULL,               -- Matches folder name in /sites
  site_path       TEXT NOT NULL,               -- Relative path to index.html
  prompt_used     TEXT,                        -- The full prompt sent to Claude
  model_used      TEXT,                        -- e.g., "claude-sonnet-4-20250514"
  generation_time_ms INTEGER,
  exported        BOOLEAN DEFAULT 0,          -- Has this been zipped and exported?
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### `emails`

```sql
CREATE TABLE emails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id     INTEGER NOT NULL REFERENCES businesses(id),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,               -- HTML email body
  to_address      TEXT,                        -- Recipient (if known)
  status          TEXT DEFAULT 'draft',        -- draft / approved / sent / bounced
  sent_at         TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### `discovery_runs`

```sql
CREATE TABLE discovery_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location_query  TEXT NOT NULL,               -- e.g., "Hamilton, ON"
  latitude        REAL,
  longitude       REAL,
  radius_km       INTEGER,
  categories      TEXT,                        -- Comma-separated
  results_count   INTEGER,
  new_count       INTEGER,                     -- After dedup
  created_at      TEXT DEFAULT (datetime('now'))
);
```

---

## Pipeline Logic

### Stage 1: Discover

**Input:** Location (string or lat/lng), radius (km), optional category filter.

**Process:**
1. Geocode the location string to lat/lng if needed (Google Geocoding API).
2. Call Google Places API (Nearby Search) with the location, radius, and optional `type` filter.
3. Paginate through all results (up to 60 per query via `next_page_token`).
4. For each result, extract: name, place_id, address, phone, website, hours, rating, reviews, photos.
5. Generate a slug from `{name}-{city}` (lowercase, hyphenated, deduplicated).
6. Upsert into `businesses` table — skip if `place_id` already exists.
7. Log the run to `discovery_runs`.

**Category mapping:** The UI should expose common categories as checkboxes:
- Restaurants & cafes
- Trades & contractors (plumber, electrician, HVAC, etc.)
- Salons & barbers
- Auto repair & detailing
- Retail & boutiques
- Professional services (lawyers, accountants, realtors)
- Health & wellness (chiropractor, physio, dentist)
- Fitness & gyms
- Pet services
- Cleaning services

These map to Google Places `type` values.

**Rate limits:** Google Places API allows ~1000 requests/day on the free tier. Batch discovery should track usage and warn before hitting limits.

### Stage 2: Audit

**Input:** A single business or batch of businesses with status `discovered`.

**Process:**
1. If `website_url` is NULL → score as `has_website: false`, overall grade `F`, auto-flag.
2. If `website_url` exists:
   a. Attempt to fetch the URL. If unreachable (timeout, DNS fail, 4xx/5xx) → flag and note.
   b. If reachable, call Google PageSpeed Insights API with the URL.
   c. Extract performance, accessibility, and SEO scores.
   d. Check for SSL, mobile-friendliness, load time.
   e. Compute overall grade:
      - **A (90-100):** Skip — they're fine.
      - **B (70-89):** Borderline — low priority.
      - **C (50-69):** Opportunity — their site is mediocre.
      - **D (30-49):** Strong opportunity — site is bad.
      - **F (0-29 or no site):** Prime target.
   f. Optionally: send the URL to Claude with the `audit-scoring.md` prompt for a qualitative roast ("This site uses Flash, has no mobile layout, and the contact form is broken").
3. Update business status to `audited`.
4. Auto-flag businesses with grade D or F → status becomes `flagged`.

**Grading formula:**
```
overall = (performance * 0.4) + (seo * 0.3) + (accessibility * 0.3)
if not mobile_friendly: overall -= 20
if not ssl: overall -= 10
```

### Stage 3: Generate

**Input:** A single `flagged` or `audited` business.

**Process:**
1. Gather all available data for the business: name, category, address, phone, hours, rating, reviews, photos.
2. If the business has Google Places photos, download them via the Places Photo API and save to `sites/{slug}/assets/photos/`.
3. Build the Claude prompt using `prompts/site-generation.md` as the system prompt, injecting the business data as user context.
4. Call Claude API (`claude-sonnet-4-20250514`) with the prompt.
5. Parse the response — expect a complete self-contained HTML file.
6. Write the HTML to `sites/{slug}/index.html`.
7. If photos were downloaded, ensure they're referenced with relative paths in the HTML.
8. Insert a record into `generated_sites`.
9. Update business status to `generated`.

**Site requirements (enforced via system prompt):**
- Single `index.html` file, fully self-contained
- All CSS inline or in a `<style>` block (no external stylesheets except Google Fonts)
- Mobile-first responsive design
- Sections: hero, about/services, hours, location/map embed, contact, reviews/testimonials
- Professional, modern aesthetic tailored to the business type
- No stock photos or placeholder images — use the actual Google Places photos or solid color/gradient backgrounds
- Google Maps embed for their location
- Click-to-call phone link
- Clean, semantic HTML
- Fast loading — no heavy JS frameworks
- Includes a small "Site by [your brand]" footer credit with link

**Regeneration:** The UI should allow you to click "Regenerate" with optional prompt tweaks. Each generation increments the `version` column.

### Stage 4: Preview & Export

**Preview:**
- The Next.js app serves the `sites/` directory statically.
- Accessing `localhost:3000/sites/joes-pizza-hamilton` renders the generated site in the browser.
- The dashboard's site detail page shows an iframe preview alongside metadata and action buttons.

**Export (customer handoff):**
- The `/api/export` route zips the entire `sites/{slug}/` directory (HTML + assets).
- Returns a downloadable `.zip` file named `{business-name}-website.zip`.
- The export button is prominent on the site detail page.
- The zip is self-contained — the customer (or you) can drop it on any hosting provider.
- Marks `exported: true` in the database.

### Stage 5: Outreach

**Input:** A business with status `generated` or `reviewed`.

**Process:**
1. Gather business data + the generated site preview URL.
2. Build the Claude prompt using `prompts/email-outreach.md`:
   - Reference the business by name
   - Mention specific details (their category, that they don't have a site / their current site's issues)
   - Include the local preview URL (or a deployed URL if you choose to deploy)
   - Propose the offering: one-time purchase for the site files, or ongoing hosting/maintenance
   - CASL compliance: identify yourself, include physical address, explain they can opt out
3. Call Claude API to generate the email.
4. Insert into `emails` table with status `draft`.
5. The outreach page shows all drafts for review.
6. You edit if needed, then mark as `approved`.
7. Copy the email body to send manually (Gmail, Outlook, etc.) or optionally wire up nodemailer/Gmail API later.
8. Mark as `sent` after sending, update business status to `emailed`.

**Email tone guidelines (in the system prompt):**
- Casual, direct, not salesy
- Lead with the value: "I noticed [business] doesn't have a website, so I built you one"
- The preview link is the hook — don't oversell, let the site speak
- Short — 4-6 sentences max
- CTA: "If you like it, I can get it live on a custom domain for you"
- No pressure, no urgency tactics

---

## Prompts

### `prompts/site-generation.md`

```markdown
You are a web designer creating a professional business website.

You will receive details about a local business including their name, type,
address, phone number, hours, reviews, and photos.

Generate a COMPLETE, self-contained HTML file for a single-page website.

Requirements:
- Single index.html file with all CSS in a <style> block
- Mobile-first responsive design
- Google Fonts loaded via <link> tag (pick fonts that suit the business type)
- Sections: Hero (business name + tagline), About/Services, Hours, Location
  (Google Maps iframe embed), Contact (click-to-call, email), Testimonials
  (from provided reviews)
- If photos are provided, reference them as relative paths: ./assets/photos/filename.jpg
- If no photos, use tasteful solid color/gradient backgrounds — never placeholder images
- Modern, clean, professional aesthetic appropriate to the business category
- Semantic HTML5
- Smooth scroll navigation
- Subtle CSS animations (fade-in, slide-up on scroll via IntersectionObserver)
- Footer with "Built by Curb" credit
- No JavaScript frameworks — vanilla JS only, minimal
- Must look like a real business website, not a template

Respond with ONLY the HTML file contents. No explanation, no markdown fences.
```

### `prompts/email-outreach.md`

```markdown
You are drafting a brief outreach email to a local business owner.

Context: You've built a free sample website for their business based on their
publicly available information. You want to offer it to them.

You will receive: business name, category, whether they have an existing website
(and its issues if so), and a preview URL for the site you built.

Write a short, friendly email (4-6 sentences max) that:
- Opens with something specific about their business (not generic)
- Mentions you noticed they don't have a website / their current site has issues
- Says you put together a sample site for them and links to the preview
- Offers to get it live on their own domain
- Keeps it casual and pressure-free
- Includes a simple sign-off

Also generate a subject line that would get opened (not spammy, not clickbait).

CASL compliance — the email MUST include:
- Your full name and business name
- Your physical mailing address
- A note that they can reply to opt out of further contact

Respond in JSON format:
{
  "subject": "...",
  "body": "..."
}
```

### `prompts/audit-scoring.md`

```markdown
You are evaluating a local business's website for quality.

You will receive a URL and basic information about the business.
Assess the website on:
- Visual design (modern vs outdated)
- Mobile responsiveness
- Content quality and completeness
- Load performance
- Trust signals (SSL, contact info, reviews)
- Overall professionalism

Provide a brief 2-3 sentence assessment and a letter grade (A-F).

Respond in JSON format:
{
  "grade": "D",
  "summary": "..."
}
```

---

## Dashboard Pages

### Home (`/`)

Overview dashboard showing:
- Pipeline funnel: counts at each status stage
- Recent activity feed (last 10 actions)
- Quick stats: total businesses, sites generated, emails sent, conversion rate
- Quick action buttons: "New Discovery", "Generate Next", "Review Drafts"

### Discover (`/discover`)

- Form: location input (text, geocoded), radius slider (1-50km), category checkboxes
- "Search" button triggers discovery
- Results appear on a map (pins) and as a list below
- Each result shows: name, category, address, has website (yes/no), rating
- Bulk select + "Add to Pipeline" button
- History of past discovery runs in a sidebar

### Businesses (`/businesses`)

- Default view: filterable, sortable table
  - Columns: name, category, city, status, audit grade, has site, actions
  - Filters: status dropdown, category, grade, date range
  - Sort: name, status, grade, date
- Toggle to kanban view grouped by status
- Click a row → business detail page

### Business Detail (`/businesses/[id]`)

- Header: business name, category, address, phone, rating, Google Maps link
- Tabs:
  - **Info** — All business data, hours, photos, reviews
  - **Audit** — Score breakdown, qualitative notes, link to their current site
  - **Site** — Iframe preview of generated site, version history, regenerate button, export/download button
  - **Outreach** — Email drafts, send history, status
- Status can be manually changed via dropdown
- Notes field for free-form tracking

### Sites (`/sites`)

- Grid/gallery of generated sites as thumbnail cards (screenshot or iframe thumbnail)
- Filter by status, category, date
- Click → full preview page with iframe + action bar (export, regenerate, open in new tab)

### Outreach (`/outreach`)

- Table of all email drafts
- Columns: business name, subject, status (draft/approved/sent), date
- Click to expand → full email preview with edit capability
- "Approve" and "Mark as Sent" buttons
- Bulk approve for batch workflows

### Settings (`/settings`)

- API keys: Google Places, Google PageSpeed, Anthropic (stored in `.env.local`, displayed masked)
- Defaults: home location, default radius, default categories
- Outreach: your name, business name, physical address (for CASL footer)
- Pricing: configurable pricing text to inject into emails (e.g., "$500 one-time" or "$50/mo hosting")
- Prompts: editable prompt templates (loads from `prompts/` directory, saveable)

---

## API Routes

All routes are Next.js Route Handlers. Used by the dashboard UI.

| Method | Route                     | Description                                    |
| ------ | ------------------------- | ---------------------------------------------- |
| POST   | `/api/discover`           | Run a discovery search. Body: location, radius, categories. Returns new businesses found. |
| POST   | `/api/audit`              | Audit a business. Body: `{ businessId }` or `{ batch: true }` for all discovered. |
| POST   | `/api/generate`           | Generate a site. Body: `{ businessId, promptOverride? }`. Returns site path. |
| POST   | `/api/outreach`           | Generate email draft. Body: `{ businessId }`. Returns draft. |
| GET    | `/api/export/[slug]`      | Download zipped site. Returns `.zip` file. |
| GET    | `/api/businesses`         | List businesses with filters. Query: status, category, grade, page, limit. |
| GET    | `/api/businesses/[id]`    | Get single business with related audits, sites, emails. |
| PATCH  | `/api/businesses/[id]`    | Update business status or notes. |
| DELETE | `/api/businesses/[id]`    | Archive a business. |
| GET    | `/api/emails`             | List all email drafts with filters. |
| PATCH  | `/api/emails/[id]`        | Update email content, status. |
| GET    | `/api/stats`              | Pipeline stats for dashboard home. |
| GET    | `/api/settings`           | Get current settings. |
| PUT    | `/api/settings`           | Update settings. |

---

## Configuration

### `.env.local`

```bash
# Google
GOOGLE_PLACES_API_KEY=
GOOGLE_PAGESPEED_API_KEY=          # Can be same key

# Anthropic
ANTHROPIC_API_KEY=

# Curb
CURB_DEFAULT_LOCATION="Hamilton, ON"
CURB_DEFAULT_RADIUS_KM=15
CURB_OWNER_NAME="Braedon"
CURB_BUSINESS_NAME=""
CURB_BUSINESS_ADDRESS=""
CURB_BUSINESS_EMAIL=""
CURB_SITE_BASE_URL="http://localhost:3000/sites"
```

---

## Export / Customer Handoff

When a business owner agrees to buy, the handoff process:

1. Click **Export** on the site detail page.
2. Curb zips the `sites/{slug}/` directory into `{business-name}-website.zip`.
3. The zip contains:
   - `index.html` — the complete site
   - `assets/photos/` — any downloaded images
   - `README.txt` — basic instructions ("Upload these files to your hosting provider, or we can host it for you")
4. You send the zip or upload it to their hosting.
5. Optionally: for hosting customers, you deploy to Vercel/Netlify/Cloudflare Pages under their domain and charge monthly.

The generated sites are designed to be **zero-dependency** — a customer can literally drag `index.html` into any web host and it works.

---

## CASL Compliance

Canada's Anti-Spam Legislation (CASL) requirements baked into the system:

1. **Implied consent for B2B**: Sending to a publicly listed business email about a service relevant to their business is permitted under CASL's implied consent provision. This is the legal basis.
2. **Sender identification**: Every email includes your full name, business name, and physical mailing address (pulled from settings).
3. **Unsubscribe mechanism**: Every email includes a clear opt-out statement ("Reply STOP to opt out of future contact").
4. **Record keeping**: The `emails` table logs all outreach with timestamps — required for CASL compliance records.
5. **No misleading subject lines**: The email prompt explicitly forbids clickbait or deceptive subjects.
6. **Relevance**: The email is directly relevant to the recipient's business operations (their web presence), which is a CASL requirement.

**What Curb does NOT do:**
- Send emails automatically without your review
- Scrape personal email addresses
- Contact businesses that have opted out (status: `archived` blocks outreach)

---

## Future Considerations

Not in the MVP, but worth noting for later:

- **Screenshot generation**: Use Puppeteer to auto-generate thumbnail screenshots of generated sites for the gallery view.
- **A/B site variants**: Generate 2-3 design variants per business and let the owner pick.
- **CRM integration**: Pipe leads into a proper CRM if volume grows.
- **Email sending**: Integrate nodemailer or Gmail API for send-from-dashboard.
- **Analytics**: Track if preview links get visited (simple hit counter).
- **Multi-page sites**: Expand from single-page to multi-page generation for premium tier.
- **Domain provisioning**: Auto-register domains via Namecheap/Cloudflare API.
- **Stripe checkout**: Let business owners pay directly from a link in the email.
- **Template library**: Build up a library of proven designs per business category.
- **Review enrichment**: Pull more reviews from Yelp, Facebook for richer testimonial sections.

---

## Development Plan

### Phase 1: Foundation
- [ ] Initialize Next.js project with TypeScript, Tailwind, shadcn/ui
- [ ] Set up SQLite database with schema and migration script
- [ ] Build settings page and config loader
- [ ] Build the Google Places API wrapper with discovery logic
- [ ] Build the discover page UI

### Phase 2: Audit Pipeline
- [ ] Build the PageSpeed Insights API wrapper
- [ ] Build the audit scoring logic and grading formula
- [ ] Build the business list/detail pages
- [ ] Connect audit results to business detail UI

### Phase 3: Site Generation
- [ ] Write and refine the site generation system prompt
- [ ] Build the Claude API wrapper with generation logic
- [ ] Build the photo download pipeline (Google Places Photos API)
- [ ] Set up static file serving for `sites/` directory
- [ ] Build the site preview and gallery pages
- [ ] Build the export/zip functionality

### Phase 4: Outreach
- [ ] Write the email generation prompt
- [ ] Build the email draft generation logic
- [ ] Build the outreach page with draft review/edit/approve flow
- [ ] Add CASL footer injection

### Phase 5: Polish
- [ ] Dashboard home with stats and activity feed
- [ ] Pipeline kanban view
- [ ] Bulk operations (batch audit, batch generate)
- [ ] Error handling and retry logic for all API calls
- [ ] Rate limit tracking and warnings
