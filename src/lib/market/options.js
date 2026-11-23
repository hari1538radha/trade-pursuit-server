// Option chain analytics. Pure functions over a normalised chain [{ strike, ce, pe }].

export const UNDERLYINGS = {
  NIFTY: { key: 'NSE_INDEX|Nifty 50', name: 'NIFTY 50' },
  BANKNIFTY: { key: 'NSE_INDEX|Nifty Bank', name: 'NIFTY BANK' },
  FINNIFTY: { key: 'NSE_INDEX|Nifty Fin Service', name: 'NIFTY FIN SERVICE' },
  MIDCPNIFTY: { key: 'NSE_INDEX|NIFTY MID SELECT', name: 'NIFTY MIDCAP SELECT' },
  SENSEX: { key: 'BSE_INDEX|SENSEX', name: 'SENSEX' },
};

const n = (v) => (Number.isFinite(+v) ? +v : 0);

/** Price/OI interpretation for one side of a strike */
export function buildup(ltp, prevClose, oi, prevOi) {
  const dp = n(ltp) - n(prevClose), doi = n(oi) - n(prevOi);
  if (!doi && !dp) return '';
  if (dp >= 0 && doi > 0) return 'Long buildup';
  if (dp < 0 && doi > 0) return 'Short buildup';
  if (dp >= 0 && doi < 0) return 'Short covering';
  if (dp < 0 && doi < 0) return 'Long unwinding';
  return '';
}

/** Normalise put/call chain rows (used for sample data) into a compact chain */
export function normalizeChain(rows) {
  return (rows || [])
    .map((r) => {
      const side = (o) => {
        const m = o?.market_data || {}, g = o?.option_greeks || {};
        return {
          key: o?.instrument_key, ltp: n(m.ltp), close: n(m.close_price), oi: n(m.oi), prevOi: n(m.prev_oi), chgOi: n(m.oi) - n(m.prev_oi),
          volume: n(m.volume), bid: n(m.bid_price), ask: n(m.ask_price), iv: n(g.iv), delta: n(g.delta), theta: n(g.theta), gamma: n(g.gamma), vega: n(g.vega), pop: n(g.pop),
          buildup: buildup(m.ltp, m.close_price, m.oi, m.prev_oi),
        };
      };
      return { strike: n(r.strike_price), spot: n(r.underlying_spot_price), expiry: r.expiry, pcr: n(r.pcr), ce: side(r.call_options), pe: side(r.put_options) };
    })
    .filter((r) => r.strike > 0)
    .sort((a, b) => a.strike - b.strike);
}

/**
 * ATM without a spot price. Sensibull returns strikes centred on ATM (ATM ± N), so the
 * middle strike is ATM. As a check, near ATM puts outweigh calls below and calls outweigh
 * puts above; if that crossover sits well away from the middle (e.g. "all strikes"), use it.
 */
export function estimateAtm(chain) {
  const mid = Math.floor(chain.length / 2);
  let cross = -1, best = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1].pe.oi - chain[i - 1].ce.oi, b = chain[i].pe.oi - chain[i].ce.oi;
    if (a > 0 && b <= 0 && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cross = i; }
  }
  return chain[cross >= 0 && best > Math.max(3, chain.length / 4) ? cross : mid];
}

/** Strike where total intrinsic value paid to option holders at expiry is lowest */
export function maxPain(chain) {
  let best = null;
  for (const s of chain) {
    let pain = 0;
    for (const r of chain) {
      if (s.strike > r.strike) pain += (s.strike - r.strike) * r.ce.oi;
      if (s.strike < r.strike) pain += (r.strike - s.strike) * r.pe.oi;
    }
    if (!best || pain < best.pain) best = { strike: s.strike, pain };
  }
  return best?.strike ?? null;
}

