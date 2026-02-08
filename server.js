const fs = require('fs');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parse } = require('csv-parse/sync');

const DB_FILE = path.join(__dirname, 'feeders.db');
const TRANSFORMER_TXT = path.join(__dirname, 'trnsfmr.txt');
const AB_TXT = path.join(__dirname, 'AB.txt');

const FEEDER_CONFIG = [
  { slug: 'feeder-kanchiyar', heading: 'Kanchiyar', aliases: ['feeder-narayanpara'] },
  { slug: 'feeder-nariampara', heading: 'Nariampara', aliases: ['feeder-nedumkandam'] },
  { slug: 'feeder-vellilamkandam', heading: 'Vellilamkandam', aliases: ['feeder-kattiyar'] },
  { slug: 'feeder-vandanmeedu', heading: 'Vandanmeedu', aliases: ['feeder-vandanmedu'] },
  { slug: 'feeder-nedumkandam', heading: 'Nedumkandam', aliases: [] }
];

const FEEDER_SLUGS = FEEDER_CONFIG.map(f => f.slug);
const FEEDER_ALIAS_MAP = FEEDER_CONFIG.reduce((acc, feeder) => {
  acc[feeder.slug] = feeder.slug;
  (feeder.aliases || []).forEach(alias => { acc[alias] = feeder.slug; });
  return acc;
}, {});
const HEADING_TO_SLUG = FEEDER_CONFIG.reduce((acc, feeder) => {
  acc[feeder.heading.toLowerCase()] = feeder.slug;
  return acc;
}, {});

let transformerDataCache = null;

function getTransformerDataMap() {
  if (transformerDataCache) return transformerDataCache;
  const raw = fs.readFileSync(TRANSFORMER_TXT, 'utf8');
  const lines = raw.split(/\r?\n/);
  const map = new Map();
  let currentSlug = null;
  let buffer = [];

  const flush = () => {
    if (!currentSlug || !buffer.length) {
      buffer = [];
      return;
    }
    const block = buffer.join('\n').trim();
    buffer = [];
    if (!block) return;
    map.set(currentSlug, parseTransformerBlock(block));
  };

  lines.forEach(line => {
    const headingMatch = line.match(/^---\s*(.+?)\s*---$/);
    if (headingMatch) {
      flush();
      const key = headingMatch[1].trim().toLowerCase();
      currentSlug = HEADING_TO_SLUG[key] || null;
      return;
    }
    if (currentSlug) buffer.push(line);
  });
  flush();

  transformerDataCache = map;
  return map;
}

function parseTransformerBlock(block) {
  try {
    const records = parse(block, { columns: true, skip_empty_lines: true, trim: true });
    return records
      .map(toTransformerRow)
      .filter(row => row.name || row.code);
  } catch (err) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const rec = {};
      headers.forEach((h, idx) => { rec[h] = cols[idx] || ''; });
      rows.push(rec);
    }
    return rows.map(toTransformerRow).filter(row => row.name || row.code);
  }
}

function toTransformerRow(record) {
  const keys = Object.keys(record);
  if (!keys.length) return { code: '', name: '', capacity: '' };
  const codeKey = keys.find(k => /transformer/i.test(k)) || keys[0];
  const nameKey = keys.find(k => /name/i.test(k)) || keys[1] || keys[0];
  const capacityKey = keys.find(k => /capacity/i.test(k)) || keys[2] || keys[keys.length - 1];
  return {
    code: (record[codeKey] || '').trim(),
    name: (record[nameKey] || '').trim(),
    capacity: (record[capacityKey] || '').trim()
  };
}

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getScalar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.c : 0);
    });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static site files from repo root
app.use(express.static(path.join(__dirname)));
app.use(express.json());

function openDb() {
  return new sqlite3.Database(DB_FILE);
}

