// Runs without a database: covers routing, auth guards and validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const app = createApp();
const token = jwt.sign({ sub: '64b000000000000000000001', u: 'tester' }, config.jwtSecret); // admin
const userToken = jwt.sign({ sub: '64b000000000000000000002', u: 'friend' }, config.jwtSecret); // normal user
// No database in these tests: roles come from this stub
const { roles } = await import('../src/middleware/auth.js');
roles.lookup = async (id) => (id === '64b000000000000000000001' ? 'admin' : id === '64b000000000000000000002' ? 'user' : null);

test('health + firms', async () => {
  assert.equal((await request(app).get('/api/health')).body.ok, true);
  const f = await request(app).get('/api/firms');
  assert.ok(f.body.firms.length >= 10);
});

test('protected routes need a token', async () => {
  for (const p of ['/api/trades', '/api/accounts', '/api/plans/2026-11-21', '/api/auth/me']) {
    assert.equal((await request(app).get(p)).status, 401, p);
  }
  assert.equal((await request(app).get('/api/trades').set('Authorization', 'Bearer junk')).status, 401);
});

test('register validates username and password', async () => {
  const a = await request(app).post('/api/auth/register').send({ username: 'a', password: 'secret1' });
  assert.equal(a.status, 400);
  const b = await request(app).post('/api/auth/register').send({ username: 'hari', password: '123' });
  assert.equal(b.status, 400);
  assert.match(b.body.error, /password/);
});

test('trade input is validated before touching the db', async () => {
  const r = await request(app).post('/api/trades').set('Authorization', `Bearer ${token}`).send({ date: '21/11/2026' });
  assert.equal(r.status, 400);
  const r2 = await request(app).post('/api/trades').set('Authorization', `Bearer ${token}`).send({ date: '2026-11-21', direction: 'up' });
  assert.equal(r2.status, 400);
});

test('unknown route is 404 json', async () => {
  const r = await request(app).get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'Not found');
});

test('notes and quiz are protected and validated', async () => {
  assert.equal((await request(app).get('/api/notes')).status, 401);
  assert.equal((await request(app).get('/api/quiz')).status, 401);
  const bad = await request(app).post('/api/notes').set('Authorization', `Bearer ${token}`).send({ title: '' });
  assert.equal(bad.status, 400);
  const badq = await request(app).post('/api/quiz').set('Authorization', `Bearer ${token}`).send({ score: 3 });
  assert.equal(badq.status, 400);
});

test('market routes are protected and validated', async () => {
  for (const p of ['/api/options/history?key=NIFTY&expiry=2026-11-25', '/api/options/ticks?key=NIFTY&expiry=2026-11-25', '/api/options/live?key=NIFTY&expiry=2026-11-25', '/api/options/recorders', '/api/options/strike-series?key=NIFTY&expiry=2026-11-25&strikes=1', '/api/stocks/scan', '/api/watchlist']) {
    assert.equal((await request(app).get(p)).status, 401, p);
  }
  assert.equal((await request(app).post('/api/options/chain').send({})).status, 401);
  const bad = await request(app).post('/api/options/chain').set('Authorization', `Bearer ${token}`).send({ cookie: 'access_token=x; y=z', underlying: 'NIFTY', expiry: 'tomorrow' });
  assert.equal(bad.status, 400);
  assert.equal((await request(app).put('/api/options/recorders').send({})).status, 401);
  const badRec = await request(app).put('/api/options/recorders').set('Authorization', `Bearer ${token}`).send({ underlying: 'NIFTY', expiry: 'soon' });
  assert.equal(badRec.status, 400);
});

test('roles: normal users are kept out of admin-only areas', async () => {
  const asUser = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${userToken}`);
  for (const p of ['/api/me/money/entries', '/api/me/money/emis', '/api/me/props/purchases', '/api/me/props/payouts', '/api/me/life/days', '/api/admin/users', '/api/notes', '/api/quiz', '/api/options/recorders', '/api/stocks/scan', '/api/watchlist', '/api/markets/goldbach?symbol=XAUUSD']) {
    const r = await asUser('get', p);
    assert.equal(r.status, 403, p);
    assert.match(r.body.error, /admins only/);
  }
  assert.equal((await asUser('post', '/api/options/chain').send({})).status, 403);
  assert.equal((await asUser('patch', '/api/admin/users/64b000000000000000000001/role').send({ role: 'user' })).status, 403);
  // An admin passes the guard (then hits validation)
  const a = await request(app).patch('/api/admin/users/64b000000000000000000002/role').set('Authorization', `Bearer ${token}`).send({ role: 'boss' });
  assert.equal(a.status, 400);
  // Signed-out still gets 401
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
});

test('personal tracking validates input (admin)', async () => {
  const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${token}`);
  assert.equal((await as('post', '/api/me/money/entries').send({ kind: 'expense', date: '23-11-2026', amount: 100 })).status, 400);
  assert.equal((await as('post', '/api/me/money/entries').send({ kind: 'gift', date: '2026-11-23', amount: 100 })).status, 400);
  assert.equal((await as('post', '/api/me/money/emis').send({ name: 'Bike', amount: 3000, start: '2026-01', months: 0 })).status, 400);
  assert.equal((await as('post', '/api/me/props/payouts').send({ date: '2026-10-22', firm: 'FundingPips', gross: 503 })).status, 400);
  assert.equal((await as('put', '/api/me/life/days/yesterday').send({})).status, 400);
  assert.equal((await as('put', '/api/me/life/days/2026-11-23').send({ sleep: 'lots' })).status, 400);
});
