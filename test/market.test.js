import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChain, chainStats, maxPain, buildup, spikes } from '../src/lib/market/options.js';
import { parseBhavcopy } from '../src/lib/market/nse.js';
import { analyze, rsi, levels } from '../src/lib/market/scanner.js';
import { tickDelta } from '../src/lib/market/options.js';
import { extractCookie, parseOiChange } from '../src/lib/market/sensibull.js';

const side = (ltp, close, oi, prev, iv = 15) => ({ instrument_key: 'X', market_data: { ltp, close_price: close, oi, prev_oi: prev, volume: 10 }, option_greeks: { iv, delta: 0.5 } });
const rows = [
  { expiry: '2026-11-25', strike_price: 25900, underlying_spot_price: 26010, pcr: 1, call_options: side(160, 150, 1000, 900), put_options: side(40, 60, 9000, 6000) },
  { expiry: '2026-11-25', strike_price: 26000, underlying_spot_price: 26010, pcr: 1, call_options: side(90, 100, 5000, 4000), put_options: side(80, 70, 7000, 6500) },
  { expiry: '2026-11-25', strike_price: 26100, underlying_spot_price: 26010, pcr: 1, call_options: side(40, 50, 12000, 8000), put_options: side(140, 120, 2000, 2100) },
];

test('option chain stats', () => {
  const ch = normalizeChain(rows);
  assert.equal(ch.length, 3);
  const s = chainStats(ch);
  assert.equal(s.atm, 26000);
  assert.equal(s.ceOI, 18000); assert.equal(s.peOI, 18000);
  assert.equal(s.pcr, 1);
  assert.equal(s.resistance[0].strike, 26100);
  assert.equal(s.support[0].strike, 25900);
  assert.equal(s.straddle, 170);
  assert.ok([25900, 26000, 26100].includes(s.maxPain));
  assert.equal(buildup(100, 90, 10, 5), 'Long buildup');
  assert.equal(buildup(80, 90, 10, 5), 'Short buildup');
  assert.equal(buildup(100, 90, 5, 10), 'Short covering');
  assert.equal(buildup(80, 90, 5, 10), 'Long unwinding');
  assert.equal(spikes(ch, 3000)[0].strike, 26100);
});

test('max pain is the strike with the least payout', () => {
  // payouts: @100 = 30k, @110 = 20k, @120 = 30k
  const ch = [100, 110, 120].map((k) => ({ strike: k, ce: { oi: k <= 110 ? 1000 : 0 }, pe: { oi: k >= 110 ? 1000 : 0 } }));
  assert.equal(maxPain(ch), 110);
});

test('bhavcopy parser handles UDiFF and legacy headers', () => {
  const udiff = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4\n'
    + '2026-11-20,2026-11-20,CM,NSE,STK,2885,INE002A01018,RELIANCE,EQ,,,,,RELIANCE INDUSTRIES LTD,1500,1520,1490,1510,1511,1495,,1510,,,1000000,1510000000,50000,F1,1,,,,,\n'
    + '2026-11-20,2026-11-20,CM,NSE,STK,1,INE000000001,SOMEBOND,N1,,,,,BOND,100,100,100,100,100,100,,100,,,10,1000,1,F1,1,,,,,\n';
  const p = parseBhavcopy(udiff);
  assert.equal(p.date, '2026-11-20');
  assert.equal(p.rows.length, 1);
  assert.deepEqual([p.rows[0].symbol, p.rows[0].isin, p.rows[0].c, p.rows[0].v], ['RELIANCE', 'INE002A01018', 1510, 1000000]);
  const legacy = 'SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN\nTCS,EQ,4000,4050,3980,4020,4021,3990,200000,804000000,20-NOV-2026,9000,INE467B01029\n';
  const q = parseBhavcopy(legacy);
  assert.equal(q.rows[0].symbol, 'TCS'); assert.equal(q.rows[0].c, 4020);
});

function series(closes, vols) {
  const d = closes.map((_, i) => `2026-01-${String(i).padStart(3, '0')}`);
  return { d, o: closes.slice(), h: closes.map((x) => x * 1.01), l: closes.map((x) => x * 0.99), c: closes.slice(), v: vols || closes.map(() => 1000), val: closes.map((x) => x * 1000) };
}

test('scanner flags a 52-week-high breakout on volume', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 8) * 5);
  closes.push(112);
  const vols = closes.map(() => 1000); vols[vols.length - 1] = 4000;
  const a = analyze(series(closes, vols));
  assert.ok(a.tags.includes('52w-high-breakout'), a.tags.join());
  assert.ok(a.tags.includes('breakout-20d'));
  assert.ok(a.tags.includes('volume-spike'));
  assert.equal(a.volRatio, 4);
});

