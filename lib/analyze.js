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

/**
 * Hakee sivun otsattomalla selaimella ja tekee arvion.
 * @param {URL|string} url
 * @param {{allowPrivate?: boolean, timeoutMs?: number}} options
 */
async function analyzeUrl(url, options = {}) {
  const allowPrivate = Boolean(options.allowPrivate);
  const timeoutMs = options.timeoutMs || 25_000;
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
      response = await page.goto(target.href, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      const e = new Error('Sivua ei saatu ladattua. Tarkista osoite tai yritä myöhemmin uudelleen.');
      e.userFacing = true;
      e.cause = err;
      throw e;
    }
    // Annetaan myöhään latautuville tyyleille ja fonteille hetki aikaa.
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});

    const data = await page.evaluate(collectPageData, { maxElements: 4000, maxTextChars: 60_000 });

    const fullHeight = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
    );
    const shot = await page.screenshot({
      type: 'jpeg',
      quality: 70,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(Math.max(fullHeight, VIEWPORT.height), MAX_SCREENSHOT_HEIGHT) },
      fullPage: true,
    });

    const contrast = evaluateContrast(data.elements);
    const colorBlindness = evaluateColorBlindness(contrast._raw);
    delete contrast._raw;

    const links = evaluateLinks(data.links);
    const readability = analyzeText(data.text, data.lang);
    const shotHeight = Math.min(Math.max(fullHeight, VIEWPORT.height), MAX_SCREENSHOT_HEIGHT);

    return {
      url: page.url(),
      status: response ? response.status() : null,
      title: data.title,
      lang: data.lang,
      checkedAt: new Date().toISOString(),
      contrast,
      colorBlindness,
      links,
      readability,
      overall: overallScore({ contrast, colorBlindness, links, readability }),
      screenshot: 'data:image/jpeg;base64,' + shot.toString('base64'),
      screenshotSize: { width: VIEWPORT.width, height: shotHeight },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { analyzeUrl, closeBrowser, overallScore, evaluateContrast, evaluateColorBlindness, evaluateLinks };
