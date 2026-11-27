'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeText, detectLanguage, splitSentences } = require('../lib/readability');

test('tunnistaa suomen ja englannin', () => {
  assert.equal(detectLanguage('Tämä on suomea ja se on helppoa.', ''), 'fi');
  assert.equal(detectLanguage('This is the text and it is in English.', ''), 'en');
  assert.equal(detectLanguage('whatever', 'fi-FI'), 'fi');
});

test('jakaa lauseet', () => {
  assert.deepEqual(splitSentences('Eka lause. Toka lause! Kolmas?'), ['Eka lause.', 'Toka lause!', 'Kolmas?']);
});

test('lyhyt suomenkielinen teksti on helppoa', () => {
  const r = analyzeText('Kissa istuu. Koira syö. Sää on hyvä.', 'fi');
  assert.equal(r.lang, 'fi');
  assert.equal(r.sentenceCount, 3);
  assert.equal(r.wordCount, 7);
  assert.ok(r.lix < 40, String(r.lix));
  assert.equal(r.advice.length, 0);
});

test('pitkä ja raskas teksti saa neuvoja', () => {
  const long = 'Kansalaisjärjestötoimintaavustusjärjestelmän uudistamistoimenpidekokonaisuuden valmistelutyöryhmä kokoontui eilen keskustelemaan erittäin pitkistä ja monimutkaisista lauseista, joita on vaikea ymmärtää ilman useaa lukukertaa ja syvällistä perehtymistä aiheeseen.';
  const r = analyzeText(long, 'fi');
  assert.ok(r.lix > 60);
  assert.equal(r.longestSentences.length, 1);
  assert.ok(r.veryLongWords.length >= 2);
  assert.ok(r.advice.length >= 2);
  for (const a of r.advice) assert.ok(a.text && a.found && a.why, 'neuvossa on havainto ja perustelu');
});

test('englannille lasketaan Flesch', () => {
  const r = analyzeText('The cat sat on the mat. It was a good day.', 'en');
  assert.ok(r.fleschReadingEase > 80);
});

test('tyhjä teksti', () => {
  assert.equal(analyzeText('', 'fi').empty, true);
});
