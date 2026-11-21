import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { rangeCheck, verdictFor, fromYahoo, fromStooq, getRange, _resetRangeCache } = await import('../src/lib/range.js');
const { createApp } = await import('../src/app.js');

const days = (n, range) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, high: 100 + range, low: 100 }));

test('range check averages the last 10 completed candles', () => {
  const candles = [...days(5, 100), ...days(10, 40)]; // older wide days must be ignored
  const r = rangeCheck('XAUUSD', candles, { high: 130, low: 100 });
  assert.equal(r.adr, 40);
  assert.equal(r.days, 10);
  assert.equal(r.todayRange, 30);
  assert.equal(r.pct, 75);
  assert.equal(r.left, 10);
  assert.equal(r.verdict, 'caution');
  assert.equal(r.pdh, 140);
  assert.equal(r.pdl, 100);
  assert.match(r.line, /XAUUSD · 10-day avg range 40 · today 30 \(75%\) · ~10 left · PDH 140 \/ PDL 100/);
});

test('verdict thresholds', () => {
  assert.equal(verdictFor(0.3).key, 'trade');
  assert.equal(verdictFor(0.7).key, 'caution');
  assert.equal(verdictFor(0.95).key, 'stand');
  assert.equal(verdictFor(1.4).key, 'stand');
  assert.equal(verdictFor(null).key, 'closed');
  const closed = rangeCheck('XAGUSD', days(10, 1), null);
  assert.equal(closed.verdict, 'closed');
  assert.equal(closed.left, null);
});

test('yahoo parser splits off today\'s session', () => {
  const ts = (d) => Date.UTC(2026, 10, d, 15) / 1000;
  const json = { chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York', regularMarketDayHigh: 112, regularMarketDayLow: 99, regularMarketPrice: 105 }, timestamp: [ts(18), ts(19), ts(20)], indicators: { quote: [{ high: [110, 111, 110], low: [100, 101, null] }] } }] } };
  const out = fromYahoo({ chart: { result: [{ ...json.chart.result[0], indicators: { quote: [{ high: [110, 111, 110], low: [100, 101, 100] }] } }] } }, Date.UTC(2026, 10, 20, 18));
  assert.equal(out.candles.length, 2);
  assert.deepEqual(out.today, { high: 112, low: 99 });
  assert.equal(fromYahoo(json, Date.UTC(2026, 10, 20, 18)).candles.length, 2, 'drops candles with missing values');
  assert.throws(() => fromYahoo({ chart: { result: null, error: { description: 'No data found' } } }), /No data/);
});

test('stooq parser', () => {
  const csv = 'Date,Open,High,Low,Close\n2026-11-18,1,10,5,7\n2026-11-19,1,12,6,7\n2026-11-20,1,9,8,8\n';
  const out = fromStooq(csv, new Date(Date.UTC(2026, 10, 20, 12)));
  assert.equal(out.candles.length, 2);
  assert.deepEqual(out.today, { high: 9, low: 8 });
  assert.throws(() => fromStooq('<html>'), /Stooq/);
});

test('getRange falls back to the second source and reports both failures', async () => {
  _resetRangeCache();
  const csv = 'Date,Open,High,Low,Close\n' + Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')},1,20,10,15`).join('\n');
  const f = async (url) => (url.includes('yahoo') ? { ok: false, status: 429 } : { ok: true, text: async () => csv });
  const r = await getRange('XAUUSD', f);
  assert.equal(r.source, 'Stooq');
  assert.equal(r.adr, 10);
  _resetRangeCache();
  await assert.rejects(getRange('XAGUSD', async () => ({ ok: false, status: 403 })), (e) => e.status === 502 && /Yahoo Finance: HTTP 403; Stooq: HTTP 403/.test(e.reason));
  await assert.rejects(getRange('DOGE', f), /Unsupported/);
});

test('markets route needs a token', async () => {
  assert.equal((await request(createApp()).get('/api/markets/range')).status, 401);
});