test('scanner flags near 52-week low and RSI oversold', () => {
  const closes = Array.from({ length: 200 }, (_, i) => 200 - i * 0.5);
  const a = analyze(series(closes));
  assert.ok(a.tags.includes('near-52w-low'));
  assert.ok(a.tags.includes('rsi-oversold'));
  assert.ok(rsi(closes) < 5);
});

test('levels cluster repeated swing highs', () => {
  const closes = Array.from({ length: 150 }, (_, i) => 100 + 10 * Math.sin(i / 6));
  const lv = levels(series(closes));
  assert.ok(lv.some((x) => Math.abs(x.price - 111) < 2 && x.touches >= 2), JSON.stringify(lv));
});

test('split guard trims history', () => {
  const closes = [...Array.from({ length: 100 }, () => 1000), ...Array.from({ length: 60 }, () => 500)];
  const a = analyze(series(closes));
  assert.equal(a.adjusted, true);
  assert.equal(a.bars, 60);
});

test('sensibull: cookie extraction from a pasted curl', () => {
  const curl = "curl --url 'https://x' -H 'accept: */*' -b 'sb_rudder_utm={}; access_token=pb:abc; bkd_ref=Q' -H 'origin: https://web.sensibull.com'";
  assert.equal(extractCookie(curl), 'sb_rudder_utm={}; access_token=pb:abc; bkd_ref=Q');
  assert.equal(extractCookie("curl 'u' -H 'cookie: a=1; b=2'"), 'a=1; b=2');
  assert.equal(extractCookie('a=1; b=2'), 'a=1; b=2');
});

test('sensibull: per-strike data maps into the chain', () => {
  const raw = { success: true, payload: { per_strike_data: {
    24500: { to_call_oi: 39700000, from_call_oi: 15000000, to_put_oi: 15400000, from_put_oi: 14000000 },
    24400: { to_call_oi: 9058000, from_call_oi: 9000000, to_put_oi: 22800000, from_put_oi: 15000000 },
    24600: { to_call_oi: 25500000, from_call_oi: 10000000, to_put_oi: 4690000, from_put_oi: 5000000 },
  } } };
  const p = parseOiChange(raw);
  assert.deepEqual(p.rows.map((r) => r.strike), [24400, 24500, 24600]);
  assert.equal(p.rows[1].ce.chgOi, 24700000);
  assert.equal(p.rows[2].pe.buildup, 'OI cut');
  assert.equal(p.has.ltp, false);
  const st = chainStats(p.rows.map((x) => ({ ...x, expiry: '2025-08-07' })), {});
  assert.equal(st.atmEstimated, true);
  assert.equal(st.resistance[0].strike >= st.atm, true);
});

test('pending EOD dates skip weekends and wait for the evening file', async () => {
  const { pendingDates } = await import('../src/lib/market/eod.js');
  // "now" = Mon 23 Nov 2026 10:00 IST (fields read as UTC)
  const now = new Date(Date.UTC(2026, 10, 23, 10, 0));
  const d = pendingDates('2026-11-19', now).map((x) => x.toISOString().slice(0, 10));
  assert.deepEqual(d, ['2026-11-20']); // Fri only; Sat/Sun skipped, Monday's file not out yet
  const evening = new Date(Date.UTC(2026, 10, 23, 20, 0));
  assert.deepEqual(pendingDates('2026-11-20', evening).map((x) => x.toISOString().slice(0, 10)), ['2026-11-23']);
});

test('3-second tick: OI change per strike since the previous pull', () => {
  const row = (strike, ce, pe, cd = 0, pd = 0) => ({ strike, ce: { oi: ce, delta: cd }, pe: { oi: pe, delta: pd } });
  const a = [row(100, 1000, 2000), row(110, 500, 800), row(120, 300, 100)];
  const b = [row(100, 1000, 2600), row(110, 450, 800, 0.52, -0.48), row(120, 300, 100)];
  const t = tickDelta(a, b, 110);
  assert.equal(t.dCe, -50); assert.equal(t.dPe, 600);
  assert.deepEqual(t.strikes, [[100, 0, 600], [110, -50, 0]]);
  assert.equal(t.ceDelta, 0.52); assert.equal(t.peDelta, -0.48);
  assert.equal(tickDelta(b, b, 110).changed, false);
});

test('recorder: session cookie is sealed and only readable with the key', async () => {
  const { seal, open } = await import('../src/lib/secret.js');
  const s = seal('access_token=abc; x=1');
  assert.ok(!s.includes('access_token'));
  assert.equal(open(s), 'access_token=abc; x=1');
  const parts = s.split('.'); parts[2] = Buffer.from('tampered').toString('base64');
  assert.throws(() => open(parts.join('.')));
});

