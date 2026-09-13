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
const { q, one, tx, pagedQuery, httpError } = require('../db');
const { requireSession, requireRole } = require('../auth');

const router = express.Router();
router.use(requireSession);

const now = () => Date.now();
const like = (s) => '%' + String(s).trim().toLowerCase() + '%';

/* ---------------------------------------------------- seed types */

const SEED_TYPE_SELECT = `
  SELECT st.id, st.name, st.glyph, st.category, st.active,
         st.created_at AS "createdAt",
         (SELECT COUNT(*)::int FROM varieties v WHERE v.seed_type_id = st.id) AS "varietyCount"
  FROM seed_types st`;

router.get('/seed-types', async (req, res) => {
  const w = [], p = {};
  if (req.query.active === 'true') w.push('st.active = TRUE');
  if (req.query.search) { w.push('(LOWER(st.name) LIKE @q OR LOWER(st.category) LIKE @q)'); p.q = like(req.query.search); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  res.json(await pagedQuery(
    SEED_TYPE_SELECT + where + ' ORDER BY st.created_at DESC',
    'SELECT COUNT(*)::int AS n FROM seed_types st' + where,
    p, req.query.page, req.query.limit || 5
  ));
});

/* Ids are st_<n> / var_<n> / co_<n>. Deriving the next one from MAX is
   racy, so each derivation happens inside the same transaction as the
   insert, and a UNIQUE collision surfaces as a 409. */
const nextId = async (tq, prefix, table) => prefix +
  ((await tq(`SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '^${prefix}', ''), '')::int), 0) + 1 AS m FROM ${table}`))[0].m);

router.post('/seed-types', requireRole('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim() || 'Uncategorised';
  if (!name) throw httpError(422, 'Enter a crop category name.');
  if (await one('SELECT 1 FROM seed_types WHERE LOWER(name) = @n', { n: name.toLowerCase() })) {
    throw httpError(409, `"${name}" already exists.`);
  }
  const id = await tx(async (tq) => {
    const newId = await nextId(tq, 'st_', 'seed_types');
    await tq(`INSERT INTO seed_types (id, name, glyph, category, active, created_at)
              VALUES (@id, @name, '🌱', @category, TRUE, @at)`,
      { id: newId, name, category, at: now() });
    return newId;
  });
  res.status(201).json(await one(SEED_TYPE_SELECT + ' WHERE st.id = @id', { id }));
});

router.patch('/seed-types/:id', requireRole('admin'), async (req, res) => {
  const row = await one('SELECT id FROM seed_types WHERE id = @id', { id: req.params.id });
  if (!row) throw httpError(404, 'Seed type not found.');
  const active = !!req.body.active;
  /* Hiding a seed type hides its varieties too — this list is what the
     capture app shows people, so the two must not disagree. */
  await tx(async (tq) => {
    await tq('UPDATE seed_types SET active = @a WHERE id = @id', { a: active, id: row.id });
    await tq('UPDATE varieties SET active = @a WHERE seed_type_id = @id', { a: active, id: row.id });
  });
  res.json(await one(SEED_TYPE_SELECT + ' WHERE st.id = @id', { id: row.id }));
});

/* ---------------------------------------------------- varieties */

const VARIETY_SELECT = `
  SELECT v.id, v.name, v.seed_type_id AS "seedTypeId", st.name AS "seedTypeName",
         st.glyph AS glyph, v.target, v.active, v.created_at AS "createdAt",
         COALESCE(vs.approved, 0) AS approved,
         COALESCE(vs.pending, 0)  AS pending,
         COALESCE(vs.rejected, 0) AS rejected,
         COALESCE(vs.good, 0)     AS good,
         COALESCE(vs.normal, 0)   AS normal,
         COALESCE(vs.bad, 0)      AS bad
  FROM varieties v
  JOIN seed_types st ON st.id = v.seed_type_id
  LEFT JOIN variety_stats vs ON vs.variety_id = v.id`;

/** Progress is derived from the counters, not stored — one fewer thing that
    can drift out of step with the images actually collected. */
function shapeVariety(r) {
  const { good, normal, bad, ...rest } = r;
  return {
    ...rest,
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

const COUNT_VARIETIES =
  'SELECT COUNT(*)::int AS n FROM varieties v JOIN seed_types st ON st.id = v.seed_type_id';

router.get('/varieties', async (req, res) => {
  const { where, p } = varietyFilters(req.query);
  const page = await pagedQuery(
    VARIETY_SELECT + where + ' ORDER BY v.created_at DESC',
    COUNT_VARIETIES + where, p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeVariety);
  res.json(page);
});

/* One row per variety for the Dataset progress table, ordered by whichever
   column the screen is asking about. Whitelisted — never interpolated. */
const PROGRESS_ORDER = {
  approved: 'vs.approved DESC NULLS LAST',
  pending_verification: 'vs.pending DESC NULLS LAST',
  rejected: 'vs.rejected DESC NULLS LAST'
};

router.get('/varieties/progress', async (req, res) => {
  const { where, p } = varietyFilters(req.query);
  const order = PROGRESS_ORDER[req.query.status] || PROGRESS_ORDER.approved;
  const page = await pagedQuery(
    VARIETY_SELECT + where + ' ORDER BY ' + order,
    COUNT_VARIETIES + where, p, req.query.page, req.query.limit || 5
  );
  page.rows = page.rows.map(shapeVariety);
  res.json(page);
});

router.post('/varieties', requireRole('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const seedTypeId = req.body.seedTypeId;
  if (!name) throw httpError(422, 'Enter a variety name.');
  const st = await one('SELECT * FROM seed_types WHERE id = @id', { id: seedTypeId });
  if (!st) throw httpError(422, 'Pick the seed type this variety belongs to.');
  if (await one('SELECT 1 FROM varieties WHERE LOWER(name) = @n AND seed_type_id = @st',
    { n: name.toLowerCase(), st: seedTypeId })) {
    throw httpError(409, `"${name}" already exists under ${st.name}.`);
  }
  const id = await tx(async (tq) => {
    const newId = await nextId(tq, 'var_', 'varieties');
    await tq(`INSERT INTO varieties (id, name, seed_type_id, target, active, created_at)
              VALUES (@id, @name, @st, 150000, @active, @at)`,
      { id: newId, name, st: seedTypeId, active: st.active, at: now() });
    await tq('INSERT INTO variety_stats (variety_id) VALUES (@id)', { id: newId });
    return newId;
  });
  res.status(201).json(shapeVariety(await one(VARIETY_SELECT + ' WHERE v.id = @id', { id })));
});

/* ---------------------------------------------------- companies */

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.location, c.active, c.created_at AS "createdAt",
         (SELECT COUNT(DISTINCT s.variety_id)::int FROM submissions s WHERE s.company_id = c.id) AS "varietyCount"
  FROM companies c`;

router.get('/companies', async (req, res) => {
  const w = [], p = {};
  if (req.query.search) {
    w.push("(LOWER(c.name) LIKE @q OR LOWER(COALESCE(c.location, '')) LIKE @q)");
    p.q = like(req.query.search);
  }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
  res.json(await pagedQuery(
    COMPANY_SELECT + where + ' ORDER BY c.created_at DESC',
    'SELECT COUNT(*)::int AS n FROM companies c' + where,
    p, req.query.page, req.query.limit || 5
  ));
});

router.post('/companies', requireRole('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const location = String(req.body.location || '').trim() || null;
  if (!name) throw httpError(422, 'Enter a company name.');
  if (await one('SELECT 1 FROM companies WHERE LOWER(name) = @n', { n: name.toLowerCase() })) {
    throw httpError(409, `"${name}" already exists.`);
  }
  const id = await tx(async (tq) => {
    const newId = await nextId(tq, 'co_', 'companies');
    await tq(`INSERT INTO companies (id, name, location, active, created_at)
              VALUES (@id, @name, @loc, TRUE, @at)`,
      { id: newId, name, loc: location, at: now() });
    return newId;
  });
  res.status(201).json(await one(COMPANY_SELECT + ' WHERE c.id = @id', { id }));
});

module.exports = router;
