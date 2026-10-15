import { badRequest } from '../utils/errors.js';

/**
 * Validates req[source] against a zod schema and replaces it with the parsed value
 * (unknown keys stripped, types coerced). Errors become a 400 with per-field details.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    return next(badRequest('Validation failed', details));
  }
  // Express 5 makes req.query a getter, so store parsed values separately.
  req.valid = { ...req.valid, [source]: result.data };
  next();
};
