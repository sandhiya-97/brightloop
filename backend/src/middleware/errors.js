class AppError extends Error {
  constructor(status, error, message, field = null) {
    super(message);
    this.status = status;
    this.code = error;
    this.field = field;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} was not found`));
}
function errorHandler(err, _req, res, _next) {
  if (res.headersSent) return;
  let status = Number.isInteger(err.status) ? err.status : 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let field = err.field || null;
  if (err.name === 'ZodError') {
    status = 400; code = 'VALIDATION_ERROR';
    const issue = err.issues?.[0];
    message = issue?.message || 'Input validation failed';
    field = issue?.path?.join('.') || null;
  } else if (err.code === '23505') {
    status = 409; code = 'CONFLICT'; message = 'A record with that value already exists';
    field = err.constraint?.includes('email') ? 'email' : null;
  } else if (err.code === '23503') {
    status = 400; code = 'REFERENCE_ERROR'; message = 'A referenced record does not exist';
  } else if (err.code === '23514') {
    status = 400; code = 'VALIDATION_ERROR'; message = 'Input violates a business rule';
  }
  if (status >= 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') message = 'An unexpected error occurred';
  }
  res.status(status).json({ error: code, message, field });
}

module.exports = { AppError, asyncHandler, notFound, errorHandler };
