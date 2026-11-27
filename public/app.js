'use strict';

(function () {
  const form = document.getElementById('check-form');
  const input = document.getElementById('url');
  const submit = document.getElementById('submit');
  const errorEl = document.getElementById('url-error');
  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');

  const fmt = (n, d = 2) => Number(n).toLocaleString('fi-FI', { maximumFractionDigits: d, minimumFractionDigits: 0 });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  input.addEventListener('input', () => { if (!errorEl.hidden) showError(''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) {
      showError('Kirjoita tarkastettavan sivun osoite.');
      input.focus();
      return;
    }
    showError('');
    submit.disabled = true;
    statusEl.hidden = false;
    reportEl.hidden = true;
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Tarkastus epäonnistui. Yritä uudelleen.');
      render(data);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Palvelimeen ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.' : err.message);
    } finally {
      submit.disabled = false;
      statusEl.hidden = true;
    }
  });

  // --- Välilehdet (nuolinäppäintuki) ---
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); selectTab(next); next.focus(); }
    });
  });

  function badge(kind, text) {
    return `<span class="badge ${kind}">${esc(text)}</span>`;
  }

  function render(r) {
    const checked = new Date(r.checkedAt).toLocaleString('fi-FI');
    document.getElementById('report-meta').innerHTML =
      `<strong>${esc(r.title || 'Nimetön sivu')}</strong> · ${esc(r.url)} · tarkastettu ${esc(checked)}`;

    const c = r.contrast;
    const cbWorst = Object.values(r.colorBlindness).reduce((m, x) => Math.max(m, x.affected.length), 0);
    const rd = r.readability;
    const contrastOkShare = c.totalElements ? Math.round(100 * (1 - c.failingElements / c.totalElements)) : 100;

    const cards = [];
    cards.push(card('Kontrastit', `${contrastOkShare} %`,
      c.failingPairs === 0
        ? badge('ok', 'Kaikki tekstit läpäisevät AA-tason')
        : badge('bad', `${c.failingElements} tekstiä ${c.failingPairs} väriparilla jää alle AA-tason`)));
    cards.push(card('Värisokeus', cbWorst === 0 ? 'Ei ongelmia' : `${cbWorst} väriparia`,
      cbWorst === 0
        ? badge('ok', 'Kontrastit säilyvät kaikilla simulaatioilla')
        : badge('warn', 'heikkenee liikaa jollakin värisokeustyypillä')));
    cards.push(card('Linkit', r.links.length === 0 ? 'Kunnossa' : `${r.links.length} ongelmaa`,
      r.links.length === 0
        ? badge('ok', 'Tekstin sisäiset linkit erottuvat')
        : badge('warn', 'erottuu vain värin avulla')));
    if (rd.empty) {
      cards.push(card('Selkolukuisuus', '–', '<span class="empty">Sivulta ei löytynyt luettavaa tekstiä.</span>'));
    } else {
      const lvl = rd.lix < 40 ? 'ok' : rd.lix < 50 ? 'warn' : 'bad';
      cards.push(card('Selkolukuisuus (LIX)', fmt(rd.lix, 0), badge(lvl, rd.lixLevel)));
    }
    document.getElementById('summary-cards').innerHTML = cards.join('');

    renderContrast(c);
    renderColorBlind(r);
    renderReadability(rd);

    selectTab(tabs[0]);
    reportEl.hidden = false;
    document.getElementById('summary-title').setAttribute('tabindex', '-1');
    document.getElementById('summary-title').focus();
  }

  function card(label, value, note) {
    return `<div class="card"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p><p class="note">${note}</p></div>`;
  }

  function swatch(fg, bg, label = 'Aa') {
    return `<span class="swatch" style="color:${esc(fg)};background:${esc(bg)}">${esc(label)}</span>`;
  }

  // --- Kontrastit ---
  function renderContrast(c) {
    const panel = document.getElementById('panel-contrast');
    panel.innerHTML = `
      <h2>Tekstien kontrastit</h2>
      <p>Jokainen näkyvä teksti on ryhmitelty teksti- ja taustavärin mukaan. Tavallisen tekstin pitää yltää vähintään suhteeseen 4,5:1 ja suuren tekstin (vähintään 24 px tai lihavoitu 18,66 px) suhteeseen 3:1 (WCAG AA). AAA-taso vaatii 7:1 ja 4,5:1.</p>
      <div class="filter-bar">
        <label><input type="checkbox" id="only-failing" checked> Näytä vain AA-tason alittavat</label>
        <span class="meta" style="margin:0">Tarkastettu ${c.totalElements} tekstielementtiä, ${c.pairs.length} väriparia.</span>
      </div>
      <div id="contrast-table"></div>`;
    const draw = () => {
      const only = document.getElementById('only-failing').checked;
      const rows = c.pairs.filter((p) => !only || !p.passAA);
      document.getElementById('contrast-table').innerHTML = rows.length === 0
        ? `<p class="empty">${only ? 'Yksikään väripari ei alita AA-tasoa. Hienoa!' : 'Sivulta ei löytynyt tekstiä.'}</p>`
        : `<div class="table-wrap"><table>
            <caption class="sr-only" style="position:absolute;left:-9999px">Väriparit kontrastin mukaan</caption>
            <thead><tr><th scope="col">Väri</th><th scope="col">Kontrasti</th><th scope="col">Taso</th><th scope="col">Tekstejä</th><th scope="col">Esimerkki</th></tr></thead>
            <tbody>${rows.map(contrastRow).join('')}</tbody></table></div>`;
    };
    document.getElementById('only-failing').addEventListener('change', draw);
    draw();
  }

  function contrastRow(p) {
    const level = p.passAAA ? badge('ok', 'AAA') : p.passAA ? badge('ok', 'AA') : badge('bad', 'Hylätty');
    const s = p.samples[0];
    return `<tr>
      <td>${swatch(p.fg, p.bg)}<span class="hexes">${esc(p.fg)} / ${esc(p.bg)}</span></td>
      <td><strong>${fmt(p.ratio)}:1</strong><br><span class="meta">vaatimus ${fmt(p.required, 1)}:1${p.large ? ', suuri teksti' : ''}</span></td>
      <td>${level}${p.bgImage ? '<br><span class="meta">Taustakuva, tarkista käsin</span>' : ''}</td>
      <td>${p.count}</td>
      <td>${s ? `<span class="sample-text">”${esc(s.text)}”</span><code>${esc(s.selector)}</code>` : ''}</td>
    </tr>`;
  }

  // --- Värisokeus ---
  const SIMS = [
    ['normal', 'Tavallinen näkö', ''],
    ['protanopia', 'Punasokeus (protanopia)', 'url(#sim-protanopia)'],
    ['deuteranopia', 'Vihersokeus (deuteranopia)', 'url(#sim-deuteranopia)'],
    ['tritanopia', 'Sinisokeus (tritanopia)', 'url(#sim-tritanopia)'],
    ['achromatopsia', 'Täysi värisokeus (akromatopsia)', 'url(#sim-achromatopsia)'],
  ];

  function renderColorBlind(r) {
    const panel = document.getElementById('panel-colorblind');
    const figures = SIMS.map(([key, label, filter]) => {
      const info = r.colorBlindness[key];
      const note = !info ? '' : info.affected.length === 0 ? badge('ok', 'Ei heikkeneviä pareja') : badge('warn', `${info.affected.length} paria heikkenee`);
      return `<figure>
        <figcaption><span>${esc(label)}</span>${note}</figcaption>
        <div class="shot" tabindex="0" aria-label="${esc(label)}: kuvakaappaus sivusta, vieritettävä"><img src="${r.screenshot}" alt="" style="filter:${filter || 'none'}"></div>
      </figure>`;
    }).join('');

    const lists = SIMS.slice(1).map(([key, label]) => {
      const info = r.colorBlindness[key];
      if (!info || info.affected.length === 0) return '';
      return `<h3>${esc(label)}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Alkuperäinen</th><th scope="col">Värisokealle</th><th scope="col">Kontrasti</th><th scope="col">Tekstejä</th><th scope="col">Esimerkki</th></tr></thead>
          <tbody>${info.affected.map((a) => `<tr>
            <td>${swatch(a.fg, a.bg)}<span class="hexes">${fmt(a.ratio)}:1</span></td>
            <td>${swatch(a.simFg, a.simBg)}<span class="hexes">${esc(a.simFg)} / ${esc(a.simBg)}</span></td>
            <td>${badge('bad', `${fmt(a.simRatio)}:1`)}<br><span class="meta">vaatimus ${fmt(a.required, 1)}:1</span></td>
            <td>${a.count}</td>
            <td><span class="sample-text">${a.sample ? '”' + esc(a.sample) + '”' : ''}</span></td>
          </tr>`).join('')}</tbody></table></div>`;
    }).join('');

    const linkSection = r.links.length === 0 ? '' : `
      <h3>Linkit, jotka erottuvat vain värin perusteella</h3>
      <p>Nämä tekstin sisällä olevat linkit eivät ole alleviivattuja, ja niiden väri eroaa ympäröivästä tekstistä alle 3:1. Värisokea ei välttämättä huomaa niitä linkeiksi (WCAG 1.4.1). Lisää alleviivaus tai muu kuin väriin perustuva tunniste.</p>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Linkki</th><th scope="col">Linkin ja tekstin ero</th><th scope="col">Sijainti</th></tr></thead>
        <tbody>${r.links.map((l) => `<tr>
          <td><span class="sample-text">”${esc(l.text)}”</span></td>
          <td><span class="dot" style="background:${esc(l.linkColor)}"></span><span class="hexes" style="display:inline">linkki ${esc(l.linkColor)}</span><br><span class="dot" style="background:${esc(l.textColor)}"></span><span class="hexes" style="display:inline">teksti ${esc(l.textColor)}</span><br>${badge('warn', `${fmt(l.ratio)}:1`)}</td>
          <td><code>${esc(l.selector)}</code></td>
        </tr>`).join('')}</tbody></table></div>`;

    panel.innerHTML = `
      <h2>Miltä sivu näyttää värisokealle</h2>
      <p>Kuvakaappaukset näyttävät sivun yläosan eri värinäön tyypeillä. Alla on lisäksi väriparit, jotka läpäisevät kontrastivaatimuksen tavallisella näöllä mutta eivät simuloidulla värinäöllä.</p>
      <div class="sim-grid">${figures}</div>
      ${lists || '<p class="empty" style="margin-top:20px">Yksikään väripari ei heikkene simulaatioissa vaatimuksen alle.</p>'}
      ${linkSection}`;
  }

  // --- Selkolukuisuus ---
  function renderReadability(rd) {
    const panel = document.getElementById('panel-readability');
    if (rd.empty) {
      panel.innerHTML = '<h2>Selkolukuisuus</h2><p class="empty">Sivulta ei löytynyt tekstiä analysoitavaksi.</p>';
      return;
    }
    const langName = { fi: 'suomi', en: 'englanti' }[rd.lang] || rd.lang;
    const metric = (label, value, note = '') => `<div class="card"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p>${note ? `<p class="note">${note}</p>` : ''}</div>`;
    const metrics = [
      metric('LIX-luku', fmt(rd.lix, 0), esc(rd.lixLevel)),
      metric('Sanoja lauseessa keskimäärin', fmt(rd.avgSentenceLength, 1)),
      metric('Merkkejä sanassa keskimäärin', fmt(rd.avgWordLength, 1)),
      metric('Pitkiä sanoja (yli 6 merkkiä)', `${fmt(rd.longWordShare, 1)} %`),
      metric(`Pitkiä lauseita (yli ${rd.longSentenceLimit} sanaa)`, `${fmt(rd.longSentenceShare, 1)} %`),
    ];
    if (rd.fleschReadingEase != null) {
      metrics.push(metric('Flesch Reading Ease', fmt(rd.fleschReadingEase, 0), 'Yli 60 on helppolukuista.'));
    }

    panel.innerHTML = `
      <h2>Selkolukuisuus</h2>
      <p>Analysoitu ${rd.wordCount} sanaa ja ${rd.sentenceCount} lausetta. Kieli: ${esc(langName)}.
        LIX-luku lasketaan lauseiden keskipituudesta ja pitkien sanojen osuudesta. Alle 40 on helppoa, yli 50 vaikeaa luettavaa.</p>
      ${rd.note ? `<p class="meta">${esc(rd.note)}</p>` : ''}
      <div class="metrics">${metrics.join('')}</div>
      ${rd.advice.length ? `<h3>Parannusehdotukset</h3><ul class="advice">${rd.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<h3>Parannusehdotukset</h3><p>Teksti on selkeää. Ei erityisiä huomioita.</p>'}
      ${rd.longestSentences.length ? `<h3>Pisimmät lauseet</h3><ol class="sentences">${rd.longestSentences.map((s) => `<li><strong>${s.words} sanaa:</strong> ${esc(s.text)}</li>`).join('')}</ol>` : ''}
      ${rd.veryLongWords.length ? `<h3>Hyvin pitkät sanat (vähintään ${rd.veryLongWordLimit} merkkiä)</h3><ul class="words">${rd.veryLongWords.map((w) => `<li>${esc(w.word)}${w.count > 1 ? ` (${w.count})` : ''}</li>`).join('')}</ul>` : ''}`;
  }
})();