function ensureSchema(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS transformers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT,
        name TEXT,
        capacity TEXT,
        feeder TEXT
      )`, (err) => {
        if (err) return reject(err);
        // create ab_links table to store interlinks for AB locations
        db.run(`CREATE TABLE IF NOT EXISTS ab_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id INTEGER UNIQUE,
          feeder_a TEXT,
          feeder_b TEXT,
          FOREIGN KEY(location_id) REFERENCES locations(id)
        )`, (err2) => {
          if (err2) return reject(err2);
          db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            user TEXT,
            action TEXT,
            title TEXT,
            description TEXT,
            metadata TEXT
          )`, (err3) => {
            if (err3) return reject(err3);
            resolve();
          });
        });
      });
    });
  });
}

async function importDataIfEmpty(db) {
  const count = await getScalar(db, 'SELECT COUNT(*) as c FROM transformers');
  if (count > 0) return false;

  const locations = loadLocationsFromFile();
  await insertLocations(db, locations);

  const dataMap = getTransformerDataMap();
  await insertTransformersData(db, dataMap, FEEDER_SLUGS);
  return true;
}

function loadLocationsFromFile() {
  const abContent = fs.readFileSync(AB_TXT, 'utf8');
  return abContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function insertLocations(db, locations) {
  if (!locations.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO locations(name) VALUES(?)');
    locations.forEach(loc => stmt.run(loc));
    stmt.finalize(err => err ? reject(err) : resolve());
  });
}

function insertTransformersData(db, dataMap, targetSlugs) {
  const rows = [];
  targetSlugs.forEach(slug => {
    const sectionRows = dataMap.get(slug) || [];
    sectionRows.forEach(row => rows.push({ ...row, feeder: slug }));
  });
  if (!rows.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO transformers(code,name,capacity,feeder) VALUES(?,?,?,?)');
    rows.forEach(({ code, name, capacity, feeder }) => {
      stmt.run(code || null, name || null, capacity || null, feeder);
    });
    stmt.finalize(err => err ? reject(err) : resolve());
  });
}

async function normalizeFeederAliases(db) {
  for (const [alias, canonical] of Object.entries(FEEDER_ALIAS_MAP)) {
    if (alias === canonical) continue;
    await runAsync(db, 'UPDATE transformers SET feeder = ? WHERE feeder = ?', [canonical, alias]);
    await runAsync(db, 'UPDATE ab_links SET feeder_a = ? WHERE feeder_a = ?', [canonical, alias]);
    await runAsync(db, 'UPDATE ab_links SET feeder_b = ? WHERE feeder_b = ?', [canonical, alias]);
  }
}

async function hydrateMissingFeederData(db) {
  const rows = await allAsync(db, 'SELECT DISTINCT feeder FROM transformers WHERE feeder IS NOT NULL', []);
  const existing = new Set(rows.map(r => FEEDER_ALIAS_MAP[r.feeder] || r.feeder));
  const missing = FEEDER_SLUGS.filter(slug => !existing.has(slug));
  if (!missing.length) return;
  const dataMap = getTransformerDataMap();
  await insertTransformersData(db, dataMap, missing);
}

async function enforceFeederCounts(db) {
  const dataMap = getTransformerDataMap();
  const expected = {};
  FEEDER_SLUGS.forEach(slug => {
    expected[slug] = (dataMap.get(slug) || []).length;
  });
  const rows = await allAsync(db, 'SELECT feeder, COUNT(*) as count FROM transformers GROUP BY feeder', []);
  const actual = {};
  rows.forEach(row => {
    const slug = FEEDER_ALIAS_MAP[row.feeder] || row.feeder;
    if (!slug) return;
    actual[slug] = (actual[slug] || 0) + row.count;
  });
  const toReplace = FEEDER_SLUGS.filter(slug => expected[slug] && actual[slug] !== expected[slug]);
  if (!toReplace.length) return;
  const placeholders = toReplace.map(() => '?').join(',');
  await runAsync(db, `DELETE FROM transformers WHERE feeder IN (${placeholders})`, toReplace);
  await insertTransformersData(db, dataMap, toReplace);
}

