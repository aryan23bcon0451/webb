/* Who sends the photos in. Every figure is rolled up from submissions, so
   a farmer's page and the image list always agree.

     GET  /api/farmers?search=&region=&seedTypeId=&sort=
     GET  /api/farmers/:id
     POST /api/farmers/:id/submissions
*/
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  db, paginate, httpError, bumpVariety, nextSeq, writeTxn,
  SUBMISSION_SELECT, shapeSubmission, UPLOAD_DIR
} = require('../db');
const { requireSession, requireRole } = require('../auth');

const router = express.Router();
router.use(requireSession);

const WEEK = 7 * 86400000;
const LABELS = ['Good', 'Normal', 'Bad'];

/* ---------------------------------------------------- profiles
   One pass over submissions for the headline figures, one for the crop
   breakdown. Cheaper than the per-farmer scan the mock did, and it keeps
   the derived numbers (acceptance, agreement) in one place. */
function profiles() {
  const since = Date.now() - WEEK;

  const base = db.prepare(`
    SELECT u.id, u.name, u.region,
           COUNT(s.id) AS uploaded,
           SUM(CASE WHEN s.status = 'approved'  THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN s.status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN s.status = 'pending_verification' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN s.uploaded_at > @since THEN 1 ELSE 0 END) AS thisWeek,
           MAX(s.uploaded_at) AS lastUploadAt,
           SUM(CASE WHEN s.final_label IS NOT NULL THEN 1 ELSE 0 END) AS labelled,
           SUM(CASE WHEN s.final_label IS NOT NULL AND s.final_label = s.label_by_user THEN 1 ELSE 0 END) AS agreed
    FROM users u
    LEFT JOIN submissions s ON s.farmer_id = u.id
    WHERE u.role = 'farmer'
    GROUP BY u.id, u.name, u.region`).all({ since });

  const crops = db.prepare(`
    SELECT s.farmer_id AS farmerId, v.seed_type_id AS seedTypeId,
           st.name AS name, st.glyph AS glyph, COUNT(*) AS count
    FROM submissions s
    JOIN varieties v ON v.id = s.variety_id
    JOIN seed_types st ON st.id = v.seed_type_id
    GROUP BY s.farmer_id, v.seed_type_id
    ORDER BY count DESC, st.name ASC`).all();

  const byFarmer = new Map();
  for (const c of crops) {
    if (!byFarmer.has(c.farmerId)) byFarmer.set(c.farmerId, []);
    byFarmer.get(c.farmerId).push({ seedTypeId: c.seedTypeId, name: c.name, glyph: c.glyph, count: c.count });
  }

  return base.map((f) => {
    const reviewed = f.approved + f.rejected;
    return {
      id: f.id, name: f.name, region: f.region,
      uploaded: f.uploaded, approved: f.approved, pending: f.pending, rejected: f.rejected,
      thisWeek: f.thisWeek, lastUploadAt: f.lastUploadAt || null,
      acceptance: reviewed ? f.approved / reviewed * 100 : null,
      agreement: f.labelled ? f.agreed / f.labelled * 100 : null,
      crops: byFarmer.get(f.id) || [],
      recent: []
    };
  });
}

const thumb = (s) => {
  const shaped = shapeSubmission(s);
  return { id: shaped.id, seq: shaped.seq, seedTypeName: shaped.seedTypeName, imageUrl: shaped.imageUrl };
};

/** The four most recent photos, used as thumbnails on the directory card. */
function recentFor(farmerId, n = 4) {
  return db.prepare(SUBMISSION_SELECT + ' WHERE s.farmer_id = @id ORDER BY s.uploaded_at DESC LIMIT @n')
    .all({ id: farmerId, n }).map(thumb);
}

/** Thumbnails for a whole page of farmers in one query instead of one query
    per row. ROW_NUMBER() ranks each farmer's photos independently, so the
    top four per farmer come back together. */
