'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeUrl, closeBrowser } = require('../lib/analyze');
const { createApp } = require('../server');

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.html'));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('analysoi testisivun', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  const port = await listen(server);
  t.after(async () => { server.close(); await closeBrowser(); });

  const r = await analyzeUrl(`http://127.0.0.1:${port}/`, { allowPrivate: true });
  assert.equal(r.title, 'Testisivu');
  assert.equal(r.lang, 'fi');
  assert.match(r.screenshot, /^data:image\/jpeg;base64,/);

  const find = (fg, bg) => r.contrast.pairs.find((p) => p.fg === fg && p.bg === bg);
  const faint = find('#aaaaaa', '#ffffff');
  assert.ok(faint && !faint.passAA, 'haalea teksti hylätään');
  assert.match(faint.suggestion, /^#[0-9a-f]{6}$/);
  assert.ok(faint.suggestionRatio >= 4.5);
  assert.equal(faint.rects.length, 1);
  assert.ok(r.overall.score > 0 && r.overall.score < 100);
  assert.equal(r.overall.parts.length, 4);
  assert.equal(r.screenshotSize.width, 1280);
  const big = find('#888888', '#ffffff');
  assert.ok(big && big.large && big.passAA, 'suuri teksti läpäisee 3:1');
  assert.ok(find('#ffffff', '#000000').passAAA, 'valkoinen mustalla');
  const alpha = r.contrast.pairs.find((p) => p.samples.some((s) => s.text === 'Läpikuultava teksti.'));
  assert.match(alpha.fg, /^#b[23]b[23]b[23]$/);
  assert.ok(!alpha.passAA);

  const allText = r.contrast.pairs.flatMap((p) => p.samples.map((s) => s.text)).join(' ');
  assert.doesNotMatch(allText, /Piilotettu/);

  assert.equal(r.links.length, 1, 'huomaamaton linkki löytyy');
  assert.equal(r.links[0].text, 'huomaamaton linkki');

  assert.equal(r.readability.lang, 'fi');
  assert.ok(r.readability.veryLongWords.length > 0);
  assert.ok(r.readability.longestSentences.length >= 1);

  for (const k of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
    assert.ok(Array.isArray(r.colorBlindness[k].affected));
  }
});

test('API hylkää sisäverkon osoitteen', async (t) => {
  const server = http.createServer(createApp());
  const port = await listen(server);
  t.after(() => server.close());
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let res = await post({ url: 'http://127.0.0.1:1/' });
  assert.equal(res.status, 422);
  res = await post({ url: 'javascript:alert(1)' });
  assert.equal(res.status, 400);
  res = await post({});
  assert.equal(res.status, 400);
});
