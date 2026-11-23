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

// ---- Roles ----
// Looked up from the database (cached 30s) so promotions/demotions apply without signing in again.
const roleCache = new Map();
export const roles = {
  async lookup(userId) {
    const { User, isAdminName } = await import('../models/User.js');
    const u = await User.findById(userId).select('role username').lean();
    if (!u) return null;
    return isAdminName(u.username) ? 'admin' : u.role || 'user';
  },
  clear(userId) { if (userId) roleCache.delete(String(userId)); else roleCache.clear(); },
};

export async function roleOf(userId) {
  const hit = roleCache.get(String(userId));
  if (hit && Date.now() - hit.at < 30000) return hit.role;
  const role = await roles.lookup(userId);
  roleCache.set(String(userId), { at: Date.now(), role });
  return role;
}

/** Use after requireAuth (or alone: it checks the token first) */
export function requireAdmin(req, res, next) {
  const go = async () => {
    const role = await roleOf(req.userId);
    if (!role) return next(new HttpError(401, 'Account not found'));
    if (role !== 'admin') return next(new HttpError(403, 'This page is for admins only'));
    req.role = role;
    next();
  };
  if (!req.userId) return requireAuth(req, res, (e) => (e ? next(e) : go().catch(next)));
  go().catch(next);
}
