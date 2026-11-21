import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), u: user.username }, config.jwtSecret, { expiresIn: config.jwtExpires });
}

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Not signed in'));
  try {
    const p = jwt.verify(token, config.jwtSecret);
    req.userId = p.sub;
    req.username = p.u;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, sign in again'));
  }
}
