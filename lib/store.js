'use strict';

// Tarkastusarkisto. Jos DATABASE_URL on asetettu, käytetään PostgreSQL:ää.
// Muuten tarkastukset tallennetaan tiedostoihin hakemistoon DATA_DIR.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeUrl, summarize } = require('./compare');

const newId = () => crypto.randomBytes(9).toString('base64url');

function listRow(r) {
  return {
    id: r.id,
    url: r.url,
    key: r.key,
    title: r.title,
    checkedAt: r.checkedAt,
    summary: r.summary,
  };
}

/** Tiedostopohjainen arkisto: hyvä kehitykseen ja palvelimille, joilla on pysyvä levy. */
class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.index = null;
  }

  async init() {
    await fs.mkdir(path.join(this.dir, 'checks'), { recursive: true });
    try {
      this.index = JSON.parse(await fs.readFile(path.join(this.dir, 'index.json'), 'utf8'));
    } catch {
      this.index = [];
    }
  }

  async save(report) {
    const row = {
      id: newId(),
      url: report.url,
      key: normalizeUrl(report.url),
      title: report.title || '',
      checkedAt: report.checkedAt,
      summary: summarize(report),
    };
    await fs.writeFile(path.join(this.dir, 'checks', row.id + '.json'), JSON.stringify(report));
    this.index.push(row);
    const tmp = path.join(this.dir, 'index.json.tmp');
    await fs.writeFile(tmp, JSON.stringify(this.index));
    await fs.rename(tmp, path.join(this.dir, 'index.json'));
    return row;
  }

  async get(id) {
    if (!/^[\w-]{6,40}$/.test(id)) return null;
    const row = this.index.find((r) => r.id === id);
    if (!row) return null;
    const report = JSON.parse(await fs.readFile(path.join(this.dir, 'checks', id + '.json'), 'utf8'));
    return { ...listRow(row), report };
  }

  async previous(key, beforeIso, excludeId) {
    const rows = this.index
      .filter((r) => r.key === key && r.id !== excludeId && r.checkedAt < beforeIso)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    return rows[0] ? this.get(rows[0].id) : null;
  }

  async history(key, limit = 50) {
    return this.index
      .filter((r) => r.key === key)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, limit)
      .map(listRow);
  }

  async sites(query = '', limit = 50) {
    const q = query.trim().toLowerCase();
    const bySite = new Map();
    for (const r of this.index) {
      if (q && !r.key.includes(q) && !(r.title || '').toLowerCase().includes(q)) continue;
      const s = bySite.get(r.key);
      if (!s) bySite.set(r.key, { latest: r, count: 1 });
      else {
        s.count++;
        if (r.checkedAt > s.latest.checkedAt) s.latest = r;
      }
    }
    return [...bySite.values()]
      .sort((a, b) => b.latest.checkedAt.localeCompare(a.latest.checkedAt))
      .slice(0, limit)
      .map((s) => ({ ...listRow(s.latest), count: s.count }));
  }
}

/** PostgreSQL-arkisto (esim. Neon tai Renderin tietokanta). */
class PgStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    this.pool = new Pool({
      connectionString,
      max: 3,
      ssl: local || /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS checks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        checked_at TIMESTAMPTZ NOT NULL,
        summary JSONB NOT NULL,
        report JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS checks_key_time ON checks (key, checked_at DESC);
      CREATE INDEX IF NOT EXISTS checks_time ON checks (checked_at DESC);
    `);
  }

  row(r) {
    return {
      id: r.id,
      url: r.url,
      key: r.key,
      title: r.title,
      checkedAt: new Date(r.checked_at).toISOString(),
      summary: r.summary,
    };
  }

  async save(report) {
    const row = {
      id: newId(),
      url: report.url,
      key: normalizeUrl(report.url),
      title: report.title || '',
      checkedAt: report.checkedAt,
      summary: summarize(report),
    };
    await this.pool.query(
      'INSERT INTO checks (id, url, key, title, checked_at, summary, report) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [row.id, row.url, row.key, row.title, row.checkedAt, row.summary, report]
    );
    return row;
  }

  async get(id) {
    if (!/^[\w-]{6,40}$/.test(id)) return null;
    const { rows } = await this.pool.query('SELECT * FROM checks WHERE id = $1', [id]);
    if (!rows[0]) return null;
    return { ...this.row(rows[0]), report: rows[0].report };
  }

  async previous(key, beforeIso, excludeId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM checks WHERE key = $1 AND id <> $2 AND checked_at < $3 ORDER BY checked_at DESC LIMIT 1',
      [key, excludeId || '', beforeIso]
    );
    return rows[0] ? { ...this.row(rows[0]), report: rows[0].report } : null;
  }

  async history(key, limit = 50) {
    const { rows } = await this.pool.query(
      'SELECT id, url, key, title, checked_at, summary FROM checks WHERE key = $1 ORDER BY checked_at DESC LIMIT $2',
      [key, limit]
    );
    return rows.map((r) => this.row(r));
  }

  async sites(query = '', limit = 50) {
    const q = '%' + query.trim().toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (key) id, url, key, title, checked_at, summary,
              COUNT(*) OVER (PARTITION BY key) AS count
         FROM checks
        WHERE key LIKE $1 OR LOWER(title) LIKE $1
        ORDER BY key, checked_at DESC`,
      [q]
    );
    return rows
      .map((r) => ({ ...this.row(r), count: Number(r.count) }))
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, limit);
  }
}

async function createStore(env = process.env) {
  const store = env.DATABASE_URL
    ? new PgStore(env.DATABASE_URL)
    : new FileStore(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  await store.init();
  store.kind = env.DATABASE_URL ? 'postgres' : 'file';
  return store;
}

module.exports = { createStore, FileStore, PgStore };
