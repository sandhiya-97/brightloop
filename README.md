# Brightloop Subscription Management

A local-first subscription operations app for Brightloop Software. The stack is React + Vite, Node.js + Express, PostgreSQL 18, JWT sessions, bcrypt password hashing, Zod request validation, and Nodemailer for reset/invoice emails. The API is modular; billing is transactional and invoices use a database uniqueness constraint to prevent duplicate period charges.

## Windows 11 setup

Install Node.js 20+ and pnpm (`npm install --global pnpm`), and verify the local PostgreSQL 18 service is running. The existing hackathon setup already has `subscription_db`; if cloning on a fresh machine, create it in PowerShell only when it does not yet exist:

```powershell
# Run only on a fresh machine if subscription_db does not already exist:
psql -U postgres -c "CREATE DATABASE subscription_db;"
# Everyone should copy and edit the environment template:
Copy-Item .env.example .env
notepad .env
```

Set the PostgreSQL password and a random JWT secret in `.env`. Then, from the repository root:

```powershell
pnpm install
npm run migrate
npm run seed
npm run dev
```

Open `http://localhost:3000`. The API health endpoint is `http://localhost:4000/healthz`. `npm run migrate`, `npm run seed`, `npm run dev`, `npm run build`, and `npm run check` are also available. Production API start: `npm start`.

The Vite server proxies `/api` to Express. Configure `COOKIE_SECURE=false` and `COOKIE_SAME_SITE=lax` for local HTTP. For a public HTTPS deployment set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none`; never expose `JWT_SECRET`, SMTP credentials, or `DATABASE_URL` to browser code.

## Demo accounts

The seed command creates one Admin, Internal staff member, and Customer; credentials can be changed using the `SEED_*` variables in `.env`. Defaults for local demonstration only:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@brightloop.test` | `Brightloop!2026` |
| Staff | `staff@brightloop.test` | `Brightloop!2026` |
| Customer | `customer@brightloop.test` | `Brightloop!2026` |

Do not deploy with these demo passwords. Public signup always creates a customer; only an authenticated Admin can create staff.

## Password reset mail

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` to enable Nodemailer. If SMTP is not configured, the API prints the reset URL only outside production; production logs never contain reset tokens. The link expires after `RESET_TOKEN_MINUTES`, is stored only as a SHA-256 hash, and can be consumed once. Forgot-password responses do not reveal whether an email is registered. Resetting a password increments the account's token version, invalidating existing sessions. Passwords are limited to 72 UTF-8 bytes so bcrypt cannot silently treat different long inputs as the same password.

The API refuses to start unless `JWT_SECRET` is a non-placeholder value of at least 32 characters. Session cookies are HttpOnly and always Secure in production, even if `COOKIE_SECURE=false` is mistakenly left in the environment.

## Business rules encoded

- Partial payments are permitted. Payments are locked against the invoice during recording; overpayment is rejected; invoice status changes to Paid once the recorded total reaches the invoice total.
- Cancelling an unpaid invoice releases the usage count for its limited discount; sending is allowed only after the invoice is confirmed (or already paid).
- Amount owed and overdue views use confirmed invoices only; overdue is computed from a confirmed invoice, a due date earlier than today, and an unpaid balance.
- Pausing stops billing; resuming shifts the next bill date forward by the elapsed paused days.
- Quotations and subscriptions snapshot the plan name, price, billing period, and tax rate; invoice lines snapshot the applied tax and product prices so catalog edits do not rewrite an accepted contract or historical charge.
- The billing worker runs once at API startup and hourly when `DATABASE_URL` is configured, and `POST /api/invoices/run` triggers it manually. It catches up due periods in order (bounded to 36 periods per locked subscription per run), does not close a subscription before its final already-due period is billed, creates an invoice and advances its next billing date in one transaction, and uses unique `(subscription_id, period_start)` as the last duplicate guard.
- If an expiry date is present, renewal rolls the expiry forward when renewal is enabled; auto-close takes precedence. A nonrenewable subscription stops at its expiry. Without an expiry date, an active subscription continues until closed.
- Invoice periods are anchored to each scheduled billing date; month/year increments clamp to the last valid calendar day to avoid drift.

## Role scope and data access

Admin can manage the catalog, taxes, discounts, quotations/templates, users and all finance operations. Staff can view catalog data and manage subscriptions, quotations, invoices, and payments; only Admin can create staff or modify products/plans/taxes/discounts. Customer API queries are filtered to the authenticated user and ownership violations return 404 to avoid leaking other customers' records.

## Performance and schema

The schema uses foreign keys, check constraints, unique emails/subscription numbers, and the invoice-per-subscription-period unique constraint. Customer/status, due-date, next-bill, and payment indexes support common list and finance queries. Lists are paginated (default 25, maximum 100) with previous/next controls; finance cards use aggregate SQL rather than fetching all rows. Tax and discount list endpoints are also bounded and paginated. Use `EXPLAIN (ANALYZE, BUFFERS)` locally against representative seeded data before making a measured sub-two-second performance claim.

## API map

- `/api/auth`: signup, login, logout, current user, forgot/reset password
- `/api/users`: paginated users; Admin-only staff creation
- `/api/catalog`: products/variants, plans, taxes, discounts
- `/api/quotations`: templates, quotation creation/list/acceptance
- `/api/subscriptions`: create/list/detail, convert accepted quote, confirm/activate/pause/resume/close, switch add-ons
- `/api/invoices`: list/detail, billing run, confirm/cancel/send, payments, payment list
- `/api/dashboard`: finance aggregates and recent invoices

All errors follow `{ "error": "CODE", "message": "...", "field": null }`. All prices/amounts use PostgreSQL `NUMERIC`; SQL uses parameterized queries.
