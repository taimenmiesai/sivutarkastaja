'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contrastRatio, blend, isLargeText, simulate } = require('../lib/contrast');

test('mustan ja valkoisen kontrasti on 21:1', () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
});

test('tunnettu raja-arvo #767676 valkoisella on noin 4,54:1', () => {
  const r = contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]);
  assert.ok(r > 4.5 && r < 4.6, String(r));
});

test('läpikuultava väri sekoittuu taustaan', () => {
  assert.deepEqual(blend([0, 0, 0, 0.5], [255, 255, 255]), [128, 128, 128]);
  assert.deepEqual(blend([10, 20, 30, 1], [255, 255, 255]), [10, 20, 30]);
});

test('suuren tekstin raja', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(19, 700), true);
  assert.equal(isLargeText(19, 400), false);
  assert.equal(isLargeText(16, 700), false);
});

test('simulaatio säilyttää harmaan ja muuttaa punaisen', () => {
  for (const t of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
    const g = simulate([128, 128, 128], t);
    g.forEach((c) => assert.ok(Math.abs(c - 128) <= 2, `${t}: ${g}`));
  }
  const red = simulate([255, 0, 0], 'achromatopsia');
  assert.equal(red[0], red[1]);
  assert.equal(red[1], red[2]);
});
