/* Seed types, varieties and companies — the catalogue the capture app
   reads at runtime, plus the admin writes behind it.

     GET   /api/seed-types?active=true&search=&page=&limit=
     POST  /api/seed-types
     PATCH /api/seed-types/:id
     GET   /api/varieties?seedTypeId=&search=
     GET   /api/varieties/progress?seedTypeId=&status=
     POST  /api/varieties
     GET   /api/companies?search=
     POST  /api/companies
*/
'use strict';

const express = require('express');
const { db, pagedQuery, httpError } = require('../db');
const { requireSession, requireRole } = require('../auth');

const router = express.Router();
router.use(requireSession);

const now = () => Date.now();
const like = (s) => '%' + String(s).trim().toLowerCase() + '%';

/* ---------------------------------------------------- seed types */

const SEED_TYPE_SELECT = `
  SELECT st.id, st.name, st.glyph, st.category, st.active,
         st.created_at AS createdAt,
         (SELECT COUNT(*) FROM varieties v WHERE v.seed_type_id = st.id) AS varietyCount
  FROM seed_types st`;

const shapeSeedType = (r) => ({ ...r, active: !!r.active });

router.get('/seed-types', (req, res) => {
  const w = [], p = {};
  if (req.query.active === 'true') w.push('st.active = 1');
  if (req.query.search) { w.push('(LOWER(st.name) LIKE @q OR LOWER(st.category) LIKE @q)'); p.q = like(req.query.search); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  const page = pagedQuery(
    SEED_TYPE_SELECT + where + ' ORDER BY st.created_at DESC',
    'SELECT COUNT(*) AS n FROM seed_types st' + where,
    p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeSeedType);
  res.json(page);
});

router.post('/seed-types', requireRole('admin'), (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim() || 'Uncategorised';
  if (!name) return next(httpError(422, 'Enter a crop category name.'));
  if (db.prepare('SELECT 1 FROM seed_types WHERE LOWER(name) = ?').get(name.toLowerCase())) {
    return next(httpError(409, `"${name}" already exists.`));
  }
  const id = 'st_' + (db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) AS m FROM seed_types').get().m + 1);
  db.prepare(`INSERT INTO seed_types (id, name, glyph, category, active, created_at)
              VALUES (?, ?, '🌱', ?, 1, ?)`).run(id, name, category, now());
  res.status(201).json(shapeSeedType(db.prepare(SEED_TYPE_SELECT + ' WHERE st.id = ?').get(id)));
});

router.patch('/seed-types/:id', requireRole('admin'), (req, res, next) => {
  const row = db.prepare('SELECT id FROM seed_types WHERE id = ?').get(req.params.id);
  if (!row) return next(httpError(404, 'Seed type not found.'));
  const active = req.body.active ? 1 : 0;
  /* Hiding a seed type hides its varieties too — this list is what the
     capture app shows people, so the two must not disagree. */
  db.transaction(() => {
    db.prepare('UPDATE seed_types SET active = ? WHERE id = ?').run(active, row.id);
    db.prepare('UPDATE varieties SET active = ? WHERE seed_type_id = ?').run(active, row.id);
  })();
  res.json(shapeSeedType(db.prepare(SEED_TYPE_SELECT + ' WHERE st.id = ?').get(row.id)));
});

/* ---------------------------------------------------- varieties */

const VARIETY_SELECT = `
  SELECT v.id, v.name, v.seed_type_id AS seedTypeId, st.name AS seedTypeName,
         st.glyph AS glyph, v.target, v.active, v.created_at AS createdAt,
         COALESCE(vs.approved, 0) AS approved,
         COALESCE(vs.pending, 0)  AS pending,
         COALESCE(vs.rejected, 0) AS rejected,
         COALESCE(vs.good, 0)     AS good,
         COALESCE(vs.normal, 0)   AS normal,
         COALESCE(vs.bad, 0)      AS bad
  FROM varieties v
  JOIN seed_types st ON st.id = v.seed_type_id
  LEFT JOIN variety_stats vs ON vs.variety_id = v.id`;

/** Progress is derived from the counters, not stored — one fewer thing
    that can drift out of step with the images actually collected. */
function shapeVariety(r) {
  const { good, normal, bad, ...rest } = r;
  return {
    ...rest,
    active: !!r.active,
    labels: { good, normal, bad },
    progress: r.target ? Math.round(r.approved / r.target * 100) : 0
  };
}

function varietyFilters(query) {
  const w = [], p = {};
  if (query.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = query.seedTypeId; }
  if (query.search) { w.push('(LOWER(v.name) LIKE @q OR LOWER(st.name) LIKE @q)'); p.q = like(query.search); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', p };
}

const COUNT_VARIETIES = `SELECT COUNT(*) AS n FROM varieties v JOIN seed_types st ON st.id = v.seed_type_id`;

router.get('/varieties', (req, res) => {
  const { where, p } = varietyFilters(req.query);
  const page = pagedQuery(
    VARIETY_SELECT + where + ' ORDER BY v.created_at DESC',
    COUNT_VARIETIES + where, p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeVariety);
  res.json(page);
});

/* One row per variety for the Dataset progress table, ordered by whichever
   column the screen is asking about. Whitelisted — never interpolated. */
const PROGRESS_ORDER = {
  approved: 'vs.approved DESC',
  pending_verification: 'vs.pending DESC',
  rejected: 'vs.rejected DESC'
};

router.get('/varieties/progress', (req, res) => {
  const { where, p } = varietyFilters(req.query);
  const order = PROGRESS_ORDER[req.query.status] || 'vs.approved DESC';
  const page = pagedQuery(
    VARIETY_SELECT + where + ' ORDER BY ' + order,
    COUNT_VARIETIES + where, p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeVariety);
  res.json(page);
});

router.post('/varieties', requireRole('admin'), (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const seedTypeId = req.body.seedTypeId;
  if (!name) return next(httpError(422, 'Enter a variety name.'));
  const st = db.prepare('SELECT * FROM seed_types WHERE id = ?').get(seedTypeId);
  if (!st) return next(httpError(422, 'Pick the seed type this variety belongs to.'));
  if (db.prepare('SELECT 1 FROM varieties WHERE LOWER(name) = ? AND seed_type_id = ?').get(name.toLowerCase(), seedTypeId)) {
    return next(httpError(409, `"${name}" already exists under ${st.name}.`));
  }
  const id = 'var_' + (db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS m FROM varieties').get().m + 1);
  db.transaction(() => {
    db.prepare(`INSERT INTO varieties (id, name, seed_type_id, target, active, created_at)
                VALUES (?, ?, ?, 150000, ?, ?)`).run(id, name, seedTypeId, st.active, now());
    db.prepare('INSERT INTO variety_stats (variety_id) VALUES (?)').run(id);
  })();
  res.status(201).json(shapeVariety(db.prepare(VARIETY_SELECT + ' WHERE v.id = ?').get(id)));
});

/* ---------------------------------------------------- companies */

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.location, c.active, c.created_at AS createdAt,
         (SELECT COUNT(DISTINCT s.variety_id) FROM submissions s WHERE s.company_id = c.id) AS varietyCount
  FROM companies c`;

const shapeCompany = (r) => ({ ...r, active: !!r.active });

router.get('/companies', (req, res) => {
  const w = [], p = {};
  if (req.query.search) { w.push('(LOWER(c.name) LIKE @q OR LOWER(COALESCE(c.location, \'\')) LIKE @q)'); p.q = like(req.query.search); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
  const page = pagedQuery(
    COMPANY_SELECT + where + ' ORDER BY c.created_at DESC',
    'SELECT COUNT(*) AS n FROM companies c' + where,
    p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeCompany);
  res.json(page);
});

router.post('/companies', requireRole('admin'), (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const location = String(req.body.location || '').trim() || null;
  if (!name) return next(httpError(422, 'Enter a company name.'));
  if (db.prepare('SELECT 1 FROM companies WHERE LOWER(name) = ?').get(name.toLowerCase())) {
    return next(httpError(409, `"${name}" already exists.`));
  }
  const id = 'co_' + (db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) AS m FROM companies').get().m + 1);
  db.prepare(`INSERT INTO companies (id, name, location, active, created_at)
              VALUES (?, ?, ?, 1, ?)`).run(id, name, location, now());
  res.status(201).json(shapeCompany(db.prepare(COMPANY_SELECT + ' WHERE c.id = ?').get(id)));
});

module.exports = router;
module.exports.VARIETY_SELECT = VARIETY_SELECT;
module.exports.shapeVariety = shapeVariety;
