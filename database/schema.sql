-- Brightloop Software subscription platform (PostgreSQL 18)
-- All monetary values are NUMERIC; the database enforces billing idempotency.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','staff','customer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_lowercase CHECK (email = LOWER(email)),
  CONSTRAINT users_email_nonempty CHECK (LENGTH(TRIM(email)) > 3)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS users_role_created_idx ON users(role, created_at DESC);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_resets_user_expiry_idx ON password_resets(user_id, expires_at);

CREATE TABLE IF NOT EXISTS tax_rates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate_percent NUMERIC(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  product_type TEXT NOT NULL CHECK (product_type IN ('service','goods','software')),
  sales_price NUMERIC(12,2) NOT NULL CHECK (sales_price >= 0),
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  notes TEXT,
  default_tax_rate_id BIGINT REFERENCES tax_rates(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_active_name_idx ON products(is_active, name);

CREATE TABLE IF NOT EXISTS product_variants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  price_delta NUMERIC(12,2) NOT NULL DEFAULT 0,
  sku TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT product_variants_unique UNIQUE(product_id, name, value)
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('daily','weekly','monthly','yearly')),
  minimum_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  default_tax_rate_id BIGINT REFERENCES tax_rates(id) ON DELETE SET NULL,
  available_from DATE,
  available_until DATE,
  auto_close BOOLEAN NOT NULL DEFAULT FALSE,
  closable_early BOOLEAN NOT NULL DEFAULT TRUE,
  pausable BOOLEAN NOT NULL DEFAULT FALSE,
  renewable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (available_until IS NULL OR available_from IS NULL OR available_until >= available_from)
);
CREATE INDEX IF NOT EXISTS plans_active_availability_idx ON plans(is_active, available_from, available_until);

CREATE TABLE IF NOT EXISTS plan_products (
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  default_quantity INTEGER NOT NULL DEFAULT 1 CHECK (default_quantity > 0),
  PRIMARY KEY (plan_id, product_id)
);

