// Runs the EOD updater end-to-end against fake NSE zip files and a stubbed database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { EodSeries, MarketMeta } from '../src/models/Market.js';

const store = new Map(); let metaDoc = null;
EodSeries.find = () => ({ lean: async () => [...store.values()].map((x) => structuredClone(x)) });
EodSeries.bulkWrite = async (ops) => { for (const o of ops) store.set(o.updateOne.filter.symbol, structuredClone(o.updateOne.update.$set)); };
MarketMeta.findById = () => ({ lean: async () => metaDoc });
MarketMeta.updateOne = async (_f, u) => { metaDoc = { _id: 'nse-eod', ...u.$set }; };

const HEAD = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4';
let day = 0;
globalThis.fetch = async (url) => {
  const m = String(url).match(/_(\d{8})_F_/);
  if (!m) return new Response('', { status: 200 });
  const d = m[1];
  if (d.endsWith('1225')) return new Response('', { status: 404 }); // holiday
  day++;
  const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  const up = 100 + day * 0.2, flat = 50 + Math.sin(day / 5);
  const vol = day === 999 ? 1 : 100000;
  const csv = `${HEAD}\n${date},${date},CM,NSE,STK,1,INE000A01011,UPCO,EQ,,,,,UP CO LTD,${up},${up * 1.01},${up * 0.99},${up},${up},${up - 0.2},,${up},,,${vol},${up * vol},10,F1,1,,,,,\n${date},${date},CM,NSE,STK,2,INE000B01011,FLATCO,EQ,,,,,FLAT CO LTD,${flat},${flat * 1.01},${flat * 0.99},${flat},${flat},${flat},,${flat},,,200000,${flat * 200000},10,F1,1,,,,,\n`;
  return new Response(zipSync({ [`BhavCopy_${d}.csv`]: strToU8(csv) }), { status: 200 });
};

test('EOD update backfills, skips holidays, scans and is incremental', async () => {
  const eod = await import('../src/lib/market/eod.js');
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0); // skip polite delays in tests
  await eod.update({ log: () => {} });
  assert.equal(eod.state.error, null);
  assert.ok(metaDoc.lastDate, 'lastDate set');
  const up = store.get('UPCO');
  assert.ok(up.c.length >= 250 && up.c.length <= 300, `bars=${up.c.length}`);
  assert.ok(!up.d.some((x) => x.endsWith('12-25')), 'holiday skipped');
  const row = metaDoc.results.find((r) => r.symbol === 'UPCO');
  assert.ok(row.tags.includes('uptrend') && row.tags.includes('near-52w-high'), row.tags.join());
  assert.equal(row.isin, 'INE000A01011');
  // second run: nothing pending -> no new downloads
  const before = day;
  await eod.update({ log: () => {} });
  assert.equal(day, before);
  globalThis.setTimeout = realTimeout;
});
