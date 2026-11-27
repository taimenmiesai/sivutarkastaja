'use strict';

// Vertailee kahta saman sivun tarkastusta ja kertoo, mikä muuttui.

/** Yhtenäistää osoitteen, jotta saman sivun tarkastukset löytyvät yhdessä. */
function normalizeUrl(href) {
  const u = new URL(href);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  let path = u.pathname.replace(/\/+$/, '');
  if (!path) path = '/';
  // Protokolla jätetään pois: http- ja https-versio ovat sama sivu.
  return u.hostname + (u.port ? ':' + u.port : '') + path + u.search;
}

/** Tiivistelmä, joka tallennetaan jokaisesta tarkastuksesta listauksia varten. */
function summarize(report) {
  const cb = report.colorBlindness || {};
  return {
    score: report.overall ? report.overall.score : null,
    grade: report.overall ? report.overall.grade : null,
    parts: report.overall ? report.overall.parts.map(({ key, label, points, weight }) => ({ key, label, points, weight })) : [],
    failingPairs: report.contrast.failingPairs,
    failingElements: report.contrast.failingElements,
    totalElements: report.contrast.totalElements,
    colorBlindPairs: Object.values(cb).reduce((m, c) => Math.max(m, c.affected.length), 0),
    linkIssues: report.links.length,
    lix: report.readability.empty ? null : report.readability.lix,
  };
}

const pairKey = (p) => `${p.fg}|${p.bg}|${p.large ? 'L' : 'N'}`;

/** Laskee muutokset edelliseen tarkastukseen. */
function compareReports(current, previous, previousMeta) {
  const cur = summarize(current);
  const prev = summarize(previous);
  const delta = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

  const prevFailing = new Map(previous.contrast.pairs.filter((p) => !p.passAA).map((p) => [pairKey(p), p]));
  const curFailing = new Map(current.contrast.pairs.filter((p) => !p.passAA).map((p) => [pairKey(p), p]));
  const strip = (p) => ({ fg: p.fg, bg: p.bg, ratio: p.ratio, count: p.count, sample: p.samples[0] ? p.samples[0].text : '' });
  const newPairs = [...curFailing].filter(([k]) => !prevFailing.has(k)).map(([, p]) => strip(p));
  const fixedPairs = [...prevFailing].filter(([k]) => !curFailing.has(k)).map(([, p]) => strip(p));

  const prevParts = new Map(prev.parts.map((p) => [p.key, p]));
  return {
    previousId: previousMeta.id,
    previousCheckedAt: previousMeta.checkedAt,
    score: delta(cur.score, prev.score),
    parts: cur.parts.map((p) => ({
      key: p.key,
      label: p.label,
      points: p.points,
      delta: prevParts.has(p.key) ? p.points - prevParts.get(p.key).points : null,
    })),
    failingElements: delta(cur.failingElements, prev.failingElements),
    colorBlindPairs: delta(cur.colorBlindPairs, prev.colorBlindPairs),
    linkIssues: delta(cur.linkIssues, prev.linkIssues),
    lix: delta(cur.lix, prev.lix),
    newPairs,
    fixedPairs,
  };
}

module.exports = { normalizeUrl, summarize, compareReports };