CREATE TABLE IF NOT EXISTS discounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percentage')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  minimum_purchase NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_purchase >= 0),
  minimum_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('products','subscription')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (discount_type <> 'percentage' OR amount <= 100),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (usage_limit IS NULL OR usage_count <= usage_limit)
);
CREATE INDEX IF NOT EXISTS discounts_active_dates_idx ON discounts(is_active, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS discount_products (
  discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(discount_id, product_id)
);

CREATE TABLE IF NOT EXISTS quotation_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  validity_days INTEGER NOT NULL CHECK (validity_days > 0),
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS quotation_template_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  template_id BIGINT REFERENCES quotation_templates(id) ON DELETE SET NULL,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  plan_name_snapshot TEXT NOT NULL,
  plan_price_snapshot NUMERIC(12,2) NOT NULL CHECK (plan_price_snapshot >= 0),
  billing_period_snapshot TEXT NOT NULL CHECK (billing_period_snapshot IN ('daily','weekly','monthly','yearly')),
  plan_tax_percent_snapshot NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (plan_tax_percent_snapshot BETWEEN 0 AND 100),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'quotation' CHECK (status IN ('quotation','accepted','rejected','expired')),
  valid_until DATE NOT NULL,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS plan_name_snapshot TEXT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS plan_price_snapshot NUMERIC(12,2);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS billing_period_snapshot TEXT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS plan_tax_percent_snapshot NUMERIC(7,4);
UPDATE quotations q SET plan_name_snapshot=COALESCE(q.plan_name_snapshot,p.name), plan_price_snapshot=COALESCE(q.plan_price_snapshot,p.price), billing_period_snapshot=COALESCE(q.billing_period_snapshot,p.billing_period), plan_tax_percent_snapshot=COALESCE(q.plan_tax_percent_snapshot,t.rate_percent,0) FROM plans p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id WHERE q.plan_id=p.id AND (q.plan_name_snapshot IS NULL OR q.plan_price_snapshot IS NULL OR q.billing_period_snapshot IS NULL OR q.plan_tax_percent_snapshot IS NULL);
ALTER TABLE quotations ALTER COLUMN plan_name_snapshot SET NOT NULL;
ALTER TABLE quotations ALTER COLUMN plan_price_snapshot SET NOT NULL;
ALTER TABLE quotations ALTER COLUMN billing_period_snapshot SET NOT NULL;
ALTER TABLE quotations ALTER COLUMN plan_tax_percent_snapshot SET NOT NULL;
CREATE INDEX IF NOT EXISTS quotations_customer_status_idx ON quotations(customer_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS quotation_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id BIGINT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_percent_snapshot NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_percent_snapshot BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS quotation_lines_quotation_idx ON quotation_lines(quotation_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  plan_name_snapshot TEXT NOT NULL,
  plan_price_snapshot NUMERIC(12,2) NOT NULL CHECK (plan_price_snapshot >= 0),
  billing_period_snapshot TEXT NOT NULL CHECK (billing_period_snapshot IN ('daily','weekly','monthly','yearly')),
  quotation_id BIGINT UNIQUE REFERENCES quotations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quotation','confirmed','active','paused','closed')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  plan_tax_percent_snapshot NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (plan_tax_percent_snapshot BETWEEN 0 AND 100),
  start_date DATE NOT NULL,
  expiry_date DATE,
  next_billing_date DATE,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  auto_close BOOLEAN NOT NULL DEFAULT FALSE,
  closable_early BOOLEAN NOT NULL DEFAULT TRUE,
  pausable BOOLEAN NOT NULL DEFAULT FALSE,
  renewable BOOLEAN NOT NULL DEFAULT TRUE,
  paused_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expiry_date IS NULL OR expiry_date >= start_date),
  CHECK (status <> 'paused' OR paused_at IS NOT NULL)
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_name_snapshot TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_price_snapshot NUMERIC(12,2);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_period_snapshot TEXT;
UPDATE subscriptions s SET plan_name_snapshot=COALESCE(s.plan_name_snapshot,p.name), plan_price_snapshot=COALESCE(s.plan_price_snapshot,p.price), billing_period_snapshot=COALESCE(s.billing_period_snapshot,p.billing_period) FROM plans p WHERE s.plan_id=p.id AND (s.plan_name_snapshot IS NULL OR s.plan_price_snapshot IS NULL OR s.billing_period_snapshot IS NULL);
ALTER TABLE subscriptions ALTER COLUMN plan_name_snapshot SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN plan_price_snapshot SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN billing_period_snapshot SET NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_customer_status_idx ON subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_status_next_billing_idx ON subscriptions(status, next_billing_date);
CREATE INDEX IF NOT EXISTS subscriptions_expiry_idx ON subscriptions(expiry_date) WHERE status IN ('active','confirmed');

CREATE TABLE IF NOT EXISTS subscription_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate_id BIGINT REFERENCES tax_rates(id) ON DELETE SET NULL,
  tax_percent_snapshot NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_percent_snapshot BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscription_lines_subscription_idx ON subscription_lines(subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_lines_unique_item_idx ON subscription_lines(subscription_id, product_id, COALESCE(variant_id, 0));

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  discount_id BIGINT REFERENCES discounts(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CONSTRAINT invoices_one_per_subscription_period UNIQUE(subscription_id, period_start)
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_id BIGINT REFERENCES discounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_customer_status_idx ON invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS invoices_due_status_idx ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS invoices_subscription_period_idx ON invoices(subscription_id, period_start DESC);
CREATE INDEX IF NOT EXISTS invoices_confirmed_due_idx ON invoices(due_date) WHERE status='confirmed';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  subscription_line_id BIGINT REFERENCES subscription_lines(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_percent_snapshot NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_percent_snapshot BETWEEN 0 AND 100),
  line_subtotal NUMERIC(12,2) NOT NULL CHECK (line_subtotal >= 0),
  line_tax NUMERIC(12,2) NOT NULL CHECK (line_tax >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','card','online','other')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON payments(paid_at);

-- Query-time overdue is confirmed + due_date < today + outstanding balance > 0.
COMMIT;
