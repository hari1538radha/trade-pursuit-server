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
