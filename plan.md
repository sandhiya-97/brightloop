# Brightloop Subscription Management — implementation plan

## Scope and approach

Build one integrated, Windows-friendly, local-first application: React + Vite frontend, Node.js + Express REST API, PostgreSQL 18 schema, JWT auth, bcrypt password hashing, Zod server validation, and Nodemailer with a console-only reset-link fallback. Keep the API grouped into feature routes, use dedicated auth and billing services for the security/reset and transactional recurring-charge workflows, and parameterize SQL throughout. Use real rows from PostgreSQL; never use fake dashboard JSON. Keep the Vite browser-facing API paths relative and proxy `/api` to the Express server in development.

The relational schema is the four-person team's integration contract. Admin-only management is enforced server-side. Customer authorization always scopes database reads and writes to the authenticated customer's user ID. Quotations and subscriptions snapshot plan name, price, billing period, plan tax, and lifecycle options so catalog edits do not rewrite a contract. Billing creates an invoice and advances a subscription inside one transaction; the unique `(subscription_id, period_start)` key protects retries/races. Partial payments are allowed; invoice status changes to Paid only once applied payments reach the total. Overdue is computed from confirmed status, balance, and due date. Pauses skip billing and move the next bill date forward by elapsed paused days. Tax percentages are copied onto invoice lines to preserve historical amounts.

The vertical slice is designed around this flow: signup/login → plan/catalog → subscription/quotation → billing invoice → payment → dashboard. Authentication, catalog and operations pages are included in one cohesive interface; exact business operations are API-backed. Email delivery is optional local configuration; if SMTP is unavailable, reset URLs are printed to the server console. Credentials, SMTP values, and `DATABASE_URL` remain local environment configuration, never frontend values.

## Project structure

- `database/schema.sql`: PostgreSQL tables, constraints, foreign keys, and query indexes.
- `backend/src/config`: environment and pool setup.
- `backend/src/middleware`: authentication, role authorization, validation, error handling and rate limits.
- `backend/src/routes`: REST endpoint declarations grouped by domain.
- `backend/src/controllers`: HTTP request/response parsing.
- `backend/src/services`: transactions and business rules for auth, catalog, subscriptions, billing, payments, and dashboard.
- `backend/src/utils`: shared date/number/token helpers.
- `backend/scripts`: repeatable migration and local demo seed commands.
- `frontend/src`: routed React app, auth screens, shared shell/components, API client and pages.
- `public/manus-routes.json`: declared browser page routes.

## Design

Three plausible styles (tail-sampled design options):
- **Swiss Editorial Ledger — 0.07**: warm ivory canvas, ink typography, and crisp blue-green ledger accents.
- **Neo-Brutalist Revenue Console — 0.04**: high-contrast blocks, hard outlines, and playful oversized numerals.
- **Soft Glass SaaS — 0.02**: translucent panels, pastel glows, and rounded cards.

Chosen: **Swiss Editorial Ledger**.

- **Design Movement:** Contemporary Swiss editorial design translated into a practical finance console.
- **Core Principles:** Strong typographic hierarchy; tabular numbers; restrained ornament; clear active/overdue state contrast.
- **Color Philosophy:** Warm paper and graphite make dense finance data comfortable to scan; deep teal is an ownable action color; amber and coral are reserved for attention states.
- **Layout Paradigm:** Persistent narrow left rail with a broad content canvas; tables and summaries align to a baseline rather than floating card grids.
- **Signature Elements:** Fine ledger rules; pill-shaped state labels; tiny square teal brand marks suggesting linked recurring cycles.
- **Interaction Philosophy:** Direct, predictable controls; explicit confirmation for destructive and money-affecting actions; inline status feedback.
- **Animation:** Short 120–180 ms fades/position transitions only for navigation and expanding detail; honor reduced-motion settings; no perpetual movement.
- **Typography System:** Inter for application UI; IBM Plex Mono for identifiers and money. Large totals are tabular and semibold; table labels remain compact but readable.
- **Brand Essence:** The dependable subscription ledger for a growing software company; precise, calm, capable.
- **Brand Voice:** Clear and action-first. Example: “Renewals, reconciled.” “Every invoice has a next step.”
- **Wordmark & Logo:** Lowercase “brightloop” wordmark with two offset square dots forming a recurring loop before the name.
- **Signature Brand Color:** Deep teal `#147D73`.
