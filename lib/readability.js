'use strict';

// Selkolukuisuuden mittarit. LIX toimii sekä suomelle että englannille,
// Flesch Reading Ease lasketaan vain englanninkieliselle tekstille.

const FI_HINTS = [
  'ja', 'on', 'ei', 'että', 'se', 'oli', 'kun', 'mutta', 'myös', 'tai',
  'ovat', 'voi', 'tämä', 'sekä', 'jos', 'kuin', 'niin', 'hän', 'olla', 'sinun',
];
const EN_HINTS = [
  'the', 'and', 'is', 'of', 'to', 'in', 'that', 'it', 'for', 'you',
  'with', 'are', 'on', 'this', 'be', 'as', 'was', 'or', 'your', 'can',
];

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[A-ZÅÄÖÜ0-9"“'(])/u)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
}

function words(text) {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

function detectLanguage(text, declared) {
  const decl = (declared || '').toLowerCase().slice(0, 2);
  if (decl === 'fi' || decl === 'en') return decl;
  const ws = words(text.toLowerCase()).slice(0, 2000);
  let fi = 0;
  let en = 0;
  const fiSet = new Set(FI_HINTS);
  const enSet = new Set(EN_HINTS);
  for (const w of ws) {
    if (fiSet.has(w)) fi++;
    if (enSet.has(w)) en++;
    if (/[äö]/.test(w)) fi += 0.5;
  }
  if (fi === 0 && en === 0) return decl || 'tuntematon';
  return fi >= en ? 'fi' : 'en';
}

function countSyllablesEn(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function lixLevel(lix) {
  if (lix < 30) return 'Hyvin helppo';
  if (lix < 40) return 'Helppo';
  if (lix < 50) return 'Keskivaikea';
  if (lix < 60) return 'Vaikea';
  return 'Hyvin vaikea';
}

/**
 * Analysoi tekstin. Palauttaa luvut sekä listat pisimmistä lauseista ja
 * sanoista, joita kannattaa lyhentää.
 */
function analyzeText(text, declaredLang) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const lang = detectLanguage(clean, declaredLang);
  const sentences = splitSentences(clean);
  const allWords = words(clean);
  const wordCount = allWords.length;
  const sentenceCount = Math.max(1, sentences.length);

  if (wordCount === 0) {
    return { lang, wordCount: 0, sentenceCount: 0, empty: true };
  }

  // Suomessa yhdyssanat ovat pitkiä, joten "erittäin pitkän" sanan raja on
  // korkeampi kuin englannissa.
  const veryLongLimit = lang === 'fi' ? 16 : 13;
  const longSentenceLimit = lang === 'fi' ? 15 : 20;

  const longWords = allWords.filter((w) => w.length > 6).length;
  const totalChars = allWords.reduce((n, w) => n + w.length, 0);
  const avgSentence = wordCount / sentenceCount;
  const lix = avgSentence + (100 * longWords) / wordCount;

  const sentenceInfo = sentences.map((s) => ({ text: s, words: words(s).length }));
  const longSentences = sentenceInfo
    .filter((s) => s.words > longSentenceLimit)
    .sort((a, b) => b.words - a.words);

  const veryLongWordCounts = new Map();
  for (const w of allWords) {
    if (w.length >= veryLongLimit && !/^\p{N}+$/u.test(w)) {
      const key = w.toLowerCase();
      veryLongWordCounts.set(key, (veryLongWordCounts.get(key) || 0) + 1);
    }
  }
  const veryLongWords = [...veryLongWordCounts.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  const result = {
    lang,
    wordCount,
    sentenceCount: sentences.length,
    avgSentenceLength: round(avgSentence, 1),
    avgWordLength: round(totalChars / wordCount, 1),
    longWordShare: round((100 * longWords) / wordCount, 1),
    lix: round(lix, 1),
    lixLevel: lixLevel(lix),
    longSentenceLimit,
    longSentenceCount: longSentences.length,
    longSentenceShare: round((100 * longSentences.length) / sentenceCount, 1),
    longestSentences: longSentences.slice(0, 5).map((s) => ({
      words: s.words,
      text: s.text.length > 400 ? s.text.slice(0, 400) + '…' : s.text,
    })),
    veryLongWordLimit: veryLongLimit,
    veryLongWords,
    advice: [],
  };

  if (lang === 'en') {
    const syllables = allWords.reduce((n, w) => n + countSyllablesEn(w), 0);
    result.fleschReadingEase = round(
      206.835 - 1.015 * avgSentence - 84.6 * (syllables / wordCount),
      1
    );
  }

  // Selkokielen ohjeiden suuntaisia neuvoja. Jokaisessa on havainto ja perustelu.
  const READ_WHY =
    'Vaikeasti luettava teksti sulkee pois monia lukijoita: esimerkiksi ihmiset, joilla on lukivaikeus, muistisairaus tai kehitysvamma, sekä ne, jotka opettelevat kieltä. Selkeä teksti nopeuttaa lukemista kaikille ja vähentää väärinymmärryksiä ja yhteydenottoja.';
  const ref = lang === 'fi' ? 'Selkokeskuksen selkokielen ohjeet ja WCAG 2.2, kohta 3.1.5 Lukutaso (AAA)' : 'WCAG 2.2, kohta 3.1.5 Lukutaso (AAA)';
  if (avgSentence > (lang === 'fi' ? 12 : 17)) {
    result.advice.push({
      text: 'Lyhennä lauseita.',
      found: `Lauseet ovat keskimäärin ${round(avgSentence, 1)} sanan mittaisia. Selkeässä tekstissä tavoite on noin ${lang === 'fi' ? '8–12' : '15–17'} sanaa.`,
      why: 'Pitkässä lauseessa lukijan pitää muistaa alku, kun hän pääsee loppuun. Se kuormittaa työmuistia ja hidastaa ymmärtämistä. ' + READ_WHY,
      ref,
    });
  }
  if (result.longSentenceShare > 20) {
    result.advice.push({
      text: 'Jaa pitkät lauseet kahdeksi.',
      found: `${result.longSentenceShare} % lauseista on yli ${longSentenceLimit} sanan pituisia. Pisimmät lauseet näkyvät alla.`,
      why: 'Yksi asia lausetta kohden on helpompi ymmärtää kuin monta sivulauseiden ketjua. Lukija hahmottaa pääasian nopeammin, kun se on omassa lauseessaan. ' + READ_WHY,
      ref,
    });
  }
  if (veryLongWords.length > 0) {
    result.advice.push({
      text: 'Pura pitkät yhdyssanat tai käytä tutumpia ilmauksia.',
      found: `Tekstissä on ${veryLongWordCounts.size} hyvin pitkää sanaa (vähintään ${veryLongLimit} merkkiä). Ne näkyvät alla.`,
      why: 'Pitkät sanat ovat hitaita lukea ja usein virkakieltä. Lukija joutuu pilkkomaan ne mielessään osiin, ja ruudunlukijan ääntämä pitkä sana on vaikea hahmottaa kuulemalla. ' + READ_WHY,
      ref,
    });
  }
  if (lix >= 50) {
    result.advice.push({
      text: 'Tekstin kokonaisvaikeus on korkea.',
      found: `LIX-luku on ${round(lix, 0)}, mikä tarkoittaa vaikeaa tekstiä. Alle 40 on helppoa luettavaa.`,
      why: 'LIX yhdistää lauseiden pituuden ja pitkien sanojen osuuden. Korkea luku ennustaa, että moni lukija ei jaksa lukea tekstiä loppuun tai ymmärrä sitä. ' + READ_WHY,
      ref,
    });
  }
  if (lang === 'fi') {
    result.note =
      'Suomen kielessä sanat ovat pitkiä, joten LIX-luku on suomeksi yleensä korkeampi kuin samantasoisessa englanninkielisessä tekstissä.';
  }

  return result;
}

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

module.exports = { analyzeText, detectLanguage, splitSentences, words, countSyllablesEn };
