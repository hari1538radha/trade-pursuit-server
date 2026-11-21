// Friends, plan sharing and news: guards, validation and the feed parser. No database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { normalize, getNews, _resetNewsCache } = await import('../src/lib/news.js');
const app = createApp();
const auth = `Bearer ${jwt.sign({ sub: '64b000000000000000000001', u: 'tester' }, config.jwtSecret)}`;

test('friends and shared plans need a token', async () => {
  for (const p of ['/api/friends', '/api/plans', '/api/plans/shared?date=2026-11-21']) {
    assert.equal((await request(app).get(p)).status, 401, p);
  }
  assert.equal((await request(app).post('/api/friends').send({ username: 'x' })).status, 401);
});

test('friend + share input is validated before touching the db', async () => {
  assert.equal((await request(app).post('/api/friends').set('Authorization', auth).send({})).status, 400);
  assert.equal((await request(app).post('/api/friends/nope/accept').set('Authorization', auth)).status, 400);
  assert.equal((await request(app).delete('/api/friends/nope').set('Authorization', auth)).status, 400);
  assert.equal((await request(app).get('/api/plans/shared?date=yesterday').set('Authorization', auth)).status, 400);
  const s = await request(app).post('/api/plans/2026-11-21/share').set('Authorization', auth).send({ userIds: ['junk'] });
  assert.equal(s.status, 400);
});

test('plan input rejects too many chart images', async () => {
  const images = Array.from({ length: 9 }, () => ({ src: 'data:image/jpeg;base64,AA', caption: '' }));
  const r = await request(app).put('/api/plans/2026-11-21').set('Authorization', auth).send({ images });
  assert.equal(r.status, 400);
});

test('news feed rows are normalized and sorted', () => {
  const out = normalize([
    { title: 'CPI m/m', country: 'USD', date: '2026-11-18T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { title: 'Bank Holiday', country: 'jpy', date: '2026-11-17T00:00:00-05:00', impact: 'Holiday', forecast: '', previous: '' },
    { title: 'broken', date: 'not a date' },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].currency, 'JPY');
  assert.equal(out[0].impact, 'holiday');
  assert.equal(out[1].impact, 'high');
  assert.equal(out[1].date, '2026-11-18T13:30:00.000Z');
  assert.equal(normalize('nope').length, 0);
});

test('news is cached and served stale when the feed fails', async () => {
  _resetNewsCache();
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => [{ title: 'NFP', country: 'USD', date: '2026-11-20T08:30:00-05:00', impact: 'High' }] }; };
  const a = await getNews('thisweek', ok);
  const b = await getNews('thisweek', ok);
  assert.equal(calls, 1);
  assert.equal(a.events[0].title, 'NFP');
  assert.equal(b.cached, true);
  await assert.rejects(getNews('lastyear', ok), /Unknown week/);
  _resetNewsCache();
  await assert.rejects(getNews('nextweek', async () => ({ ok: false, status: 429 })), /unavailable/);
});