app.get('/api/transformers', (req, res) => {
  const feeder = req.query.feeder;
  const db = openDb();
  let sql = 'SELECT * FROM transformers ORDER BY id';
  const params = [];
  if (feeder) { sql = 'SELECT * FROM transformers WHERE feeder = ? ORDER BY id'; params.push(feeder); }
  db.all(sql, params, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/locations', (req, res) => {
  const db = openDb();
  db.all('SELECT * FROM locations ORDER BY id', [], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Return distinct feeders present in transformers table (used for dropdowns)
app.get('/api/feeders', (req, res) => {
  const db = openDb();
  db.all('SELECT DISTINCT feeder FROM transformers WHERE feeder IS NOT NULL', [], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    const extraSet = new Set();
    rows.forEach(r => {
      const slug = FEEDER_ALIAS_MAP[r.feeder] || r.feeder;
      if (slug) extraSet.add(slug);
    });
    const extras = Array.from(extraSet).filter(slug => !FEEDER_SLUGS.includes(slug)).sort();
    res.json([...FEEDER_SLUGS, ...extras]);
  });
});

// Return all AB links
app.get('/api/ablinks', (req, res) => {
  const db = openDb();
  db.all('SELECT * FROM ab_links', [], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Create or update an AB link for a location
app.post('/api/ablink', (req, res) => {
  const { locationId, feederA, feederB } = req.body || {};
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });

  const db = openDb();
  const sql = `INSERT INTO ab_links(location_id, feeder_a, feeder_b) VALUES(?,?,?)
    ON CONFLICT(location_id) DO UPDATE SET feeder_a=excluded.feeder_a, feeder_b=excluded.feeder_b`;
  db.run(sql, [locationId, feederA || null, feederB || null], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, locationId, feederA, feederB });
  });
});

// Reset (delete) an AB link for a location
app.delete('/api/ablink/:locationId', (req, res) => {
  const locationId = Number(req.params.locationId);
  if (!locationId) return res.status(400).json({ error: 'Valid locationId is required' });

  const db = openDb();
  db.run('DELETE FROM ab_links WHERE location_id = ?', [locationId], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ locationId, deleted: this.changes > 0 });
  });
});

function normalizeLogPayload(body = {}) {
  const now = new Date().toISOString();
  const user = (body.user && String(body.user).trim()) || 'Unknown';
  const action = (body.action && String(body.action).trim()) || 'update';
  const title = (body.title && String(body.title).trim()) || action || 'Update';
  const description = (body.description && String(body.description).trim()) || '';
  let metadata = null;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata === 'string') metadata = body.metadata;
    else {
      try { metadata = JSON.stringify(body.metadata); }
      catch { metadata = null; }
    }
  }
  return { timestamp: now, user, action, title, description, metadata };
}

function parseMetadataField(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return value; }
}

app.post('/api/logs', (req, res) => {
  const entry = normalizeLogPayload(req.body);
  const db = openDb();
  db.run(
    `INSERT INTO activity_logs(timestamp, user, action, title, description, metadata)
     VALUES(?,?,?,?,?,?)`,
    [entry.timestamp, entry.user, entry.action, entry.title, entry.description, entry.metadata],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, ...entry, metadata: parseMetadataField(entry.metadata) });
    }
  );
});

app.get('/api/logs', (req, res) => {
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 200;
  const db = openDb();
  db.all(
    `SELECT * FROM activity_logs ORDER BY datetime(timestamp) DESC LIMIT ?`,
    [limit],
    (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      const mapped = rows.map(row => ({ ...row, metadata: parseMetadataField(row.metadata) }));
      res.json(mapped);
    }
  );
});

// Initialize DB and optionally import
async function init(importOnly) {
  const db = openDb();
  try {
    await ensureSchema(db);
    const imported = await importDataIfEmpty(db);
    await normalizeFeederAliases(db);
    await hydrateMissingFeederData(db);
    await enforceFeederCounts(db);
    db.close();
    if (importOnly) {
      console.log('Import finished:', imported);
      process.exit(0);
    }
    // start server
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Initialization error', e);
    db.close();
    process.exit(1);
  }
}

// support --import flag
const args = process.argv.slice(2);
const importOnly = args.includes('--import');
init(importOnly);