export function chainStats(chain, opts = {}) {
  if (!chain.length) return null;
  const spot = opts.spot || chain.find((r) => r.spot)?.spot || 0;
  // ATM: the given strike, else the one nearest spot, else estimated (see estimateAtm)
  const atm = opts.atmStrike ? (chain.find((r) => r.strike === opts.atmStrike) || estimateAtm(chain))
    : spot ? chain.reduce((a, r) => (Math.abs(r.strike - spot) < Math.abs(a.strike - spot) ? r : a), chain[0])
      : estimateAtm(chain);
  const sum = (f) => chain.reduce((s, r) => s + f(r), 0);
  const ceOI = sum((r) => r.ce.oi), peOI = sum((r) => r.pe.oi);
  const ceChg = sum((r) => r.ce.chgOi), peChg = sum((r) => r.pe.chgOi);
  const ceVol = sum((r) => r.ce.volume), peVol = sum((r) => r.pe.volume);
  const top = (rows, f, k = 3) => rows.slice().sort((a, b) => f(b) - f(a)).slice(0, k).map((r) => ({ strike: r.strike, value: f(r) }));
  const resist = top(chain.filter((r) => r.strike >= atm.strike), (r) => r.ce.oi);
  const support = top(chain.filter((r) => r.strike <= atm.strike), (r) => r.pe.oi);
  const pcr = ceOI ? peOI / ceOI : 0;
  const pcrChg = ceChg > 0 && peChg > 0 ? peChg / ceChg : null;
  let bias = 'Neutral';
  if (pcr >= 1.2 && peChg > ceChg) bias = 'Bullish (put writers in control)';
  else if (pcr <= 0.8 && ceChg > peChg) bias = 'Bearish (call writers in control)';
  else if (peChg > ceChg * 1.3) bias = 'Mildly bullish';
  else if (ceChg > peChg * 1.3) bias = 'Mildly bearish';
  return {
    spot, atm: atm.strike, atmEstimated: !spot && !opts.atmStrike, expiry: chain[0].expiry, pcr, pcrChg, ceOI, peOI, ceChg, peChg, ceVol, peVol,
    maxPain: maxPain(chain), atmIv: (atm.ce.iv + atm.pe.iv) / 2 || atm.ce.iv || atm.pe.iv,
    straddle: atm.ce.ltp + atm.pe.ltp, // ATM straddle premium ~ expected move to expiry
    resistance: resist, support, bias,
  };
}

/** Strikes whose OI changed by more than a threshold (the "spike" view) */
export function spikes(chain, threshold) {
  const out = [];
  for (const r of chain) {
    if (Math.abs(r.ce.chgOi) >= threshold) out.push({ strike: r.strike, side: 'CE', chgOi: r.ce.chgOi, buildup: r.ce.buildup });
    if (Math.abs(r.pe.chgOi) >= threshold) out.push({ strike: r.strike, side: 'PE', chgOi: r.pe.chgOi, buildup: r.pe.buildup });
  }
  return out.sort((a, b) => Math.abs(b.chgOi) - Math.abs(a.chgOi));
}

/** Is the Indian cash market open right now (Mon–Fri 9:15–15:30 IST, ignoring holidays)? */
export function marketOpen(d = new Date()) {
  const ist = new Date(d.getTime() + (5.5 * 60 + d.getTimezoneOffset()) * 60000);
  const day = ist.getDay(), mins = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && mins >= 555 && mins <= 930;
}

/**
 * Change between two pulls of the same chain (the "tick").
 * Returns totals, per-strike changes (only strikes that moved: [strike, dCeOI, dPeOI])
 * and the ATM call/put option delta when the feed provides greeks.
 */
export function tickDelta(prev, chain, atmStrike) {
  const before = new Map((prev || []).map((r) => [r.strike, r]));
  let dCe = 0, dPe = 0;
  const strikes = [];
  for (const r of chain) {
    const p = before.get(r.strike);
    if (!p) continue;
    const c = r.ce.oi - p.ce.oi, q = r.pe.oi - p.pe.oi;
    dCe += c; dPe += q;
    if (c || q) strikes.push([r.strike, c, q]);
  }
  const atm = chain.find((r) => r.strike === atmStrike);
  return {
    dCe, dPe, strikes,
    ceDelta: atm?.ce.delta || null, peDelta: atm?.pe.delta || null,
    changed: strikes.length > 0,
  };
}
