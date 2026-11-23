// NSE end-of-day bhavcopy (public daily report) download + parse.
import { unzipSync, strFromU8 } from 'fflate';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
let cookie = '';

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
export const bhavUrl = (date) => `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd(date)}_F_0000.csv.zip`;

async function warmCookie() {
  try {
    const r = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  } catch { /* ignore */ }
}

/** Returns CSV text, or null when there's no file (holiday / not yet published). */
export async function downloadBhavcopy(date) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(bhavUrl(date), { headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.nseindia.com/all-reports', ...(cookie && { Cookie: cookie }) } });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) { await warmCookie(); continue; }
    if (!res.ok) throw new Error(`NSE ${res.status} for ${ymd(date)}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const name = Object.keys(files).find((f) => f.toLowerCase().endsWith('.csv'));
    return name ? strFromU8(files[name]) : null;
  }
  throw new Error('NSE refused the download');
}

/** Parse a CM bhavcopy (UDiFF or legacy headers) into equity rows. */
export function parseBhavcopy(csv, { series = ['EQ', 'BE'] } = {}) {
  const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { date: null, rows: [] };
  const head = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const I = {
    date: col('TRADDT', 'TIMESTAMP', 'DATE1'), sym: col('TCKRSYMB', 'SYMBOL'), ser: col('SCTYSRS', 'SERIES'), isin: col('ISIN'),
    name: col('FININSTRMNM', 'SECURITY'), o: col('OPNPRIC', 'OPEN', 'OPEN_PRICE'), h: col('HGHPRIC', 'HIGH', 'HIGH_PRICE'), l: col('LWPRIC', 'LOW', 'LOW_PRICE'),
    c: col('CLSPRIC', 'CLOSE', 'CLOSE_PRICE'), pc: col('PRVSCLSGPRIC', 'PREVCLOSE', 'PREV_CLOSE'), v: col('TTLTRADGVOL', 'TOTTRDQTY', 'TTL_TRD_QNTY'), val: col('TTLTRFVAL', 'TOTTRDVAL', 'TURNOVER_LACS'),
  };
  if (I.sym < 0 || I.c < 0) throw new Error('Unrecognised bhavcopy format');
  const num = (s) => { const x = parseFloat(s); return Number.isFinite(x) ? x : 0; };
  let date = null;
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',').map((x) => x.trim());
    const ser = I.ser >= 0 ? f[I.ser] : 'EQ';
    if (!series.includes(ser)) continue;
    if (!date && I.date >= 0) date = normDate(f[I.date]);
    const c = num(f[I.c]);
    if (!c) continue;
    const valRaw = I.val >= 0 ? num(f[I.val]) : 0;
    rows.push({
      symbol: f[I.sym], series: ser, isin: I.isin >= 0 ? f[I.isin] : '', name: I.name >= 0 ? f[I.name] : '',
      o: num(f[I.o]) || c, h: num(f[I.h]) || c, l: num(f[I.l]) || c, c, pc: I.pc >= 0 ? num(f[I.pc]) : 0, v: num(f[I.v]),
      val: head[I.val] === 'TURNOVER_LACS' ? valRaw * 1e5 : valRaw,
    });
  }
  return { date, rows };
}

function normDate(s) {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(+d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
