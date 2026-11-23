// Sensibull OI-change endpoint, called with the user's OWN session cookie, pasted by them.
// The cookie is passed through per request: never stored, never logged.
import { HttpError } from '../http.js';

const URL = 'https://oxide.sensibull.com/v1/compute/9/oi_graphs/oi_change_chart';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

export const UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

/** Accepts a raw cookie string or a whole pasted curl command; returns "a=b; c=d". */
export function extractCookie(input) {
  const s = String(input || '').trim();
  const b = s.match(/(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/);
  if (b) return b[2].trim();
  const h = s.match(/-H\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (h) return h[2].trim();
  return s.replace(/^cookie:\s*/i, '');
}

export async function fetchOiChange({ cookie, underlying, expiry, atm = 'five', deviceId }) {
  const body = {
    underlying,
    expiries: { [expiry]: { is_weekly: true, is_enabled: true } },
    atm_strike_selection: atm,
    input_min_strike: null,
    input_max_strike: null,
    auto_update: 'full_day',
    show_oi: true,
  };
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://web.sensibull.com',
      referer: 'https://web.sensibull.com/',
      'user-agent': UA,
      cookie,
      ...(deviceId && { 'x-device-id': deviceId }),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'SENSIBULL_SESSION');
  if (!res.ok || !data) throw new HttpError(502, `Sensibull returned ${res.status}${data?.message ? `: ${data.message}` : ''}`);
  return data;
}

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return undefined; };

/** Map Sensibull per-strike data into the same chain shape the UI uses. */
export function parseOiChange(raw) {
  const p = raw?.payload || raw?.data || raw || {};
  const per = p.per_strike_data || p.perStrikeData || {};
  const rows = Object.entries(per).map(([k, d]) => {
    const side = (pre) => {
      const oi = num(pick(d, `to_${pre}_oi`, `${pre}_oi`));
      const prevOi = num(pick(d, `from_${pre}_oi`, `${pre}_prev_oi`));
      return {
        oi, prevOi, chgOi: oi - prevOi,
        ltp: num(pick(d, `${pre}_ltp`, `to_${pre}_ltp`)), close: num(pick(d, `${pre}_close`, `from_${pre}_ltp`)),
        iv: num(pick(d, `${pre}_iv`)), delta: num(pick(d, `${pre}_delta`)), theta: num(pick(d, `${pre}_theta`)), gamma: num(pick(d, `${pre}_gamma`)), vega: num(pick(d, `${pre}_vega`)),
        volume: num(pick(d, `${pre}_volume`, `to_${pre}_volume`)),
      };
    };
    return { strike: num(k), ce: side('call'), pe: side('put') };
  }).filter((r) => r.strike > 0).sort((a, b) => a.strike - b.strike);

  for (const r of rows) for (const s of [r.ce, r.pe]) {
    s.buildup = s.ltp && s.close ? buildup(s.ltp, s.close, s.chgOi) : s.chgOi > 0 ? 'OI added' : s.chgOi < 0 ? 'OI cut' : '';
  }
  const spot = num(pick(p, 'underlying_price', 'underlying_ltp', 'spot', 'spot_price', 'ltp', 'future_price'));
  const atmStrike = num(pick(p, 'atm_strike', 'atm'));
  // Which optional columns actually came back
  const has = {};
  for (const f of ['ltp', 'iv', 'delta', 'theta', 'gamma', 'vega', 'volume']) has[f] = rows.some((r) => r.ce[f] || r.pe[f]);
  return { rows, spot, atmStrike, has, keys: Object.keys(p).slice(0, 40), sampleStrike: Object.entries(per)[0] || null };
}

function buildup(ltp, close, chg) {
  if (!chg) return '';
  if (ltp >= close) return chg > 0 ? 'Long buildup' : 'Short covering';
  return chg > 0 ? 'Short buildup' : 'Long unwinding';
}