test('recorder: full chain packs and unpacks with day change', async () => {
  const { pack, unpack } = await import('../src/lib/market/store.js');
  const chain = [{ strike: 100, ce: { oi: 50, prevOi: 40, delta: 0.61234 }, pe: { oi: 70, prevOi: 90, delta: -0.39 } }];
  assert.deepEqual(pack(chain, false), [[100, 50, 70, 40, 90]]);
  const p = pack(chain, true);
  assert.deepEqual(p, [[100, 50, 70, 40, 90, 0.6123, -0.39]]);
  const u = unpack(p, '2026-11-25')[0];
  assert.equal(u.ce.chgOi, 10); assert.equal(u.pe.chgOi, -20); assert.equal(u.ce.delta, 0.6123);
});

test('goldbach data: yahoo candles, 4h grouping and stooq spot', async () => {
  const { candlesFromYahoo, spotFromStooq } = await import('../src/lib/goldbach.js');
  const json = { chart: { result: [{ meta: { regularMarketPrice: 4012 }, timestamp: [1, 2, 3, 4, 5], indicators: { quote: [{ open: [1, 2, 3, 4, 5], high: [2, 3, 9, 5, 6], low: [0.5, 1, 2, 3, 4], close: [2, 3, 4, 5, 5.5] }] } }] } };
  const one = candlesFromYahoo(json);
  assert.equal(one.candles.length, 5); assert.equal(one.last, 4012);
  const four = candlesFromYahoo(json, 4).candles;
  assert.deepEqual(four[0], { t: 1000, o: 1, h: 9, l: 0.5, c: 5 });
  assert.equal(spotFromStooq('Symbol,Date,Time,Open,High,Low,Close\nXAUUSD,2026-11-23,10:00:00,3990,4005,3980,3998.4'), 3998.4);
  assert.equal(spotFromStooq('Symbol,Date\nXAUUSD,N/D'), null);
});

test('daily-levels bars: yahoo hourly parse, stooq spot, basis and admin-only route', async () => {
  const { barsFromYahoo, lastFromStooq, getBars, _resetBarsCache } = await import('../src/lib/bars.js');
  const ts = Array.from({ length: 240 }, (_, i) => 1795000000 + i * 3600);
  const json = { chart: { result: [{ meta: { regularMarketPrice: 3630 }, timestamp: ts, indicators: { quote: [{ open: ts.map(() => 3620), high: ts.map(() => 3625.12345), low: ts.map(() => 3615), close: ts.map((_, i) => (i === 5 ? null : 3621)) }] } }] } };
  const { bars, last } = barsFromYahoo(json);
  assert.equal(bars.length, 239);                 // the row with a missing close is dropped
  assert.deepEqual(bars[0], [1795000000000, 3620, 3625.123, 3615, 3621]);
  assert.equal(last, 3630);
  assert.equal(lastFromStooq('Symbol,Date,Time,Open,High,Low,Close\nXAUUSD,2026-11-27,22:00:00,3600,3611,3590,3610.5'), 3610.5);
  assert.equal(lastFromStooq('garbage'), null);
  _resetBarsCache();
  const fake = async (url) => ({ ok: true, json: async () => json, text: async () => 'Symbol,Date,Time,Open,High,Low,Close\nXAUUSD,2026-11-27,22:00:00,1,1,1,3610' });
  const d = await getBars('XAUUSD', fake);
  assert.equal(d.basis, 20);
  assert.equal(d.spot, 3610);
  await assert.rejects(getBars('BTC', fake), /Unsupported/);
  const nq = await getBars('NAS100', fake);
  assert.equal(nq.basis, 0);                       // no spot shift for Nasdaq
});

