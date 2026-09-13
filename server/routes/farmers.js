/* Who sends the photos in. Every figure is rolled up from submissions, so
   a farmer's page and the image list always agree.

     GET  /api/farmers?search=&region=&seedTypeId=&sort=
     GET  /api/farmers/:id
     POST /api/farmers/:id/submissions
*/
'use strict';

const express = require('express');
const {
  q, one, tx, paginate, httpError, bumpVarietyTx, nextSeq,
  SUBMISSION_SELECT, shapeSubmission
} = require('../db');
const { requireSession, requireRole } = require('../auth');
const storage = require('../storage');

const router = express.Router();
router.use(requireSession);

const WEEK = 7 * 86400000;
const LABELS = ['Good', 'Normal', 'Bad'];

/* ---------------------------------------------------- profiles
   One pass over submissions for the headline figures, one for the crop
   breakdown — rather than the per-farmer scan the mock did. Keeps the
   derived numbers (acceptance, agreement) in one place. */
async function profiles() {
  const since = Date.now() - WEEK;

  const base = await q(`
    SELECT u.id, u.name, u.region,
           COUNT(s.id)::int AS uploaded,
           COALESCE(SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END), 0)::int AS approved,
           COALESCE(SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END), 0)::int AS rejected,
           COALESCE(SUM(CASE WHEN s.status = 'pending_verification' THEN 1 ELSE 0 END), 0)::int AS pending,
           COALESCE(SUM(CASE WHEN s.uploaded_at > @since THEN 1 ELSE 0 END), 0)::int AS "thisWeek",
           MAX(s.uploaded_at) AS "lastUploadAt",
           COALESCE(SUM(CASE WHEN s.final_label IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS labelled,
           COALESCE(SUM(CASE WHEN s.final_label IS NOT NULL AND s.final_label = s.label_by_user THEN 1 ELSE 0 END), 0)::int AS agreed
    FROM users u
    LEFT JOIN submissions s ON s.farmer_id = u.id
    WHERE u.role = 'farmer'
    GROUP BY u.id, u.name, u.region`, { since });

  const crops = await q(`
    SELECT s.farmer_id AS "farmerId", v.seed_type_id AS "seedTypeId",
           st.name AS name, st.glyph AS glyph, COUNT(*)::int AS count
    FROM submissions s
    JOIN varieties v ON v.id = s.variety_id
    JOIN seed_types st ON st.id = v.seed_type_id
    GROUP BY s.farmer_id, v.seed_type_id, st.name, st.glyph
    ORDER BY count DESC, st.name ASC`);

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
      thisWeek: f.thisWeek, lastUploadAt: f.lastUploadAt == null ? null : Number(f.lastUploadAt),
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
const recentFor = async (farmerId, n = 4) =>
  (await q(SUBMISSION_SELECT + ' WHERE s.farmer_id = @id ORDER BY s.uploaded_at DESC LIMIT @n',
    { id: farmerId, n })).map(thumb);

/** Thumbnails for a whole page of farmers in one query instead of one per
    row. ROW_NUMBER() ranks each farmer's photos independently, so the top
    four per farmer come back together. */
async function recentForMany(farmerIds, n = 4) {
  const byFarmer = new Map(farmerIds.map((id) => [id, []]));
  if (!farmerIds.length) return byFarmer;
  const rows = await q(`
    SELECT * FROM (
      SELECT s.id, s.seq, s.farmer_id AS "farmerId", st.name AS "seedTypeName",
             s.image_key AS "imageKey",
             ROW_NUMBER() OVER (PARTITION BY s.farmer_id ORDER BY s.uploaded_at DESC) AS rn
      FROM submissions s
      JOIN varieties v ON v.id = s.variety_id
      JOIN seed_types st ON st.id = v.seed_type_id
      WHERE s.farmer_id = ANY(@ids)
    ) ranked WHERE rn <= @n`, { ids: farmerIds, n });
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
router.get('/', async (req, res) => {
  const query = req.query;
  const all = await profiles();
  let rows = all;

  if (query.region) rows = rows.filter((f) => f.region === query.region);
  if (query.seedTypeId) rows = rows.filter((f) => f.crops.some((c) => c.seedTypeId === query.seedTypeId));
  if (query.search) {
    const needle = String(query.search).trim().toLowerCase();
    rows = rows.filter((f) =>
      f.name.toLowerCase().includes(needle) ||
      (f.region || '').toLowerCase().includes(needle) ||
      f.crops.some((c) => c.name.toLowerCase().includes(needle)));
  }
  rows = rows.slice().sort(SORTS[query.sort] || SORTS.uploads);

  const page = paginate([], rows.length, query.page, query.limit || 12);
  const limit = page.limit;
  const shown = rows.slice((page.page - 1) * limit, page.page * limit);
  /* Thumbnails only for the page shown, and in one query rather than one
     per farmer. */
  const thumbs = await recentForMany(shown.map((f) => f.id));
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
router.get('/:id', async (req, res) => {
  const all = await profiles();
  const p = all.find((f) => f.id === req.params.id);
  if (!p) throw httpError(404, 'Farmer not found.');

  p.recent = await recentFor(p.id);

  /* Uploads per week over the last 12 weeks, oldest first. */
  const activity = new Array(12).fill(0);
  const now = Date.now();
  const rows = await q(`
    SELECT s.uploaded_at AS "uploadedAt", s.status, s.reject_reason AS "rejectReason",
           c.name AS "companyName"
    FROM submissions s JOIN companies c ON c.id = s.company_id
    WHERE s.farmer_id = @id`, { id: p.id });

  const reasons = {}, companies = {};
  for (const s of rows) {
    const ago = Math.floor(Math.max(0, now - Number(s.uploadedAt)) / WEEK);
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

router.post('/:id/submissions', requireRole('admin', 'verifier'), async (req, res) => {
  const body = req.body || {};
  const me = req.user;

  const farmer = await one("SELECT * FROM users WHERE id = @id AND role = 'farmer'", { id: req.params.id });
  if (!farmer) throw httpError(404, 'Farmer not found.');

  const variety = await one(`
    SELECT v.*, st.name AS "seedTypeName" FROM varieties v
    JOIN seed_types st ON st.id = v.seed_type_id WHERE v.id = @id`, { id: body.varietyId });
  if (!variety) throw httpError(422, 'Choose the crop and variety these photos show.');

  const company = await one('SELECT * FROM companies WHERE id = @id', { id: body.companyId });
  if (!company) throw httpError(422, 'Choose the seed company.');
  if (!LABELS.includes(body.label)) throw httpError(422, "Choose the farmer's quality call.");

  const images = (body.images || []).filter((im) => im && DATA_URL.test(im.dataUrl || ''));
  if (!images.length) throw httpError(422, 'Add at least one photo.');
  if (images.length > 100) throw httpError(422, 'Add at most 100 photos at a time.');

  const at = Date.now();

  /* Allocate ids and upload the objects before opening the transaction:
     an object store call inside a database transaction holds a connection
     open for the length of a network round trip per photo. */
  const prepared = [];
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const [, mime, b64] = im.dataUrl.match(DATA_URL);
    const seq = await nextSeq();
    const id = 'CF-2026-' + seq;
    prepared.push({
      id, seq, key: id + '.' + (EXT[mime] || 'jpg'),
      body: Buffer.from(b64, 'base64'),
      width: Math.round(im.width) || 0, height: Math.round(im.height) || 0,
      uploadedAt: at - i,                       // the first photo picked lists first
      from: im.from || null
    });
  }

  const stored = [];
  try {
    for (const p of prepared) {
      await storage.put(p.key, p.body, storage.contentTypeFor(p.key));
      stored.push(p.key);
    }

    await tx(async (tq) => {
      for (const p of prepared) {
        await tq(`
          INSERT INTO submissions (id, seq, status, variety_id, company_id, farmer_id,
                                   label_by_user, width, height, uploaded_at, image_key)
          VALUES (@id, @seq, 'pending_verification', @vid, @cid, @fid,
                  @label, @w, @h, @at, @key)`,
          { id: p.id, seq: p.seq, vid: variety.id, cid: company.id, fid: farmer.id,
            label: body.label, w: p.width, h: p.height, at: p.uploadedAt, key: p.key });

        const note = (p.from ? 'Frame from ' + String(p.from).slice(0, 160) : 'Uploaded from the dashboard') +
          ` · labelled "${body.label}" on the farmer's behalf`;
        await tq(`INSERT INTO trail (submission_id, at, kind, title, note)
                  VALUES (@id, @at, 'upload', @title, @note)`,
          { id: p.id, at: p.uploadedAt, title: `Added by ${me.name} for ${farmer.name}`, note });
        await tq(`INSERT INTO trail (submission_id, at, kind, title, note)
                  VALUES (@id, @at, 'queue', 'Awaiting verification', 'Queued as pending_verification')`,
          { id: p.id, at: p.uploadedAt });

        await bumpVarietyTx(tq, variety.id, { pending: 1 });
      }
    });
  } catch (err) {
    /* The transaction rolled back, so the rows are gone — but the objects
       were written outside it. Remove them rather than leaving orphans. */
    await Promise.all(stored.map((key) => storage.del(key).catch(() => {})));
    throw err;
  }

  const rows = await q(SUBMISSION_SELECT + ' WHERE s.id = ANY(@ids) ORDER BY s.uploaded_at DESC',
    { ids: prepared.map((p) => p.id) });
  res.status(201).json({ rows: rows.map(shapeSubmission) });
});

module.exports = router;
