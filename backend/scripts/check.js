const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../');
const required = [
  'database/schema.sql', 'backend/src/routes/index.js', 'backend/src/routes/authRoutes.js',
  'backend/src/services/authService.js', 'frontend/src/main.jsx',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing required project file: ${file}`);
}
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
for (const token of ['users_email_unique', 'invoices_one_per_subscription_period', 'password_resets', 'payments_invoice_idx']) {
  if (!schema.includes(token)) throw new Error(`Schema is missing required contract: ${token}`);
}
const contracts = [
  ['database/schema.sql', ['token_version INTEGER NOT NULL DEFAULT 0', 'discount_id BIGINT REFERENCES discounts(id)']],
  ['backend/src/middleware/auth.js', ['payload.tokenVersion !== user.token_version']],
  ['backend/src/routes/usersRoutes.js', ["req.user.role === 'staff' ? 'customer'"]],
  ['frontend/src/components/UI.jsx', ['onPageChange', 'Showing {first}–{last} of {total}']],
];
for (const [file, tokens] of contracts) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${file} is missing required contract: ${token}`);
  }
}
console.log('Brightloop source contract checks passed.');
