'use strict';

// Tämä funktio ajetaan tarkastettavan sivun sisällä (page.evaluate), joten
// se ei saa viitata mihinkään tämän tiedoston ulkopuolella.
function collectPageData(opts) {
  const maxElements = opts.maxElements;
  const maxTextChars = opts.maxTextChars;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();

  // Muuntaa minkä tahansa CSS-värin (myös oklch, color() jne.) [r,g,b,a]-muotoon.
  function parseColor(str) {
    if (colorCache.has(str)) return colorCache.get(str);
    let out = null;
    if (str && str !== 'transparent') {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = str;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000];
    } else {
      out = [0, 0, 0, 0];
    }
    colorCache.set(str, out);
    return out;
  }

  function over(top, bottom) {
    const a = top[3];
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
    ];
  }

  const bgCache = new Map();
  // Laskee elementin näkyvän taustavärin kokoamalla esivanhempien taustat.
  function effectiveBackground(el) {
    if (!el || el.nodeType !== 1) return { rgb: [255, 255, 255], image: false };
    if (bgCache.has(el)) return bgCache.get(el);
    const cs = getComputedStyle(el);
    const parent = el.parentElement ? effectiveBackground(el.parentElement) : { rgb: [255, 255, 255], image: false };
    const bg = parseColor(cs.backgroundColor);
    const hasImage = cs.backgroundImage && cs.backgroundImage !== 'none';
    const res = {
      rgb: bg[3] > 0 ? over(bg, parent.rgb) : parent.rgb,
      // Jos läpinäkymätön taustaväri peittää alemman kuvan, kuva ei vaikuta.
      image: hasImage || (parent.image && bg[3] < 1),
    };
    bgCache.set(el, res);
    return res;
  }

  function isVisible(el, cs, rect) {
    if (rect.width < 2 || rect.height < 2) return false;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (Number(cs.opacity) === 0) return false;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
    let p = el;
    while (p) {
      if (Number(getComputedStyle(p).opacity) === 0) return false;
      p = p.parentElement;
    }
    return true;
  }

  function selectorFor(el) {
    const parts = [];
    let node = el;
    for (let i = 0; node && node.nodeType === 1 && i < 4; i++) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(part + '#' + CSS.escape(node.id));
        break;
      }
      const cls = [...node.classList].filter((c) => c.length < 40).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Kerää elementit, joilla on omaa tekstiä.
  const textByElement = new Map();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
        return NodeFilter.FILTER_REJECT;
      }
      return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const p = n.parentElement;
    textByElement.set(p, (textByElement.get(p) || '') + n.nodeValue);
    if (textByElement.size >= maxElements) break;
  }

  const elements = [];
  for (const [el, text] of textByElement) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, cs, rect)) continue;
    const fg = parseColor(cs.color);
    const bg = effectiveBackground(el);
    elements.push({
      text: text.replace(/\s+/g, ' ').trim().slice(0, 120),
      tag: el.tagName.toLowerCase(),
      selector: selectorFor(el),
      fg,
      bg: bg.rgb.map(Math.round),
      bgImage: bg.image,
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
    });
  }

  // Linkit, jotka erottuvat ympäröivästä tekstistä vain värin avulla (WCAG 1.4.1).
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parent = a.parentElement;
    if (!parent) continue;
    const pcs = getComputedStyle(parent);
    if (pcs.display.startsWith('inline') || pcs.display === 'contents') continue;
    // Linkin on oltava keskellä muuta tekstiä, ei esim. valikossa.
    let siblingText = '';
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) siblingText += n.nodeValue;
    }
    if (siblingText.replace(/\s+/g, '').length < 20) continue;
    const cs = getComputedStyle(a);
    const rect = a.getBoundingClientRect();
    if (!isVisible(a, cs, rect)) continue;
    const decorated =
      cs.textDecorationLine.includes('underline') ||
      [...a.querySelectorAll('*')].some((c) => getComputedStyle(c).textDecorationLine.includes('underline')) ||
      (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') ||
      (cs.backgroundImage && cs.backgroundImage !== 'none');
    if (decorated) continue;
    const boldDiff = Math.abs((parseInt(cs.fontWeight, 10) || 400) - (parseInt(pcs.fontWeight, 10) || 400)) >= 300;
    if (boldDiff) continue;
    links.push({
      text: text.slice(0, 80),
      selector: selectorFor(a),
      linkColor: parseColor(cs.color),
      textColor: parseColor(pcs.color),
      bg: effectiveBackground(a).rgb.map(Math.round),
    });
    if (links.length >= 200) break;
  }

  // Teksti luettavuusanalyysiin: pääsisältö, jos sellainen löytyy.
  const main =
    document.querySelector('main, [role="main"], article') || document.body || document.documentElement;
  const blocks = [];
  for (const el of main.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dd, figcaption')) {
    if (el.closest('nav, header, footer, aside, [role="navigation"]') && main === document.body) continue;
    if (el.querySelector('p, li')) continue;
    let t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // Otsikoista ja listoista puuttuu usein piste, joten lisätään lauseenloppu.
    if (!/[.!?…:]$/.test(t)) t += '.';
    blocks.push(t);
  }
  let readText = blocks.join(' ');
  if (readText.length < 200) readText = (main.innerText || '').replace(/\s+/g, ' ');

  return {
    title: document.title,
    lang: document.documentElement.getAttribute('lang') || '',
    elements,
    links,
    text: readText.slice(0, maxTextChars),
  };
}

module.exports = { collectPageData };
