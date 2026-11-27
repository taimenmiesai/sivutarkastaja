'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { analyzeUrl, closeBrowser, navigationErrorMessage, httpErrorMessage } = require('../lib/analyze');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('latausvirheet saavat selkeän viestin', () => {
  assert.match(navigationErrorMessage(new Error('page.goto: Timeout 30000ms exceeded.'), 'x.fi'), /liian hitaasti/);
  assert.match(navigationErrorMessage(new Error('net::ERR_NAME_NOT_RESOLVED'), 'x.fi'), /x\.fi ei löytynyt/);
  assert.match(navigationErrorMessage(new Error('net::ERR_CERT_DATE_INVALID'), 'x.fi'), /varmenne/);
  assert.match(navigationErrorMessage(new Error('net::ERR_CONNECTION_RESET'), 'x.fi'), /katkaisi yhteyden/);
  assert.match(httpErrorMessage(403), /HTTP 403/);
  assert.match(httpErrorMessage(404), /ei löytynyt/);
  assert.match(httpErrorMessage(503), /häiriö/);
});

test('virhekoodilla vastaava sivu ei tuota raporttia', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Estetty</title><p>Pääsy estetty</p>');
  });
  const port = await listen(server);
  t.after(async () => { server.close(); await closeBrowser(); });
  await assert.rejects(analyzeUrl(`http://127.0.0.1:${port}/`, { allowPrivate: true }), (err) => {
    assert.ok(err.userFacing);
    assert.match(err.message, /HTTP 403/);
    return true;
  });
});

test('hidas lisäsisältö ei estä tarkastusta', async (t) => {
  // Kuva, joka ei koskaan lataudu: load-tapahtuma ei tule, mutta tarkastus valmistuu.
  const server = http.createServer((req, res) => {
    if (req.url === '/hidas.png') return; // ei vastata koskaan
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="fi"><title>Hidas</title><p style="height:5000px">Teksti on tässä.</p><img src="/hidas.png" alt="">');
  });
  const port = await listen(server);
  t.after(async () => { server.closeAllConnections(); server.close(); await closeBrowser(); });
  const started = Date.now();
  const r = await analyzeUrl(`http://127.0.0.1:${port}/`, { allowPrivate: true });
  assert.equal(r.title, 'Hidas');
  assert.match(r.screenshot, /^data:image\/jpeg;base64,/);
  assert.equal(r.screenshotSize.height, 3000);
  assert.ok(Date.now() - started < 25_000);
});

test('rinnakkaiset tarkastukset odottavat jonossa eivätkä saa kiireinen-virhettä', async (t) => {
  const { createApp } = require('../server');
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="fi"><title>Jono</title><p>Lyhyt teksti tässä.</p>');
  });
  const sitePort = await listen(site);
  const app = http.createServer(createApp(null, { allowPrivate: true }));
  const appPort = await listen(app);
  t.after(async () => { site.close(); app.close(); await closeBrowser(); });
  const call = () => fetch(`http://127.0.0.1:${appPort}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${sitePort}/` }),
  }).then((r) => r.status);
  const statuses = await Promise.all([call(), call(), call(), call()]);
  assert.deepEqual(statuses, [200, 200, 200, 200]);
});
