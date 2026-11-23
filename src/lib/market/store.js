// Saving option-chain data: 3-second ticks (with the full chain when it changed) and 3-minute snapshots.
// Shared by the page-driven pull (routes/market.js) and the server recorder (recorder.js).
import { OISnapshot } from '../../models/OISnapshot.js';
import { OITick } from '../../models/OITick.js';
import { chainStats, tickDelta } from './options.js';

const lastChain = new Map(); // `${user}|${key}|${expiry}` -> { at, chain }

export async function saveSnapshot(user, key, expiry, chain, stats, minGapMs = 3 * 60000) {
  const lastSnap = await OISnapshot.findOne({ user, symbol: key, expiry }).sort({ at: -1 }).select('at').lean();
  if (lastSnap && Date.now() - new Date(lastSnap.at).getTime() < minGapMs) return;
  const i = chain.findIndex((x) => x.strike === stats.atm);
  const near = chain.slice(Math.max(0, i - 12), i + 13).map((x) => [x.strike, x.ce.oi, x.pe.oi, x.ce.chgOi, x.pe.chgOi]);
  await OISnapshot.create({ user, symbol: key, expiry, spot: stats.spot, pcr: stats.pcr, ceOI: stats.ceOI, peOI: stats.peOI, ceChg: stats.ceChg, peChg: stats.peChg, maxPain: stats.maxPain, atmIv: stats.atmIv, strikes: near });
}

/** Full chain packed for storage */
export function pack(chain, withDelta) {
  return chain.map((r) => {
    const row = [r.strike, r.ce.oi, r.pe.oi, r.ce.prevOi || 0, r.pe.prevOi || 0];
    if (withDelta) row.push(+(r.ce.delta || 0).toFixed(4), +(r.pe.delta || 0).toFixed(4));
    return row;
  });
}

/** Rebuild chain rows from a stored tick */
export function unpack(s, expiry) {
  return (s || []).map(([strike, ceOI, peOI, cePrev, pePrev, ceD, peD]) => ({
    strike, expiry,
    ce: { oi: ceOI, prevOi: cePrev, chgOi: ceOI - cePrev, delta: ceD || 0 },
    pe: { oi: peOI, prevOi: pePrev, chgOi: peOI - pePrev, delta: peD || 0 },
  }));
}

/**
 * Record one pull. Returns { stats, tick } (tick is null on the first pull of a chain).
 * save=false computes without writing (outside market hours).
 */
export async function recordPull({ user, key, expiry, chain, spot, atmStrike, has = {}, save = true, src = 'page' }) {
  const stats = chainStats(chain, { spot, atmStrike });
  const k = `${user}|${key}|${expiry}`;
  const prev = lastChain.get(k);
  lastChain.set(k, { at: Date.now(), chain });
  let tick = null;
  if (stats && prev && Date.now() - prev.at < 60000) {
    const d = tickDelta(prev.chain, chain, stats.atm);
    tick = { at: new Date(), spot: stats.spot, atm: stats.atm, pcr: stats.pcr, ceOI: stats.ceOI, peOI: stats.peOI, dCe: d.dCe, dPe: d.dPe, ceDelta: d.ceDelta, peDelta: d.peDelta, d: d.strikes };
    if (save) await OITick.create({ user, symbol: key, expiry, src, ...tick, ...(d.changed && { s: pack(chain, has.delta) }) });
  } else if (stats && save) {
    // First pull of a session: store the full chain as the baseline
    await OITick.create({ user, symbol: key, expiry, src, at: new Date(), spot: stats.spot, atm: stats.atm, pcr: stats.pcr, ceOI: stats.ceOI, peOI: stats.peOI, dCe: 0, dPe: 0, d: [], s: pack(chain, has.delta) });
  }
  if (stats && save) await saveSnapshot(user, key, expiry, chain, stats);
  return { stats, tick };
}

/** Latest full chain stored for a user/chain, with the ticks since it was saved folded in */
export async function latestChain(user, key, expiry) {
  const full = await OITick.findOne({ user, symbol: key, expiry, s: { $exists: true } }).sort({ at: -1 }).lean();
  if (!full) return null;
  const last = await OITick.findOne({ user, symbol: key, expiry }).sort({ at: -1 }).select('-s').lean();
  const chain = unpack(full.s, expiry);
  const withDelta = full.s[0]?.length > 5;
  return { chain, at: last?.at || full.at, tick: last, has: { delta: withDelta } };
}
