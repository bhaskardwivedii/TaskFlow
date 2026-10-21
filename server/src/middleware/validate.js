import { badRequest } from '../utils/http.js';

/** validate({ body, query, params }) with zod schemas; replaces values with parsed (coerced) output. */
export const validate = (schemas) => (req, _res, next) => {
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      return next(badRequest('Validation failed', result.error.flatten()));
    }
    if (key === 'query') {
      // Express 4 exposes req.query via a getter; store parsed values separately.
      req.validatedQuery = result.data;
    } else {
      req[key] = result.data;
    }
  }
  next();
};
