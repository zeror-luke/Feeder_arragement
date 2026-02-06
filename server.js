const fs = require('fs');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parse } = require('csv-parse/sync');

const DB_FILE = path.join(__dirname, 'feeders.db');
const TRANSFORMER_TXT = path.join(__dirname, 'trnsfmr.txt');
const AB_TXT = path.join(__dirname, 'AB.txt');

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
          resolve();
        });
      });
    });
  });
}

function importDataIfEmpty(db) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as c FROM transformers', (err, row) => {
      if (err) return reject(err);
      if (row && row.c > 0) return resolve(false); // already imported

      const trContent = fs.readFileSync(TRANSFORMER_TXT, 'utf8');
      const abContent = fs.readFileSync(AB_TXT, 'utf8');

      // Parse AB.txt as simple lines of locations
      const locations = abContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      // Insert locations
      const insertLoc = db.prepare('INSERT INTO locations(name) VALUES(?)');
      locations.forEach(loc => insertLoc.run(loc));
      insertLoc.finalize();

      // trnsfmr.txt may contain multiple CSV blocks separated by blank lines.
      const blocks = trContent.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
      // Ensure five feeders available; use the five feeder IDs matching trnsfmr.txt
      const feederKeys = ['feeder-kanchiyar','feeder-nariampara','feeder-vellilamkandam','feeder-vandanmeedu','feeder-nedumkandam'];

      const insertTr = db.prepare('INSERT INTO transformers(code,name,capacity,feeder) VALUES(?,?,?,?)');
      blocks.forEach((blk, idx) => {
        // parse CSV block
        try {
          const records = parse(blk, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
          const feeder = feederKeys[idx] || feederKeys[feederKeys.length - 1];
          records.forEach(r => {
            const code = (r['Transformer'] || r['Transformer,Location / Name (Malayalam),Capacity'] || '').trim();
            const name = (r['Location / Name (Malayalam)'] || r['Location / Name (Malayalam),Capacity'] || r['Location / Name (Malayalam)'] || r['Location / Name (Malayalam),Capacity'] || r['Location / Name (Malayalam)'] || r['Location / Name (Malayalam)'] || r[Object.keys(r)[1]] || '').trim();
            const capacity = (r['Capacity'] || r[Object.keys(r)[2]] || '').trim();
            if (!name && !code) return;
            insertTr.run(code, name, capacity, feeder);
          });
        } catch (e) {
          // best-effort: try line-by-line CSV
          const lines = blk.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length <= 1) return;
          const headers = lines[0].split(',').map(h => h.trim());
          const feeder = feederKeys[idx] || feederKeys[feederKeys.length - 1];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const code = cols[0] || '';
            const name = cols[1] || '';
            const capacity = cols[2] || '';
            insertTr.run(code, name, capacity, feeder);
          }
        }
      });
      insertTr.finalize(() => resolve(true));
    });
  });
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
  db.all('SELECT DISTINCT feeder FROM transformers ORDER BY feeder', [], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    // normalize to array of feeder ids (strings)
    const feeders = rows.map(r => r.feeder).filter(Boolean);
    res.json(feeders);
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

// Initialize DB and optionally import
async function init(importOnly) {
  const db = openDb();
  try {
    await ensureSchema(db);
    const imported = await importDataIfEmpty(db);
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
