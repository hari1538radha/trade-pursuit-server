// Server recorder: pulls each enabled Sensibull chain every 3 seconds during NSE market hours,
// whether or not anyone has the site open, and stores every pull (store.js).
//
// Note: on Render's free plan the service sleeps after ~15 minutes without web traffic and
// this loop stops with it. Keep it awake (paid instance, or an uptime pinger on /api/health).
import { SbRecorder } from '../../models/SbRecorder.js';
import { open } from '../secret.js';
import * as sb from './sensibull.js';
import { marketOpen } from './options.js';
import { recordPull } from './store.js';

const PULL_MS = 3000;
const state = new Map(); // recorderId -> { last, busy, rec }
let timer = null, lastLoad = 0;

const istYmd = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function load() {
  const recs = await SbRecorder.find({ enabled: true, status: { $ne: 'expired' } }).lean();
  const ids = new Set(recs.map((r) => String(r._id)));
  for (const id of state.keys()) if (!ids.has(id)) state.delete(id);
  for (const r of recs) {
    const s = state.get(String(r._id));
    if (s) s.rec = r; else state.set(String(r._id), { last: 0, busy: false, rec: r });
  }
  lastLoad = Date.now();
}

async function setStatus(id, patch) {
  await SbRecorder.updateOne({ _id: id }, { $set: patch }).catch(() => {});
}

/** Find the next expiry Sensibull has strikes for, starting from `from` (one call per 3s). */
async function roll(rec, cookie) {
  let day = istYmd();
  for (let i = 0; i < 14; i++, day = addDays(day, 1)) {
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    try {
      const raw = await sb.fetchOiChange({ cookie, underlying: rec.underlying, expiry: day, atm: rec.atm });
      if (sb.parseOiChange(raw).rows.length) return day;
    } catch (e) { if (e.message === 'SENSIBULL_SESSION') throw e; }
    await new Promise((r) => setTimeout(r, PULL_MS));
  }
  return null;
}

async function pull(s) {
  const rec = s.rec;
  s.busy = true; s.last = Date.now();
  try {
    const cookie = sb.extractCookie(open(rec.cookie));
    if (rec.expiry < istYmd()) {
      if (!rec.autoRoll) { await setStatus(rec._id, { status: 'error', lastError: `Expiry ${rec.expiry} has passed. Pick the next one.` }); s.rec = { ...rec, enabled: false }; return; }
      await setStatus(rec._id, { status: 'rolling' });
      const next = await roll(rec, cookie);
      if (!next) { await setStatus(rec._id, { status: 'error', lastError: 'Could not find the next expiry. Set it manually.' }); return; }
      s.rec = { ...rec, expiry: next };
      await setStatus(rec._id, { expiry: next, status: 'recording', lastError: null });
      return;
    }
    const raw = await sb.fetchOiChange({ cookie, underlying: rec.underlying, expiry: rec.expiry, atm: rec.atm });
    const p = sb.parseOiChange(raw);
    if (!p.rows.length) throw new Error(`No strikes for ${rec.underlying} ${rec.expiry}`);
    const chain = p.rows.map((x) => ({ ...x, expiry: rec.expiry }));
    await recordPull({ user: rec.user, key: rec.underlying, expiry: rec.expiry, chain, spot: p.spot, atmStrike: p.atmStrike, has: p.has, src: 'server' });
    s.fails = 0;
    s.pulls = (s.pulls || 0) + 1;
    // Status write at most every 30s to keep database writes low
    if (!s.statusAt || Date.now() - s.statusAt > 30000 || rec.status !== 'recording') {
      s.statusAt = Date.now();
      await SbRecorder.updateOne({ _id: rec._id }, { $set: { status: 'recording', lastAt: new Date(), lastError: null }, $inc: { pulls: s.pulls } });
      s.pulls = 0; s.rec = { ...rec, status: 'recording' };
    }
  } catch (e) {
    if (e.message === 'SENSIBULL_SESSION') {
      await setStatus(rec._id, { status: 'expired', lastError: 'Sensibull session expired. Paste a fresh one.' });
      state.delete(String(rec._id));
      return;
    }
    s.fails = (s.fails || 0) + 1;
    if (s.fails >= 5) s.last = Date.now() + 30000; // back off 30s after repeated errors
    await SbRecorder.updateOne({ _id: rec._id }, { $set: { status: 'error', lastError: String(e.message).slice(0, 200) }, $inc: { fails: 1 } }).catch(() => {});
  } finally { s.busy = false; }
}

function loop() {
  if (Date.now() - lastLoad > 20000) load().catch((e) => console.error('[recorder] load', e.message));
  if (!marketOpen()) return;
  for (const s of state.values()) {
    if (!s.busy && s.rec.enabled !== false && Date.now() - s.last >= PULL_MS) pull(s);
  }
}

export function startRecorder() {
  if (timer) return;
  timer = setInterval(loop, 500);
  load().catch(() => {});
  console.log('Option-chain recorder running (pulls every 3s in market hours)');
}

/** Pick up a changed recorder right away (after the user saves it) */
export function refreshRecorders() { lastLoad = 0; }
export const _istYmd = istYmd;
