'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server');
const { FileStore } = require('../lib/store');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('salasanasuojaus', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-auth-'));
  const store = new FileStore(dir);
  await store.init();
  const app = http.createServer(createApp(store, { password: 'testisalasana' }));
  const port = await listen(app);
  t.after(() => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body, cookie) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

  let s = await (await fetch(base + '/api/session')).json();
  assert.deepEqual(s, { required: true, ok: false });

  let r = await post('/api/analyze', { url: 'https://example.com' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).loginRequired, true);
  assert.equal((await fetch(base + '/api/checks')).status, 401);
  // Jaettu raporttilinkki ei vaadi salasanaa (tuntematon id -> 404, ei 401).
  assert.equal((await fetch(base + '/api/checks/eiolemassa1')).status, 404);

  r = await post('/api/login', { password: 'väärä' });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);

  r = await post('/api/login', { password: 'testisalasana' });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.doesNotMatch(setCookie, /testisalasana/);
  const cookie = setCookie.split(';')[0];

  s = await (await fetch(base + '/api/session', { headers: { cookie } })).json();
  assert.deepEqual(s, { required: true, ok: true });
  assert.equal((await fetch(base + '/api/checks', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/checks', { headers: { cookie: 'st_auth=keksitty' } })).status, 401);
});

test('liian monta väärää yritystä estetään', async (t) => {
  const app = http.createServer(createApp(null, { password: 'oikea' }));
  const port = await listen(app);
  t.after(() => app.close());
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'väärä' }),
    });
  }
  assert.equal(last.status, 429);
});

test('ilman salasanaa sivusto on avoin', async (t) => {
  const app = http.createServer(createApp(null, { password: '' }));
  const port = await listen(app);
  t.after(() => app.close());
  const s = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  assert.deepEqual(s, { required: false, ok: true });
});
