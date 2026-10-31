const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { pagination } = require('../utils/helpers');
const router = express.Router();
const addStaffSchema = z.object({ email: z.string().email().max(254), fullName: z.string().trim().min(2).max(120), password: z.string().min(9).regex(/[A-Z]/).regex(/[a-z]/).regex(/[^A-Za-z0-9]/).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer') });

router.get('/', requireAuth, requireRole('admin','staff'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  if (req.user.role === 'staff' && req.query.role && req.query.role !== 'customer') {
    throw new AppError(403, 'FORBIDDEN', 'Staff can view customer accounts only');
  }
  // Staff always receive a customer-only query, even when no role filter is supplied.
  const role = req.user.role === 'staff' ? 'customer' : (req.query.role && ['admin','staff','customer'].includes(req.query.role) ? req.query.role : null);
  const values = role ? [role, limit, offset] : [limit, offset];
  const where = role ? 'WHERE role=$1' : '';
  const lim = role ? '$2' : '$1'; const off = role ? '$3' : '$2';
  const [rows, count] = await Promise.all([
    db.query(`SELECT id,email,full_name,role,is_active,created_at FROM users ${where} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, values),
    db.query(`SELECT COUNT(*)::int AS total FROM users ${where}`, role ? [role] : []),
  ]);
  res.json({ data: rows.rows.map(r => ({ ...r, fullName: r.full_name })), pagination: { page, limit, total: count.rows[0].total } });
}));
router.post('/staff', requireAuth, requireRole('admin'), validate(addStaffSchema), asyncHandler(async (req, res) => {
  const { email, fullName, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await db.query(`INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,'staff') RETURNING id,email,full_name,role,created_at`, [email.toLowerCase(), passwordHash, fullName]);
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists', 'email');
    throw error;
  }
}));
module.exports = router;
