'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUserUrl, isPrivateIp, isHostAllowed } = require('../lib/urlguard');

test('lisää https:// puuttuessa', () => {
  assert.equal(parseUserUrl('esimerkki.fi').href, 'https://esimerkki.fi/');
});

test('hylkää muut protokollat ja tunnukset', () => {
  assert.throws(() => parseUserUrl('file:///etc/passwd'));
  assert.throws(() => parseUserUrl('ftp://x.fi'));
  assert.throws(() => parseUserUrl('https://user:pw@x.fi'));
  assert.throws(() => parseUserUrl(''));
});

test('tunnistaa yksityiset osoitteet', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.4', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('localhost ei ole sallittu', async () => {
  assert.equal(await isHostAllowed('localhost'), false);
  assert.equal(await isHostAllowed('127.0.0.1'), false);
  assert.equal(await isHostAllowed('[::1]'), false);
});
