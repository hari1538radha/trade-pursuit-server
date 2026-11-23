// AES-256-GCM for secrets we must keep (a user's own Sensibull session for the server recorder).
// Key: SECRET_KEY env (any long random string) or, if unset, derived from JWT_SECRET.
// Changing either makes stored sessions unreadable: users just paste a fresh one.
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = () => crypto.createHash('sha256').update(`${process.env.SECRET_KEY || config.jwtSecret}:tp-secrets-v1`).digest();

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function open(sealed) {
  const [iv, tag, enc] = String(sealed || '').split('.').map((s) => Buffer.from(s, 'base64'));
  if (!iv?.length || !tag?.length || !enc) throw new Error('Unreadable secret');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
