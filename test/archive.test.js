'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeUrl, compareReports } = require('../lib/compare');
const { FileStore, PgStore } = require('../lib/store');
const { createApp } = require('../server');
const { closeBrowser } = require('../lib/analyze');

function fakeReport(over = {}) {
  return {
    url: 'https://www.esimerkki.fi/sivu/',
    title: 'Esimerkki',
    checkedAt: '2026-11-27T10:00:00.000Z',
    contrast: {
      totalElements: 10, failingElements: 2, failingPairs: 1,
      pairs: [{ fg: '#aaaaaa', bg: '#ffffff', large: false, ratio: 2.32, passAA: false, count: 2, samples: [{ text: 'Haalea' }] }],
    },
    colorBlindness: { protanopia: { affected: [] } },
    links: [],
    readability: { lix: 45 },
    overall: { score: 80, grade: 'Hyvä', parts: [{ key: 'contrast', label: 'Kontrastit', points: 40, weight: 50 }] },
    ...over,
  };
}

test('osoitteen yhtenäistys', () => {
  assert.equal(normalizeUrl('https://www.Esimerkki.fi/sivu/#x'), 'esimerkki.fi/sivu');
  assert.equal(normalizeUrl('http://esimerkki.fi'), 'esimerkki.fi/');
  assert.equal(normalizeUrl('https://esimerkki.fi/?a=1'), 'esimerkki.fi/?a=1');
});

test('vertailu löytää korjatut ja uudet ongelmat', () => {
  const prev = fakeReport();
  const cur = fakeReport({
    contrast: {
      totalElements: 10, failingElements: 1, failingPairs: 1,
      pairs: [{ fg: '#999999', bg: '#ffffff', large: false, ratio: 2.85, passAA: false, count: 1, samples: [] }],
    },
    readability: { lix: 40 },
    overall: { score: 90, grade: 'Erinomainen', parts: [{ key: 'contrast', label: 'Kontrastit', points: 45, weight: 50 }] },
  });
  const c = compareReports(cur, prev, { id: 'abc123', checkedAt: prev.checkedAt });
  assert.equal(c.score, 10);
  assert.equal(c.parts[0].delta, 5);
  assert.equal(c.failingElements, -1);
  assert.equal(c.lix, -5);
  assert.equal(c.fixedPairs[0].fg, '#aaaaaa');
  assert.equal(c.newPairs[0].fg, '#999999');
});

async function storeContract(store) {
  const a = await store.save(fakeReport());
  const b = await store.save(fakeReport({ url: 'https://esimerkki.fi/sivu', checkedAt: '2026-11-28T10:00:00.000Z' }));
  await store.save(fakeReport({ url: 'https://muu.fi/', title: 'Muu', checkedAt: '2026-11-28T11:00:00.000Z' }));

  assert.equal((await store.get(a.id)).report.title, 'Esimerkki');
  assert.equal(await store.get('../../etc/passwd'), null);
  assert.equal((await store.previous(b.key, b.checkedAt, b.id)).id, a.id);
  assert.equal(await store.previous(a.key, a.checkedAt, a.id), null);
  assert.equal((await store.history(a.key)).length, 2);

  const sites = await store.sites();
  assert.equal(sites.length, 2);
  assert.equal(sites[0].key, 'muu.fi/');
  assert.equal(sites[1].count, 2);
  assert.equal(sites[1].id, b.id, 'uusin tarkastus edustaa sivua');
  assert.equal((await store.sites('esimerk')).length, 1);
  assert.equal((await store.sites('MUU')).length, 1, 'haku ei välitä kirjainkoosta');
  assert.equal((await store.sites('100%')).length, 0);
}

test('tiedostoarkisto tallentaa, hakee ja ryhmittelee', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkisto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileStore(dir);
  await store.init();
  await storeContract(store);
  // Arkisto säilyy uudelleenkäynnistyksen yli.
  const again = new FileStore(dir);
  await again.init();
  assert.equal((await again.sites()).length, 2);
});

test('PostgreSQL-arkisto toimii samoin', { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL puuttuu' }, async (t) => {
  const store = new PgStore(process.env.TEST_DATABASE_URL);
  await store.init();
  await store.pool.query('TRUNCATE checks');
  t.after(async () => {
    await store.pool.query('TRUNCATE checks');
    await store.pool.end();
  });
  await storeContract(store);
});

test('API tallentaa tarkastuksen ja vertaa edelliseen', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkisto-'));
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.html'));
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const store = new FileStore(dir);
  await store.init();
  const app = http.createServer(createApp(store, { allowPrivate: true }));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(async () => {
    site.close();
    app.close();
    await closeBrowser();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const target = `http://127.0.0.1:${site.address().port}/`;
  const check = () => fetch(base + '/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target }),
  }).then((r) => r.json());

  const first = await check();
  assert.ok(first.id && first.archived);
  assert.equal(first.comparison, null);
  const second = await check();
  assert.equal(second.comparison.previousId, first.id);
  assert.equal(second.comparison.score, 0);
  assert.equal(second.history.length, 2);

  const list = await fetch(base + '/api/checks').then((r) => r.json());
  assert.equal(list.sites.length, 1);
  assert.equal(list.sites[0].count, 2);

  const archived = await fetch(base + '/api/checks/' + first.id).then((r) => r.json());
  assert.equal(archived.id, first.id);
  assert.match(archived.screenshot, /^data:image\/jpeg/);
  assert.equal((await fetch(base + '/api/checks/eiolemassa')).status, 404);
});
