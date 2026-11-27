'use strict';

// WCAG 2.x -kontrastilaskenta ja värisokeussimulaatio.

/** sRGB-kanava (0–255) lineaariseksi (0–1). */
function toLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Lineaarinen kanava (0–1) takaisin sRGB:ksi (0–255). */
function fromLinear(v) {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Suhteellinen luminanssi WCAG:n määritelmän mukaan. */
function luminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Kontrastisuhde kahden RGB-värin välillä (1–21). */
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Läpikuultavan värin [r,g,b,a] sekoitus läpinäkymättömän taustan päälle. */
function blend([r, g, b, a], [br, bg, bb]) {
  const alpha = a === undefined ? 1 : a;
  return [
    Math.round(r * alpha + br * (1 - alpha)),
    Math.round(g * alpha + bg * (1 - alpha)),
    Math.round(b * alpha + bb * (1 - alpha)),
  ];
}

/**
 * WCAG: suuri teksti on vähintään 24 px (18 pt) tai lihavoituna vähintään
 * 18,66 px (14 pt).
 */
function isLargeText(fontSizePx, fontWeight) {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

function thresholds(large) {
  return large ? { aa: 3, aaa: 4.5 } : { aa: 4.5, aaa: 7 };
}

// Machado, Oliveira & Fernandes (2009), vakavuus 1.0. Matriisit sovelletaan
// lineaariseen RGB:hen. Akromatopsia on pelkkä luminanssi.
const SIMULATIONS = {
  protanopia: {
    label: 'Punasokeus (protanopia)',
    matrix: [
      0.152286, 1.052583, -0.204868,
      0.114503, 0.786281, 0.099216,
      -0.003882, -0.048116, 1.051998,
    ],
  },
  deuteranopia: {
    label: 'Vihersokeus (deuteranopia)',
    matrix: [
      0.367322, 0.860646, -0.227968,
      0.280085, 0.672501, 0.047413,
      -0.01182, 0.04294, 0.968881,
    ],
  },
  tritanopia: {
    label: 'Sinisokeus (tritanopia)',
    matrix: [
      1.255528, -0.076749, -0.178779,
      -0.078411, 0.930809, 0.147602,
      0.004733, 0.691367, 0.3039,
    ],
  },
  achromatopsia: {
    label: 'Täysi värisokeus (akromatopsia)',
    matrix: [
      0.2126, 0.7152, 0.0722,
      0.2126, 0.7152, 0.0722,
      0.2126, 0.7152, 0.0722,
    ],
  },
};

function simulate(rgb, type) {
  const sim = SIMULATIONS[type];
  if (!sim) throw new Error(`Tuntematon simulaatio: ${type}`);
  const m = sim.matrix;
  const [r, g, b] = rgb.map(toLinear);
  return [
    fromLinear(m[0] * r + m[1] * g + m[2] * b),
    fromLinear(m[3] * r + m[4] * g + m[5] * b),
    fromLinear(m[6] * r + m[7] * g + m[8] * b),
  ];
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Ehdottaa tekstiväriä, joka läpäisee tavoitekontrastin taustaa vasten ja on
 * mahdollisimman lähellä alkuperäistä. Väriä tummennetaan tai vaalennetaan.
 */
function suggestColor(fg, bg, target) {
  const goal = target + 0.05; // pieni varmuusmarginaali pyöristyksiä varten
  if (contrastRatio(fg, bg) >= goal) return null;
  let best = null;
  for (const toward of [[0, 0, 0], [255, 255, 255]]) {
    for (let i = 1; i <= 100; i++) {
      const t = i / 100;
      const c = fg.map((v, k) => Math.round(v + (toward[k] - v) * t));
      if (contrastRatio(c, bg) >= goal) {
        if (!best || t < best.t) best = { t, color: c };
        break;
      }
    }
  }
  return best ? best.color : null;
}

module.exports = {
  suggestColor,
  luminance,
  contrastRatio,
  blend,
  isLargeText,
  thresholds,
  simulate,
  toHex,
  SIMULATIONS,
};