test('macro: parsers, release times and a bundle that survives a failed source', async () => {
  const m = await import('../src/lib/macro/index.js');
  const { nyToUtc, EVENTS } = await import('../src/lib/macro/dates.js');
  // FRED csv: blank (new format) and "." (old format) rows are dropped
  assert.deepEqual(m.parseFredCsv('observation_date,DFII10\n2026-11-10,2.78\n2026-11-11,\n2026-11-12,.\n2026-11-13,2.91'), [['2026-11-10', 2.78], ['2026-11-13', 2.91]]);
  assert.throws(() => m.parseFredCsv('<html>'), /not a FRED csv/);
  // weekly = last observation of each Monday-Sunday week
  assert.deepEqual(m.toWeekly([['2026-11-09', 1], ['2026-11-13', 2], ['2026-11-16', 3], ['2026-11-18', 4]]), [['2026-11-13', 2], ['2026-11-18', 4]]);
  // Yahoo daily: the exchange's calendar date (gmtoffset), bad rows dropped
  const y = { chart: { result: [{ meta: { gmtoffset: -18000 }, timestamp: [1795410000, 1795496400, 1795582800], indicators: { quote: [{ open: [1, 2, null], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3] }] } }] } };
  const d = m.parseYahooDaily(y);
  assert.equal(d.length, 2);
  assert.equal(d[0][0], new Date(1795410000e3 - 18000e3).toISOString().slice(0, 10));
  // New York release times through daylight saving
  assert.equal(new Date(nyToUtc('2026-11-10', '08:30')).toISOString(), '2026-11-10T13:30:00.000Z');
  assert.equal(new Date(nyToUtc('2026-07-14', '08:30')).toISOString(), '2026-07-14T12:30:00.000Z');
  assert.equal(new Date(nyToUtc('2020-03-15', '17:00')).toISOString(), '2020-03-15T21:00:00.000Z');
  assert.equal(new Date(nyToUtc('2026-03-08', '08:30')).toISOString(), '2026-03-08T12:30:00.000Z'); // DST starts that Sunday
  assert.equal(new Date(nyToUtc('2026-11-01', '08:30')).toISOString(), '2026-11-01T13:30:00.000Z'); // and ends that Sunday
  assert.ok(EVENTS.some((e) => e.type === 'FOMC' && e.date === '2026-12-09'));
  assert.ok(!EVENTS.some((e) => e.type === 'CPI' && e.date.startsWith('2025-11'))); // October 2025 CPI was cancelled
  // hourly windows around events
  const at = nyToUtc('2026-11-06', '08:30');
  const bars = Array.from({ length: 40 }, (_, i) => [at - 10 * 3600e3 + i * 3600e3, 1, 2, 0.5, 1.5]);
  const w = m.eventWindows(bars, [{ type: 'NFP', date: '2026-11-06', at }], at + 30 * 3600e3);
  assert.equal(w['NFP:2026-11-06'].length, 16);
  // CFTC numbers arrive as strings
  assert.deepEqual(m.parseCot([{ report_date_as_yyyy_mm_dd: '2026-11-17T00:00:00.000', a: '121994', b: '19052' }, { report_date_as_yyyy_mm_dd: '2026-11-10T00:00:00.000', a: '127406', b: '15065' }], ['a', 'b']),
    [['2026-11-10', 127406, 15065], ['2026-11-17', 121994, 19052]]);
  // RSS: CDATA, entities and Investing.com's zone-less dates
  const rss = m.parseRss('<rss><channel><item><title><![CDATA[Gold &amp; yields]]></title><link>https://x.com/a</link><pubDate>2026-11-15 03:12:19</pubDate></item><item><title>No link</title></item></channel></rss>');
  assert.deepEqual(rss, [{ title: 'Gold & yields', link: 'https://x.com/a', at: Date.parse('2026-11-15T03:12:19Z') }]);

  // Bundle: FRED down -> still served with a status; prices down -> 502
  m._resetMacroCache();
  const { _resetNewsCache } = await import('../src/lib/news.js');
  _resetNewsCache();
  const ts = Array.from({ length: 1200 }, (_, i) => 1104537600 + i * 86400);
  const chart = { chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: ts, indicators: { quote: [{ open: ts.map(() => 10), high: ts.map(() => 11), low: ts.map(() => 9), close: ts.map(() => 10.5) }] } }] } };
  const ok = (body) => ({ ok: true, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fake = (pricesUp) => async (url) => {
    if (url.includes('fred.stlouisfed.org')) return { ok: false, status: 503 };
    if (url.includes('yahoo')) return pricesUp ? ok(chart) : { ok: false, status: 429 };
    if (url.includes('cftc')) return ok([{ report_date_as_yyyy_mm_dd: '2026-11-17T00:00:00.000', m_money_positions_long_all: '1', m_money_positions_short_all: '2', open_interest_all: '3', lev_money_positions_long: '1', lev_money_positions_short: '1', asset_mgr_positions_long: '1', asset_mgr_positions_short: '1' }]);
    if (url.includes('faireconomy')) return ok([{ title: 'CPI m/m', country: 'USD', date: '2026-12-10T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.2%' }]);
    return ok(`<rss><item><title>Gold rises</title><link>https://n.com/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></rss>`);
  };
  const b = await m.getMacro(fake(true));
  assert.equal(b.status.fred.ok, false);
  assert.match(b.status.fred.error, /FRED/);
  assert.equal(b.prices.XAUUSD.daily.length, 1200);
  assert.equal(b.cot.XAUUSD.rows[0][1], 1);
  assert.equal(b.calendar[0].impact, 'high');
  assert.equal(b.headlines[0].title, 'Gold rises');
  assert.ok(b.events.length > 400);
  m._resetMacroCache();
  _resetNewsCache();
  await assert.rejects(m.getMacro(fake(false)), /prices are unavailable/);
});
