'use strict';

const { chromium } = require('playwright');
const { collectPageData } = require('./collect');
const {
  contrastRatio,
  blend,
  isLargeText,
  thresholds,
  simulate,
  toHex,
  suggestColor,
  SIMULATIONS,
} = require('./contrast');
const { analyzeText } = require('./readability');
const { checkHost, isHostAllowed } = require('./urlguard');

const VIEWPORT = { width: 1280, height: 800 };
const MAX_SCREENSHOT_HEIGHT = 3000;

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      // /dev/shm on konteissa pieni; ilman tätä Chromium kaatuu isoilla sivuilla.
      .launch({ args: ['--disable-dev-shm-usage'] })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

async function getHealthyBrowser() {
  const b = await getBrowser();
  if (b.isConnected()) return b;
  browserPromise = null;
  return getBrowser();
}

async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close();
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Ryhmittelee tekstielementit väriparien mukaan ja arvioi ne. */
function evaluateContrast(elements) {
  const groups = new Map();
  for (const el of elements) {
    const fg = blend(el.fg, el.bg);
    const large = isLargeText(el.fontSize, el.fontWeight);
    const key = `${toHex(fg)}|${toHex(el.bg)}|${large ? 'L' : 'N'}`;
    let g = groups.get(key);
    if (!g) {
      const ratio = contrastRatio(fg, el.bg);
      const t = thresholds(large);
      g = {
        fg: toHex(fg),
        bg: toHex(el.bg),
        fgRgb: fg,
        bgRgb: el.bg,
        large,
        ratio: round2(ratio),
        required: t.aa,
        passAA: ratio >= t.aa,
        passAAA: ratio >= t.aaa,
        bgImage: false,
        count: 0,
        samples: [],
        rects: [],
      };
      if (!g.passAA) {
        const fix = suggestColor(fg, el.bg, t.aa);
        if (fix) {
          g.suggestion = toHex(fix);
          g.suggestionRatio = round2(contrastRatio(fix, el.bg));
        }
      }
      groups.set(key, g);
    }
    g.count++;
    if (el.bgImage) g.bgImage = true;
    if (!g.passAA && el.rect && g.rects.length < 30) g.rects.push(el.rect);
    if (g.samples.length < 3 && el.text) {
      g.samples.push({ text: el.text, selector: el.selector, fontSize: el.fontSize });
    }
  }
  const pairs = [...groups.values()].sort((a, b) => a.ratio - b.ratio);
  const failing = pairs.filter((p) => !p.passAA);
  return {
    pairs: pairs.map(({ fgRgb, bgRgb, rects, ...rest }) => (rest.passAA ? rest : { ...rest, rects })),
    totalElements: elements.length,
    failingElements: failing.reduce((n, p) => n + p.count, 0),
    failingPairs: failing.length,
    _raw: pairs,
  };
}

/** Kertoo, mitkä väriparit muuttuvat liian heikoiksi värisokealle. */
function evaluateColorBlindness(rawPairs) {
  const result = {};
  for (const type of Object.keys(SIMULATIONS)) {
    const affected = [];
    for (const p of rawPairs) {
      if (!p.passAA) continue; // Jo valmiiksi heikot näkyvät kontrastilistassa.
      const sfg = simulate(p.fgRgb, type);
      const sbg = simulate(p.bgRgb, type);
      const ratio = contrastRatio(sfg, sbg);
      if (ratio < p.required) {
        affected.push({
          fg: p.fg,
          bg: p.bg,
          simFg: toHex(sfg),
          simBg: toHex(sbg),
          ratio: p.ratio,
          simRatio: round2(ratio),
          required: p.required,
          count: p.count,
          sample: p.samples[0] ? p.samples[0].text : '',
        });
      }
    }
    result[type] = { label: SIMULATIONS[type].label, affected };
  }
  return result;
}

