'use strict';

const path = require('node:path');
const express = require('express');
const { analyzeUrl, closeBrowser } = require('./lib/analyze');
const { parseUserUrl, UrlError } = require('./lib/urlguard');
const { createStore } = require('./lib/store');
const { compareReports, normalizeUrl } = require('./lib/compare');

const PORT = Number(process.env.PORT) || 3000;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 2;
// Vain paikalliseen kehitykseen: sallii esim. localhost-osoitteiden tarkastamisen.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === '1';

/** Liittää raporttiin vertailun edelliseen saman sivun tarkastukseen ja sivun historian. */
async function withArchive(store, entry) {
  const prev = await store.previous(entry.key, entry.checkedAt, entry.id);
  const history = await store.history(entry.key, 30);
  return {
    ...entry.report,
    id: entry.id,
    archived: true,
    comparison: prev ? compareReports(entry.report, prev.report, prev) : null,
    history,
  };
}

function createApp(store = null, opts = {}) {
  const allowPrivate = opts.allowPrivate ?? ALLOW_PRIVATE;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use(express.static(path.join(__dirname, 'public')));

  let running = 0;

  app.post('/api/analyze', async (req, res) => {
    let url;
    try {
      url = parseUserUrl(req.body && req.body.url);
    } catch (err) {
      if (err instanceof UrlError) return res.status(400).json({ error: err.message });
      throw err;
    }
    if (running >= MAX_CONCURRENT) {
      return res.status(503).json({ error: 'Palvelu on juuri nyt kiireinen. Yritä hetken päästä uudelleen.' });
    }
    running++;
    try {
      const report = await analyzeUrl(url, { allowPrivate });
      if (!store) return res.json(report);
      try {
        const row = await store.save(report);
        res.json(await withArchive(store, { ...row, report }));
      } catch (err) {
        // Arkiston vika ei saa estää raportin näyttämistä.
        console.error('Arkistointi epäonnistui:', err);
        res.json({ ...report, archived: false });
      }
    } catch (err) {
      if (err.userFacing) return res.status(422).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Tarkastus epäonnistui odottamattomasti. Yritä uudelleen.' });
    } finally {
      running--;
    }
  });

  app.get('/api/checks', async (req, res) => {
    if (!store) return res.json({ sites: [], enabled: false });
    try {
      const q = String(req.query.q || '').slice(0, 200);
      res.json({ sites: await store.sites(q, 100), enabled: true, kind: store.kind });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Arkistoa ei saatu haettua. Yritä hetken päästä uudelleen.' });
    }
  });

  app.get('/api/checks/:id', async (req, res) => {
    if (!store) return res.status(404).json({ error: 'Arkisto ei ole käytössä.' });
    try {
      const entry = await store.get(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Tarkastusta ei löytynyt. Se on voitu poistaa.' });
      res.json(await withArchive(store, entry));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Tarkastusta ei saatu haettua. Yritä hetken päästä uudelleen.' });
    }
  });

  app.get('/api/history', async (req, res) => {
    if (!store) return res.json({ history: [] });
    try {
      res.json({ history: await store.history(normalizeUrl(parseUserUrl(req.query.url).href), 100) });
    } catch (err) {
      if (err instanceof UrlError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Historiaa ei saatu haettua.' });
    }
  });

  return app;
}

if (require.main === module) {
  let server;
  (async () => {
    let store = null;
    try {
      store = await createStore();
      console.log(`Arkisto käytössä (${store.kind}).`);
    } catch (err) {
      console.error('Arkistoa ei saatu käyttöön, jatketaan ilman sitä:', err.message);
    }
    server = createApp(store).listen(PORT, '0.0.0.0', () => {
      console.log(`Sivutarkastaja käynnissä: http://localhost:${PORT}`);
    });
  })();
  const shutdown = async () => {
    if (server) server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
