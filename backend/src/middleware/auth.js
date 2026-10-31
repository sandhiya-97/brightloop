const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { AppError, asyncHandler } = require('./errors');

const SESSION_COOKIE = 'brightloop_session';

const requireAuth = asyncHandler(async (req, _res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || req.cookies?.[SESSION_COOKIE];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch { throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired; please sign in again'); }
  const result = await db.query(
    'SELECT id, email, full_name, role, is_active, token_version FROM users WHERE id = $1', [payload.sub],
  );
  const user = result.rows[0];
  if (!user || !user.is_active || payload.tokenVersion !== user.token_version) throw new AppError(401, 'UNAUTHENTICATED', 'Account is unavailable or the session has been revoked');
  req.user = user;
  next();
});

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do that'));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, SESSION_COOKIE };