/** Linkit, jotka erottuvat tekstistä vain värin perusteella liian heikosti. */
function evaluateLinks(links) {
  const issues = [];
  const seen = new Set();
  for (const l of links) {
    const lc = blend(l.linkColor, l.bg);
    const tc = blend(l.textColor, l.bg);
    const ratio = contrastRatio(lc, tc);
    if (ratio >= 3) continue;
    const key = `${toHex(lc)}|${toHex(tc)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      text: l.text,
      selector: l.selector,
      linkColor: toHex(lc),
      textColor: toHex(tc),
      ratio: round2(ratio),
    });
  }
  return issues;
}

/**
 * Kokonaisarvosana 0–100. Painot: kontrastit 50, värisokeus 20, linkit 10,
 * selkolukuisuus 20.
 */
function overallScore({ contrast, colorBlindness, links, readability }) {
  const parts = [];
  const contrastShare = contrast.totalElements ? 1 - contrast.failingElements / contrast.totalElements : 1;
  parts.push({ key: 'contrast', label: 'Kontrastit', weight: 50, score: contrastShare });

  const passingPairs = contrast.pairs.filter((p) => p.passAA).length;
  const worst = Object.values(colorBlindness).reduce((m, c) => Math.max(m, c.affected.length), 0);
  parts.push({
    key: 'colorblind', label: 'Värisokeus', weight: 20,
    score: passingPairs ? 1 - Math.min(1, worst / passingPairs) : 1,
  });
  parts.push({ key: 'links', label: 'Linkit', weight: 10, score: Math.max(0, 1 - links.length / 5) });

  if (!readability.empty) {
    // LIX 40 tai alle = täydet pisteet, 65 tai yli = nolla.
    const r = Math.min(1, Math.max(0, (65 - readability.lix) / 25));
    parts.push({ key: 'readability', label: 'Selkolukuisuus', weight: 20, score: r });
  }
  const totalWeight = parts.reduce((n, p) => n + p.weight, 0);
  const score = Math.round((100 * parts.reduce((n, p) => n + p.weight * p.score, 0)) / totalWeight);
  const grade = score >= 90 ? 'Erinomainen' : score >= 75 ? 'Hyvä' : score >= 50 ? 'Tyydyttävä' : 'Heikko';
  return {
    score,
    grade,
    parts: parts.map((p) => ({ ...p, points: Math.round(p.weight * p.score) })),
  };
}

/** Muuttaa selaimen latausvirheen käyttäjälle ymmärrettäväksi viestiksi. */
function navigationErrorMessage(err, hostname) {
  const msg = String(err && err.message);
  if (/Timeout|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i.test(msg)) {
    return 'Sivu latautui liian hitaasti, ja tarkastus keskeytettiin. Yritä hetken päästä uudelleen.';
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) {
    return `Palvelinta ${hostname} ei löytynyt. Tarkista osoitteen kirjoitusasu.`;
  }
  if (/ERR_CERT|ERR_SSL|SSL_PROTOCOL/.test(msg)) {
    return 'Sivuston suojattu yhteys (HTTPS-varmenne) ei ole kunnossa, joten sivua ei voitu avata turvallisesti.';
  }
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/.test(msg)) {
    return 'Sivuston palvelin katkaisi yhteyden. Sivusto voi olla hetkellisesti alhaalla tai estää automaattiset tarkastukset.';
  }
  if (/ERR_BLOCKED_BY_CLIENT/.test(msg)) {
    return 'Sivu ohjasi osoitteeseen, jota ei turvallisuussyistä voi tarkastaa.';
  }
  if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) {
    return 'Sivu ohjaa itseään loputtomasti uudelleen, joten sitä ei voitu avata.';
  }
  if (/ERR_ABORTED|Download is starting/.test(msg)) {
    return 'Osoite ei avaa verkkosivua vaan esimerkiksi ladattavan tiedoston.';
  }
  return 'Sivua ei saatu ladattua. Tarkista osoite tai yritä myöhemmin uudelleen.';
}

/** Viesti, kun sivun palvelin vastasi virhekoodilla. */
function httpErrorMessage(status) {
  if (status === 401 || status === 403 || status === 429) {
    return `Sivusto ei päästänyt tarkastajaa sisään (HTTP ${status}). Osa sivustoista estää automaattiset tarkastukset tai vaatii kirjautumisen.`;
  }
  if (status === 404 || status === 410) {
    return `Sivua ei löytynyt (HTTP ${status}). Tarkista osoite.`;
  }
  if (status >= 500) {
    return `Sivuston palvelimessa on häiriö (HTTP ${status}). Yritä myöhemmin uudelleen.`;
  }
  return `Sivu vastasi virhekoodilla ${status}, joten sitä ei voitu tarkastaa.`;
}

/**
 * Ottaa kuvakaappauksen. Ilmaisilla palvelimilla koko sivun kaappaus voi olla hidas,
 * joten kaappaus otetaan suurennetusta näkymästä ja epäonnistuessa vain näkyvästä osasta.
 * Jos sekään ei onnistu, raportti tehdään ilman kuvaa.
 */
async function takeScreenshot(page, height) {
  const opts = { type: 'jpeg', quality: 70, animations: 'disabled', caret: 'hide', timeout: 15_000 };
  try {
    await page.setViewportSize({ width: VIEWPORT.width, height });
    return { buffer: await page.screenshot(opts), height };
  } catch (err) {
    console.warn('Kuvakaappaus epäonnistui, yritetään pienempänä:', err.message.split('\n')[0]);
  }
  try {
    await page.setViewportSize(VIEWPORT);
    return { buffer: await page.screenshot({ ...opts, timeout: 10_000 }), height: VIEWPORT.height };
  } catch (err) {
    console.warn('Kuvakaappaus epäonnistui:', err.message.split('\n')[0]);
    return null;
  }
}

/**
 * Hakee sivun otsattomalla selaimella ja tekee arvion.
 * @param {URL|string} url
 * @param {{allowPrivate?: boolean, timeoutMs?: number}} options
 */
async function analyzeUrl(url, options = {}) {
  const allowPrivate = Boolean(options.allowPrivate);
  const timeoutMs = options.timeoutMs || 30_000;
  const target = typeof url === 'string' ? new URL(url) : url;

  if (!allowPrivate) {
    const hostState = await checkHost(target.hostname);
    if (hostState !== 'ok') {
      const err = new Error(
        hostState === 'private'
          ? 'Osoite osoittaa yksityiseen verkkoon, eikä sitä voi tarkastaa.'
          : `Palvelinta ${target.hostname} ei löytynyt. Tarkista osoitteen kirjoitusasu.`
      );
      err.userFacing = true;
      throw err;
    }
  }

  const browser = await getHealthyBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    locale: 'fi-FI',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Sivutarkastaja/1.0',
  });

  try {
    if (!allowPrivate) {
      // Tarkistetaan jokainen pyyntö, myös uudelleenohjaukset ja alaresurssit.
      await context.route('**/*', async (route) => {
        try {
          const u = new URL(route.request().url());
          if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
          if ((u.protocol === 'http:' || u.protocol === 'https:') && (await isHostAllowed(u.hostname))) {
            return route.continue();
          }
        } catch {
          /* hylätään alla */
        }
        return route.abort('blockedbyclient');
      });
    }

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    let response;
    try {
      // Odotetaan vain HTML:n latautumista: raskailla sivuilla (mainokset, seurantaskriptit)
      // load-tapahtuma voi viipyä kymmeniä sekunteja tai jäädä kokonaan tulematta.
      response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (err) {
      console.warn(`Sivun lataus epäonnistui (${target.href}):`, err.message.split('\n')[0]);
      const e = new Error(navigationErrorMessage(err, target.hostname));
      e.userFacing = true;
      e.cause = err;
      throw e;
    }
    const status = response ? response.status() : null;
    if (status && status >= 400) {
      console.warn(`Sivu vastasi tilakoodilla ${status} (${target.href})`);
      const e = new Error(httpErrorMessage(status));
      e.userFacing = true;
      throw e;
    }
    // Annetaan kuville, tyyleille ja fonteille hetki aikaa, mutta ei jäädä odottamaan loputtomiin.
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    const data = await page.evaluate(collectPageData, { maxElements: 4000, maxTextChars: 60_000 });

    const fullHeight = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
    );
    const shotHeight = Math.min(Math.max(fullHeight, VIEWPORT.height), MAX_SCREENSHOT_HEIGHT);
    const shot = await takeScreenshot(page, shotHeight);

    const contrast = evaluateContrast(data.elements);
    const colorBlindness = evaluateColorBlindness(contrast._raw);
    delete contrast._raw;

    const links = evaluateLinks(data.links);
    const readability = analyzeText(data.text, data.lang);

    return {
      url: page.url(),
      status,
      title: data.title,
      lang: data.lang,
      checkedAt: new Date().toISOString(),
      contrast,
      colorBlindness,
      links,
      readability,
      overall: overallScore({ contrast, colorBlindness, links, readability }),
      screenshot: shot ? 'data:image/jpeg;base64,' + shot.buffer.toString('base64') : null,
      screenshotSize: shot ? { width: VIEWPORT.width, height: shot.height } : null,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { analyzeUrl, navigationErrorMessage, httpErrorMessage, closeBrowser, overallScore, evaluateContrast, evaluateColorBlindness, evaluateLinks };
