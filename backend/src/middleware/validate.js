const { AppError } = require('./errors');

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issue = result.error.issues[0];
      return next(new AppError(400, 'VALIDATION_ERROR', issue.message, issue.path.join('.') || source));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
