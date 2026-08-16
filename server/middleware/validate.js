import { AppError } from '../lib/errors.js';

/**
 * Validates req.body / req.query against a zod schema and replaces it with the
 * parsed result, so route handlers only ever see clean, typed data.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(value)',
        message: i.message,
      }));
      // Lead with the first problem - it is the one the user needs to fix.
      return next(new AppError(issues[0].message, 400, issues));
    }
    if (source === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
}

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
