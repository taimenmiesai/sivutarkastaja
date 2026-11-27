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


  async function runCheck(url) {
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
      if (res.status === 401 && data.loginRequired) {
        requireLogin(() => { showView('check'); runCheck(url); });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Tarkastus epäonnistui. Yritä uudelleen.');
      setShareUrl(data, url);
      render(data);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Palvelimeen ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.' : err.message);
      input.focus();
    } finally {
      submit.disabled = false;
      statusEl.hidden = true;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) {
      showError('Kirjoita tarkastettavan sivun osoite.');
      input.focus();
      return;
    }
    runCheck(url);
  });

  for (const chip of document.querySelectorAll('.chip[data-url]')) {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.url;
      runCheck(chip.dataset.url);
    });
  }

  // Jaettava linkki: ?id=... avaa arkistoidun raportin sellaisenaan,
  // ?url=... tekee uuden tarkastuksen.
  function setShareUrl(data, url) {
    const share = new URL(location.href);
    share.hash = '';
    share.searchParams.delete('url');
    share.searchParams.delete('id');
    if (data.id) share.searchParams.set('id', data.id);
    else share.searchParams.set('url', url);
    history.pushState(null, '', share);
  }

  async function loadArchived(id) {
    showView('check');
    showError('');
    statusEl.hidden = false;
    statusEl.querySelector('span:last-child').textContent = 'Haetaan tarkastusta arkistosta.';
    reportEl.hidden = true;
    try {
      const res = await fetch('/api/checks/' + encodeURIComponent(id));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Tarkastusta ei saatu haettua.');
      input.value = data.url;
      render(data);
    } catch (err) {
      showError(err.message);
    } finally {
      statusEl.hidden = true;
      statusEl.querySelector('span:last-child').textContent = 'Haetaan ja tarkastetaan sivua. Tämä kestää yleensä 5–20 sekuntia.';
    }
  }

  // --- Näkymät: tarkastus ja arkisto ---
  const archiveEl = document.getElementById('archive');
  const loginEl = document.getElementById('login');
  const checkViewEl = document.getElementById('check-view');
  function showView(name) {
    const archive = name === 'archive';
    loginEl.hidden = name !== 'login';
    archiveEl.hidden = !archive;
    checkViewEl.hidden = name !== 'check';
    document.getElementById('nav-archive').removeAttribute('aria-current');
    document.getElementById('nav-check').removeAttribute('aria-current');
    document.getElementById(archive ? 'nav-archive' : 'nav-check').setAttribute('aria-current', 'page');
  }

  // --- Salasanasuojaus ---
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const loginSubmit = document.getElementById('login-submit');
  const logoutBtn = document.getElementById('logout');
  let afterLogin = null;

  function setLoginError(msg) {
    loginError.textContent = msg;
    loginError.hidden = !msg;
    passwordInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function requireLogin(retry) {
    afterLogin = retry || null;
    logoutBtn.hidden = true;
    showView('login');
    setLoginError('');
    passwordInput.value = '';
    passwordInput.focus();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!passwordInput.value) {
      setLoginError('Kirjoita salasana.');
      passwordInput.focus();
      return;
    }
    loginSubmit.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kirjautuminen epäonnistui. Yritä uudelleen.');
      passwordInput.value = '';
      logoutBtn.hidden = false;
      const next = afterLogin || route;
      afterLogin = null;
      next();
    } catch (err) {
      setLoginError(err.message === 'Failed to fetch' ? 'Palvelimeen ei saatu yhteyttä. Yritä uudelleen.' : err.message);
      passwordInput.select();
    } finally {
      loginSubmit.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    history.pushState(null, '', location.pathname);
    reportEl.hidden = true;
    input.value = '';
    requireLogin(() => { showView('check'); input.focus(); });
  });

  async function start() {
    let session = { required: false, ok: true };
    try {
      session = await (await fetch('/api/session')).json();
    } catch {
      /* jatketaan; palvelin kysyy salasanaa tarvittaessa */
    }
    logoutBtn.hidden = !(session.required && session.ok);
    // Jaettu raporttilinkki (?id=) aukeaa ilman salasanaa.
    const sharedReport = new URLSearchParams(location.search).get('id') && location.hash !== '#arkisto';
    if (session.required && !session.ok && !sharedReport) requireLogin(route);
    else route();
  }

  function route() {
    const params = new URLSearchParams(location.search);
    if (location.hash === '#arkisto') {
      showView('archive');
      loadArchive(document.getElementById('archive-q').value);
      document.getElementById('archive-title').setAttribute('tabindex', '-1');
      document.getElementById('archive-title').focus();
    } else if (params.get('id')) {
      loadArchived(params.get('id'));
    } else {
      showView('check');
      if (params.get('url')) {
        input.value = params.get('url');
        runCheck(params.get('url'));
      }
    }
  }
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  document.getElementById('nav-check').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', location.pathname);
    reportEl.hidden = true;
    input.value = '';
    showView('check');
    input.focus();
  });

  const archiveStatus = document.getElementById('archive-status');
  const archiveList = document.getElementById('archive-list');
  document.getElementById('archive-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadArchive(document.getElementById('archive-q').value);
  });

  async function loadArchive(q = '') {
    archiveStatus.textContent = 'Haetaan arkistoa.';
    try {
      const res = await fetch('/api/checks?q=' + encodeURIComponent(q.trim()));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.loginRequired) {
        archiveStatus.textContent = '';
        requireLogin(() => { showView('archive'); loadArchive(q); });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Arkistoa ei saatu haettua.');
      if (data.enabled === false) {
        archiveStatus.textContent = '';
        archiveList.innerHTML = '<p class="empty">Arkisto ei ole käytössä tällä palvelimella.</p>';
        return;
      }
      archiveStatus.textContent = q.trim()
        ? `Haulla ”${q.trim()}” löytyi ${data.sites.length} sivua.`
        : `Arkistossa on ${data.sites.length} sivua.`;
      archiveList.innerHTML = data.sites.length === 0
        ? `<p class="empty">${q.trim() ? 'Hakuasi vastaavia tarkastuksia ei löytynyt. Kokeile lyhyempää hakusanaa.' : 'Arkisto on vielä tyhjä. Tarkasta ensimmäinen sivu, niin se tallentuu tänne.'}</p>`
        : `<div class="table-wrap"><table>
            <thead><tr><th scope="col">Sivu</th><th scope="col">Viimeisin arvosana</th><th scope="col">Tarkastuksia</th><th scope="col">Viimeksi tarkastettu</th></tr></thead>
            <tbody>${data.sites.map(archiveRow).join('')}</tbody></table></div>`;
    } catch (err) {
      archiveStatus.textContent = '';
      archiveList.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  function scoreBadge(score) {
    if (score == null) return '–';
    return badge(score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'bad', `${score} / 100`);
  }

  function archiveRow(s) {
    return `<tr>
      <td><a href="?id=${encodeURIComponent(s.id)}" data-id="${esc(s.id)}" class="open-check"><strong>${esc(s.title || s.key)}</strong></a><br><span class="meta">${esc(s.key)}</span></td>
      <td>${scoreBadge(s.summary.score)}</td>
      <td>${s.count}</td>
      <td>${esc(new Date(s.checkedAt).toLocaleString('fi-FI'))}</td>
    </tr>`;
  }

  // Arkiston ja historian linkit avataan ilman sivun uudelleenlatausta.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.open-check');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    history.pushState(null, '', '?id=' + encodeURIComponent(a.dataset.id));
    loadArchived(a.dataset.id);
  });

  start();

  // --- Työkalupalkki ---
  const toolbarMsg = document.getElementById('toolbar-msg');
  function flash(msg) {
    toolbarMsg.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { toolbarMsg.textContent = ''; }, 4000);
  }
  document.getElementById('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      flash('Linkki kopioitu. Liitä se viestiin, niin vastaanottaja näkee saman raportin.');
    } catch {
      flash('Kopioi linkki selaimen osoiteriviltä.');
    }
  });
  document.getElementById('print-report').addEventListener('click', () => window.print());

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

  // Lisätietoa-osio: mitä havaittiin, miksi se kannattaa korjata ja mihin ohjeeseen se perustuu.
  function more(found, why, ref) {
    return `<details class="more"><summary>Lisätietoa ja perustelut</summary>
      <p><strong>Mitä havaittiin:</strong> ${found}</p>
      <p><strong>Miksi tämä kannattaa korjata:</strong> ${why}</p>
      ${ref ? `<p class="ref">Perustuu: ${ref}</p>` : ''}
    </details>`;
  }

  const LAW = 'Laki digitaalisten palvelujen tarjoamisesta ja EU:n esteettömyyssäädös edellyttävät monilta palveluilta WCAG AA -tason täyttämistä.';

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
    renderScore(r.overall);
    renderComparison(r.comparison);
    renderHistory(r);

    renderContrast(c, r);
    renderColorBlind(r);
    renderReadability(rd);

    selectTab(tabs[0]);
    reportEl.hidden = false;
    document.getElementById('summary-title').setAttribute('tabindex', '-1');
    document.getElementById('summary-title').focus();
  }

  function signed(n, digits = 0) {
    if (n == null) return '–';
    const v = Number(n.toFixed(digits));
    if (v === 0) return '±0';
    return (v > 0 ? '+' : '−') + fmt(Math.abs(v), digits);
  }

  // better: 'up' kun suurempi luku on parempi, 'down' kun pienempi on parempi.
  function change(n, better, digits = 0) {
    if (n == null || Number(n.toFixed(digits)) === 0) return `<span class="delta same">${signed(n, digits)}</span>`;
    const good = better === 'up' ? n > 0 : n < 0;
    return `<span class="delta ${good ? 'good' : 'worse'}">${signed(n, digits)}</span>`;
  }

  function renderComparison(cmp) {
    const el = document.getElementById('comparison');
    if (!cmp) {
      el.innerHTML = '';
      return;
    }
    const when = new Date(cmp.previousCheckedAt).toLocaleString('fi-FI');
    const pairList = (list) => list.map((p) =>
      `<li>${swatch(p.fg, p.bg)} <span class="hexes" style="display:inline">${esc(p.fg)} / ${esc(p.bg)}, ${fmt(p.ratio)}:1</span>${p.sample ? ` <span class="meta">”${esc(p.sample)}”</span>` : ''}</li>`).join('');
    const verdict = cmp.score > 0 ? 'Sivu on parantunut.' : cmp.score < 0 ? 'Sivu on heikentynyt.' : 'Kokonaisarvosana ei muuttunut.';
    el.innerHTML = `<section class="comparison" aria-labelledby="cmp-title">
      <h3 id="cmp-title">Muutos edelliseen tarkastukseen</h3>
      <p>${verdict} Vertailukohtana on <a href="?id=${encodeURIComponent(cmp.previousId)}" class="open-check" data-id="${esc(cmp.previousId)}">tarkastus ${esc(when)}</a>.</p>
      <ul class="cmp-grid">
        <li><span>Kokonaisarvosana</span>${change(cmp.score, 'up')}</li>
        ${cmp.parts.map((p) => `<li><span>${esc(p.label)}</span>${change(p.delta, 'up')}</li>`).join('')}
        <li><span>Kontrastiltaan heikkoja tekstejä</span>${change(cmp.failingElements, 'down')}</li>
        <li><span>Värisokealle heikkeneviä väripareja</span>${change(cmp.colorBlindPairs, 'down')}</li>
        <li><span>Vain värillä erottuvia linkkejä</span>${change(cmp.linkIssues, 'down')}</li>
        <li><span>LIX-luku</span>${change(cmp.lix, 'down', 1)}</li>
      </ul>
      ${cmp.fixedPairs.length ? `<h4>Korjatut väriparit (${cmp.fixedPairs.length})</h4><ul class="pair-list">${pairList(cmp.fixedPairs)}</ul>` : ''}
      ${cmp.newPairs.length ? `<h4>Uudet kontrastiongelmat (${cmp.newPairs.length})</h4><ul class="pair-list">${pairList(cmp.newPairs)}</ul>` : ''}
    </section>`;
  }

  function renderHistory(r) {
    const el = document.getElementById('site-history');
    const list = r.history || [];
    if (!r.archived || list.length < 2) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = `<h2 id="history-title">Tämän sivun tarkastushistoria</h2>
      <p>Sivu on tarkastettu ${list.length} kertaa. Uusin ensin.</p>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Tarkastettu</th><th scope="col">Arvosana</th><th scope="col">Heikkoja kontrasteja</th><th scope="col">LIX</th></tr></thead>
        <tbody>${list.map((h) => `<tr${h.id === r.id ? ' class="is-current"' : ''}>
          <td>${h.id === r.id ? `<strong>${esc(new Date(h.checkedAt).toLocaleString('fi-FI'))}</strong> <span class="meta">(tämä raportti)</span>` : `<a href="?id=${encodeURIComponent(h.id)}" class="open-check" data-id="${esc(h.id)}">${esc(new Date(h.checkedAt).toLocaleString('fi-FI'))}</a>`}</td>
          <td>${scoreBadge(h.summary.score)}</td>
          <td>${h.summary.failingElements}</td>
          <td>${h.summary.lix == null ? '–' : fmt(h.summary.lix, 0)}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function renderScore(o) {
    const color = o.score >= 75 ? 'var(--ok)' : o.score >= 50 ? 'var(--warn)' : 'var(--bad)';
    document.getElementById('score').innerHTML = `
      <div class="score-ring" style="--p:${o.score};--c:${color}" role="img" aria-label="Kokonaisarvosana ${o.score} / 100, ${esc(o.grade)}">
        <div><div><strong>${o.score}</strong><span>/ 100</span></div></div>
      </div>
      <div>
        <h3>Kokonaisarvosana: ${esc(o.grade)}</h3>
        <ul class="score-parts">${o.parts.map((p) => `
          <li><span>${esc(p.label)}</span><span class="bar" aria-hidden="true"><i style="width:${Math.round(p.score * 100)}%"></i></span><span class="pts">${p.points} / ${p.weight}</span></li>`).join('')}
        </ul>
      </div>`;
  }

  function card(label, value, note) {
    return `<div class="card"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p><p class="note">${note}</p></div>`;
  }

  function swatch(fg, bg, label = 'Aa') {
    return `<span class="swatch" style="color:${esc(fg)};background:${esc(bg)}">${esc(label)}</span>`;
  }

  // --- Kontrastit ---
  function renderContrast(c, r) {
    let n = 0;
    for (const p of c.pairs) p.num = p.passAA ? null : ++n;
    const panel = document.getElementById('panel-contrast');
    panel.innerHTML = `
      <h2>Tekstien kontrastit</h2>
      <p>Jokainen näkyvä teksti on ryhmitelty teksti- ja taustavärin mukaan. Tavallisen tekstin pitää yltää vähintään suhteeseen 4,5:1 ja suuren tekstin (vähintään 24 px tai lihavoitu 18,66 px) suhteeseen 3:1 (WCAG AA). AAA-taso vaatii 7:1 ja 4,5:1.</p>
      <div class="filter-bar">
        <label><input type="checkbox" id="only-failing" checked> Näytä vain AA-tason alittavat</label>
        <span class="meta" style="margin:0">Tarkastettu ${c.totalElements} tekstielementtiä, ${c.pairs.length} väriparia.</span>
      </div>
      <div id="contrast-table"></div>
      ${renderOverlay(c, r)}`;
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
    let fix = '';
    if (!p.passAA) {
      fix = p.suggestion
        ? `<span class="fix">Ehdotus: ${swatch(p.suggestion, p.bg)} <span class="hexes" style="display:inline">${esc(p.suggestion)} (${fmt(p.suggestionRatio)}:1)</span></span>`
        : '<span class="fix meta">Pelkkä tekstivärin säätö ei riitä. Vaihda myös taustaväriä.</span>';
    }
    return `<tr id="pair-${p.num || ''}">
      <td>${p.num ? `<span class="num" aria-label="Kohta ${p.num}">${p.num}</span>` : ''}${swatch(p.fg, p.bg)}<span class="hexes">${esc(p.fg)} / ${esc(p.bg)}</span>${fix}</td>
      <td><strong>${fmt(p.ratio)}:1</strong><br><span class="meta">vaatimus ${fmt(p.required, 1)}:1${p.large ? ', suuri teksti' : ''}</span></td>
      <td>${level}${p.bgImage ? '<br><span class="meta">Taustakuva, tarkista käsin</span>' : ''}</td>
      <td>${p.count}</td>
      <td>${s ? `<span class="sample-text">”${esc(s.text)}”</span><code>${esc(s.selector)}</code>` : ''}</td>
    </tr>${p.passAA ? '' : `<tr class="detail-row"><td colspan="5">${contrastMore(p)}</td></tr>`}`;
  }

  function contrastMore(p) {
    const kind = p.large ? 'suurelle tekstille' : 'tavalliselle tekstille';
    const found = `Teksti värillä ${esc(p.fg)} taustalla ${esc(p.bg)} on kontrastiltaan ${fmt(p.ratio)}:1. Vaatimus ${kind} on vähintään ${fmt(p.required, 1)}:1, joten ero jää ${fmt(p.required - p.ratio)} yksikköä alle rajan. Sama väripari esiintyy sivulla ${p.count === 1 ? 'kerran' : p.count + ' kertaa'}.`
      + (p.bgImage ? ' Tekstin takana on taustakuva tai liukuväri, joten todellinen kontrasti voi olla erilainen. Tarkista kohta myös silmämääräisesti.' : '')
      + (p.suggestion ? ` Jos tekstiväriksi vaihdetaan ${esc(p.suggestion)}, kontrasti nousee tasolle ${fmt(p.suggestionRatio)}:1.` : ' Pelkkä tekstivärin vaihtaminen ei riitä, vaan myös taustaväriä on muutettava.');
    const why = 'Kun tekstin ja taustan välillä on liian vähän eroa, heikkonäköisten, ikääntyneiden ja värisokeiden on vaikea tai mahdoton lukea tekstiä. Sama koskee kaikkia, jotka lukevat sivua puhelimella kirkkaassa auringonvalossa tai heikkolaatuisella näytöllä. Riittävä kontrasti on yksi helpoimmista ja halvimmista saavutettavuuskorjauksista. ' + LAW;
    return more(found, why, 'WCAG 2.2, kohta 1.4.3 Kontrasti (minimi), taso AA');
  }

  // Kuvakaappaus, johon AA-tason alittavat tekstit on merkitty numeroin.
  function renderOverlay(c, r) {
    const failing = c.pairs.filter((p) => p.num && p.rects && p.rects.length);
    if (!failing.length || !r.screenshot || !r.screenshotSize) return '';
    const W = r.screenshotSize.width;
    const H = r.screenshotSize.height;
    const boxes = [];
    let hidden = 0;
    for (const p of failing) {
      for (const [x, y, w, h] of p.rects) {
        if (y >= H || x >= W) { hidden++; continue; }
        const style = `left:${(100 * x) / W}%;top:${(100 * y) / H}%;width:${(100 * Math.min(w, W - x)) / W}%;height:${(100 * Math.min(h, H - y)) / H}%`;
        boxes.push(`<span class="box" style="${style}"><b>${p.num}</b></span>`);
      }
    }
    return `<div class="overlay-wrap">
      <h3>Ongelmakohdat sivulla</h3>
      <p>Punaisella merkityt tekstit eivät läpäise AA-tasoa. Numero viittaa yllä olevan taulukon riviin.${hidden ? ` ${hidden} kohtaa on kuvakaappauksen alapuolella, eikä niitä näytetä kuvassa.` : ''}</p>
      <div class="overlay-shot" tabindex="0" aria-label="Kuvakaappaus sivusta, ongelmakohdat merkitty. Vieritettävä.">
        <div class="overlay-inner"><img src="${r.screenshot}" alt="">${boxes.join('')}</div>
      </div>
    </div>`;
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
    const figures = !r.screenshot
      ? '<p class="meta">Sivusta ei saatu kuvakaappausta, joten simulaatiokuvia ei voida näyttää. Värisokeuden vaikutus väripareihin on arvioitu silti alla.</p>'
      : SIMS.map(([key, label, filter]) => {
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
          </tr><tr class="detail-row"><td colspan="5">${colorBlindMore(key, label, a)}</td></tr>`).join('')}</tbody></table></div>`;
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
        </tr><tr class="detail-row"><td colspan="3">${more(
          `Linkki ”${esc(l.text)}” on tekstin keskellä ilman alleviivausta, ja sen väri ${esc(l.linkColor)} eroaa ympäröivän tekstin väristä ${esc(l.textColor)} vain ${fmt(l.ratio)}:1. Ero on alle vaadittavan 3:1, eikä linkkiä erota muulla tavalla, kuten lihavoinnilla.`,
          'Jos linkin tunnistaa vain väristä, värisokea, heikkonäköinen tai harmaasävynäyttöä käyttävä ei huomaa linkkiä lainkaan ja jää paitsi sen takana olevasta tiedosta. Helpoin korjaus on näyttää linkkien alleviivaus tekstin sisällä. ' + LAW,
          'WCAG 2.2, kohta 1.4.1 Värien käyttö, taso A (tekniikka G183)'
        )}</td></tr>`).join('')}</tbody></table></div>`;

    panel.innerHTML = `
      <h2>Miltä sivu näyttää värisokealle</h2>
      <p>Kuvakaappaukset näyttävät sivun yläosan eri värinäön tyypeillä. Alla on lisäksi väriparit, jotka läpäisevät kontrastivaatimuksen tavallisella näöllä mutta eivät simuloidulla värinäöllä.</p>
      <div class="sim-grid">${figures}</div>
      ${lists || '<p class="empty" style="margin-top:20px">Yksikään väripari ei heikkene simulaatioissa vaatimuksen alle.</p>'}
      ${linkSection}`;
  }

  const CB_WHO = {
    protanopia: 'Punasokeutta tai sen lievempää muotoa on noin 1 prosentilla miehistä. Puna-vihervärisokeutta on kaikkiaan noin 8 prosentilla miehistä ja 0,5 prosentilla naisista.',
    deuteranopia: 'Vihersokeus ja sen lievemmät muodot ovat yleisin värinäön poikkeama. Puna-vihervärisokeutta on noin 8 prosentilla miehistä ja 0,5 prosentilla naisista.',
    tritanopia: 'Sinisokeus on harvinainen, mutta sinisen ja keltaisen erottaminen heikkenee myös iän ja esimerkiksi harmaakaihin myötä.',
    achromatopsia: 'Täysi värisokeus on harvinainen, mutta sama tilanne syntyy, kun sivu tulostetaan mustavalkoisena tai luetaan harmaasävyisellä näytöllä.',
  };

  function colorBlindMore(key, label, a) {
    const found = `Värit ${esc(a.fg)} ja ${esc(a.bg)} erottuvat tavallisella näöllä riittävästi (${fmt(a.ratio)}:1). Kun värinäköä simuloidaan tyypillä ${esc(label.toLowerCase())}, värit näyttävät sävyiltä ${esc(a.simFg)} ja ${esc(a.simBg)}, ja kontrasti putoaa tasolle ${fmt(a.simRatio)}:1. Vaatimus on ${fmt(a.required, 1)}:1.`;
    const why = `${CB_WHO[key] || ''} Näille lukijoille teksti sulautuu taustaan, vaikka se näyttää muille selvältä. Korjaa valitsemalla värit, joiden ero perustuu vaaleuteen eikä pelkkään sävyyn, esimerkiksi tumma teksti vaalealla taustalla.`;
    return more(found, why, 'WCAG 2.2, kohdat 1.4.1 Värien käyttö ja 1.4.3 Kontrasti (minimi)');
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
      ${rd.advice.length ? `<h3>Parannusehdotukset</h3><ul class="advice">${rd.advice.map((a) => `<li>${esc(a.text)}${more(esc(a.found), esc(a.why), a.ref ? esc(a.ref) : '')}</li>`).join('')}</ul>` : '<h3>Parannusehdotukset</h3><p>Teksti on selkeää. Ei erityisiä huomioita.</p>'}
      ${rd.longestSentences.length ? `<h3>Pisimmät lauseet</h3><ol class="sentences">${rd.longestSentences.map((s) => `<li><strong>${s.words} sanaa:</strong> ${esc(s.text)}</li>`).join('')}</ol>` : ''}
      ${rd.veryLongWords.length ? `<h3>Hyvin pitkät sanat (vähintään ${rd.veryLongWordLimit} merkkiä)</h3><ul class="words">${rd.veryLongWords.map((w) => `<li>${esc(w.word)}${w.count > 1 ? ` (${w.count})` : ''}</li>`).join('')}</ul>` : ''}`;
  }
})();
