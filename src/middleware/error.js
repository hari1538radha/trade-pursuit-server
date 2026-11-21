import { HttpError } from '../lib/http.js';

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err?.code === 11000) return res.status(409).json({ error: 'Already exists' });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid id' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large (images too big?)' });
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, details: err.details });
}
