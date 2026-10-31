const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const userModel = require('../models/userModel');
const { AppError } = require('../middleware/errors');
const { SESSION_COOKIE } = require('../middleware/auth');
const { sendMail } = require('./mailer');

function sessionCookieOptions() {
  // Production cookies must remain HTTPS-only even if a local-dev flag is misconfigured.
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const sameSite = process.env.COOKIE_SAME_SITE || (secure ? 'none' : 'lax');
  return { httpOnly: true, secure, sameSite, path: '/', maxAge: 8 * 60 * 60 * 1000 };
}
function setSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), tokenVersion: Number(user.token_version || 0) }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}
function clearSession(res) {
  const options = sessionCookieOptions();
  delete options.maxAge;
  res.clearCookie(SESSION_COOKIE, options);
}
function publicUser(row) {
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role };
}

async function signup({ email, password, fullName }) {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await userModel.createCustomer({ email: normalized, passwordHash, fullName: fullName.trim() });
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists', 'email');
    throw error;
  }
}

async function login({ email, password }) {
  const result = await userModel.findByEmail(email.trim().toLowerCase());
  const user = result.rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  return user;
}

async function requestPasswordReset(email) {
  // Identical response for present and absent accounts prevents address enumeration.
  const result = await db.query('SELECT id,email,full_name FROM users WHERE email=$1 AND is_active=TRUE', [email.trim().toLowerCase()]);
  const user = result.rows[0];
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const minutes = Number(process.env.RESET_TOKEN_MINUTES || 30);
  await db.query('DELETE FROM password_resets WHERE user_id=$1 OR expires_at < NOW()', [user.id]);
  await db.query(
    `INSERT INTO password_resets(user_id,token_hash,expires_at)
     VALUES($1,$2,NOW() + ($3::text || ' minutes')::interval)`, [user.id, tokenHash, minutes],
  );
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const text = `Hello ${user.full_name},\n\nUse this one-time link to reset your Brightloop password. It expires in ${minutes} minutes:\n${link}\n\nIf you did not request this, ignore this email.`;
  const delivered = await sendMail({ to: user.email, subject: 'Reset your Brightloop password', text });
  if (!delivered && process.env.NODE_ENV !== 'production') console.log(`[password reset for ${user.email}] ${link}`);
  else if (!delivered) console.warn('Password reset email could not be delivered; configure SMTP.');
}

async function resetPassword({ token, password }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (client) => {
    const result = await client.query(
      `SELECT id,user_id FROM password_resets
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [tokenHash],
    );
    const reset = result.rows[0];
    if (!reset) throw new AppError(400, 'RESET_LINK_INVALID', 'This reset link is invalid or expired', 'token');
    // Incrementing token_version invalidates all already-issued access tokens.
    await client.query('UPDATE users SET password_hash=$1, token_version=token_version+1, updated_at=NOW() WHERE id=$2', [passwordHash, reset.user_id]);
    await client.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [reset.user_id]);
  });
}

module.exports = { signup, login, requestPasswordReset, resetPassword, setSession, clearSession, publicUser };