function recentForMany(farmerIds, n = 4) {
  const byFarmer = new Map(farmerIds.map((id) => [id, []]));
  if (!farmerIds.length) return byFarmer;
  const placeholders = farmerIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT s.id, s.seq, s.farmer_id AS farmerId, st.name AS seedTypeName, s.image_key AS imageKey,
             ROW_NUMBER() OVER (PARTITION BY s.farmer_id ORDER BY s.uploaded_at DESC) AS rn
      FROM submissions s
      JOIN varieties v ON v.id = s.variety_id
      JOIN seed_types st ON st.id = v.seed_type_id
      WHERE s.farmer_id IN (${placeholders})
    ) WHERE rn <= ?`).all(...farmerIds, n);
  for (const r of rows) {
    const list = byFarmer.get(r.farmerId);
    if (list) list.push(thumb(r));
  }
  return byFarmer;
}

const SORTS = {
  uploads: (a, b) => b.uploaded - a.uploaded,
  recent: (a, b) => (b.lastUploadAt || 0) - (a.lastUploadAt || 0),
  acceptance: (a, b) => (b.acceptance == null ? -1 : b.acceptance) - (a.acceptance == null ? -1 : a.acceptance),
  name: (a, b) => a.name.localeCompare(b.name)
};

/* ---------------------------------------------------- list */
router.get('/', (req, res) => {
  const q = req.query;
  const all = profiles();
  let rows = all;

  if (q.region) rows = rows.filter((f) => f.region === q.region);
  if (q.seedTypeId) rows = rows.filter((f) => f.crops.some((c) => c.seedTypeId === q.seedTypeId));
  if (q.search) {
    const needle = String(q.search).trim().toLowerCase();
    rows = rows.filter((f) =>
      f.name.toLowerCase().includes(needle) ||
      (f.region || '').toLowerCase().includes(needle) ||
      f.crops.some((c) => c.name.toLowerCase().includes(needle)));
  }
  rows = rows.slice().sort(SORTS[q.sort] || SORTS.uploads);

  const page = paginate([], rows.length, q.page, q.limit || 12);
  const limit = page.limit;
  const shown = rows.slice((page.page - 1) * limit, page.page * limit);
  /* Thumbnails only for the page shown, and in one query rather than one
     per farmer. */
  const thumbs = recentForMany(shown.map((f) => f.id));
  page.rows = shown.map((f) => ({ ...f, recent: thumbs.get(f.id) || [] }));

  let approved = 0, reviewed = 0, uploaded = 0;
  const regions = new Set();
  for (const f of all) {
    approved += f.approved;
    reviewed += f.approved + f.rejected;
    uploaded += f.uploaded;
    if (f.region) regions.add(f.region);
  }
  const top = all.slice().sort(SORTS.uploads)[0];

  page.summary = {
    farmers: all.length,
    uploaded,
    activeThisWeek: all.filter((f) => f.thisWeek > 0).length,
    acceptance: reviewed ? approved / reviewed * 100 : 0,
    regions: [...regions].sort(),
    topUploaderId: top ? top.id : null
  };
  res.json(page);
});

/* ---------------------------------------------------- one farmer */
router.get('/:id', (req, res, next) => {
  const all = profiles();
  const p = all.find((f) => f.id === req.params.id);
  if (!p) return next(httpError(404, 'Farmer not found.'));

  p.recent = recentFor(p.id);

  /* Uploads per week over the last 12 weeks, oldest first. */
  const activity = new Array(12).fill(0);
  const now = Date.now();
  const rows = db.prepare(`
    SELECT s.uploaded_at AS uploadedAt, s.status, s.reject_reason AS rejectReason, c.name AS companyName
    FROM submissions s JOIN companies c ON c.id = s.company_id
    WHERE s.farmer_id = ?`).all(p.id);

  const reasons = {}, companies = {};
  for (const s of rows) {
    const ago = Math.floor(Math.max(0, now - s.uploadedAt) / WEEK);
    if (ago >= 0 && ago < 12) activity[11 - ago]++;
    if (s.status === 'rejected' && s.rejectReason) reasons[s.rejectReason] = (reasons[s.rejectReason] || 0) + 1;
    companies[s.companyName] = (companies[s.companyName] || 0) + 1;
  }
  const tally = (counts, key) => Object.keys(counts)
    .map((k) => ({ [key]: k, count: counts[k] }))
    .sort((a, b) => b.count - a.count);

  const ranked = all.slice().sort(SORTS.uploads);
  p.activity = activity;
  p.reasons = tally(reasons, 'reason');
  p.companies = tally(companies, 'name');
  p.rank = ranked.findIndex((x) => x.id === p.id) + 1;
  p.farmerCount = ranked.length;
  res.json(p);
});

/* ---------------------------------------------------- add photos
   Photos added from the dashboard on a farmer's behalf. They enter the
   labelling queue exactly as field-app uploads do. */
const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' };

router.post('/:id/submissions', requireRole('admin', 'verifier'), (req, res, next) => {
  const body = req.body || {};
  const me = req.user;

  const farmer = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'farmer'").get(req.params.id);
  if (!farmer) return next(httpError(404, 'Farmer not found.'));

  const variety = db.prepare(`
    SELECT v.*, st.name AS seedTypeName FROM varieties v
    JOIN seed_types st ON st.id = v.seed_type_id WHERE v.id = ?`).get(body.varietyId);
  if (!variety) return next(httpError(422, 'Choose the crop and variety these photos show.'));

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(body.companyId);
  if (!company) return next(httpError(422, 'Choose the seed company.'));
  if (!LABELS.includes(body.label)) return next(httpError(422, "Choose the farmer's quality call."));

  const images = (body.images || []).filter((im) => im && DATA_URL.test(im.dataUrl || ''));
  if (!images.length) return next(httpError(422, 'Add at least one photo.'));
  if (images.length > 100) return next(httpError(422, 'Add at most 100 photos at a time.'));

  const at = Date.now();
  const created = [];
  const written = [];

  /* Hoisted out of the loop: db.prepare() compiles a new statement every
     call, and this runs up to 100 times per request. */
  const addSub = db.prepare(`
    INSERT INTO submissions (id, seq, status, variety_id, company_id, farmer_id,
                             label_by_user, width, height, uploaded_at, image_key)
    VALUES (?, ?, 'pending_verification', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addTrail = db.prepare(
    'INSERT INTO trail (submission_id, at, kind, title, note) VALUES (?, ?, ?, ?, ?)');

  try {
    writeTxn(() => {
      images.forEach((im, i) => {
        const [, mime, b64] = im.dataUrl.match(DATA_URL);
        const seq = nextSeq();
        const id = 'CF-2026-' + seq;
        const key = id + '.' + (EXT[mime] || 'jpg');
        const uploadedAt = at - i;                   // the first photo picked lists first

        /* Write the file before the row: a stray file is harmless, a row
           pointing at nothing is a broken thumbnail. */
        fs.writeFileSync(path.join(UPLOAD_DIR, key), Buffer.from(b64, 'base64'));
        written.push(key);

        addSub.run(id, seq, variety.id, company.id, farmer.id, body.label,
          Math.round(im.width) || 0, Math.round(im.height) || 0, uploadedAt, key);

        const note = (im.from ? 'Frame from ' + String(im.from).slice(0, 160) : 'Uploaded from the dashboard') +
          ` · labelled "${body.label}" on the farmer's behalf`;
        addTrail.run(id, uploadedAt, 'upload', `Added by ${me.name} for ${farmer.name}`, note);
        addTrail.run(id, uploadedAt, 'queue', 'Awaiting verification', 'Queued as pending_verification');

        bumpVariety(variety.id, { pending: 1 });
        created.push(id);
      });
    })();
  } catch (err) {
    /* The transaction rolled back, so the rows are gone — but the files were
       written outside it. Remove them rather than leaving orphans on disk. */
    for (const key of written) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, key)); } catch (e) { /* nothing to undo */ }
    }
    return next(err);
  }

  const placeholders = created.map(() => '?').join(',');
  const rows = db.prepare(SUBMISSION_SELECT + ` WHERE s.id IN (${placeholders}) ORDER BY s.uploaded_at DESC`)
    .all(...created);
  res.status(201).json({ rows: rows.map(shapeSubmission) });
});

module.exports = router;
