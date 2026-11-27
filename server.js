'use strict';

const path = require('node:path');
const express = require('express');
const { analyzeUrl, closeBrowser } = require('./lib/analyze');
const { parseUserUrl, UrlError } = require('./lib/urlguard');

const PORT = Number(process.env.PORT) || 3000;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 2;
// Vain paikalliseen kehitykseen: sallii esim. localhost-osoitteiden tarkastamisen.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === '1';

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
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
      const report = await analyzeUrl(url, { allowPrivate: ALLOW_PRIVATE });
      res.json(report);
    } catch (err) {
      if (err.userFacing) return res.status(422).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Tarkastus epäonnistui odottamattomasti. Yritä uudelleen.' });
    } finally {
      running--;
    }
  });

  return app;
}

if (require.main === module) {
  const server = createApp().listen(PORT, () => {
    console.log(`Sivutarkastaja käynnissä: http://localhost:${PORT}`);
  });
  const shutdown = async () => {
    server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
