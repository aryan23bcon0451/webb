/* The labelling queue, the image search, review writes and deletes.

     GET    /api/submissions?status=&seedTypeId=&label=&farmerId=&search=...
     GET    /api/submissions/queue?seedTypeId=&farmerId=
     GET    /api/submissions/:id
     POST   /api/submissions/:id/review   { action, label }
     POST   /api/submissions/:id/skip
     DELETE /api/submissions              { ids }
*/
'use strict';

const express = require('express');
const {
  q, one, tx, pagedQuery, httpError, bumpVarietyTx,
  SUBMISSION_SELECT, COUNT_SUBMISSIONS, shapeSubmission
} = require('../db');
const { requireSession, requireRole } = require('../auth');
const storage = require('../storage');

const router = express.Router();
router.use(requireSession);

const LABELS = ['Good', 'Normal', 'Bad'];

const loadTrail = (id) =>
  q('SELECT at, kind, title, note FROM trail WHERE submission_id = @id ORDER BY at ASC', { id });

/* ---------------------------------------------------- queue
   Oldest first, and not paginated: the labelling screen holds a working set
   so one keypress can advance to the next image with no fetch.

   It is capped, though. "Not paginated" and "send every pending row" are
   different things — there are hundreds of thousands of pending images in
   production, and serialising them all would take the function down. The
   cap is a working set; `total` still reports the true figure. */
const QUEUE_LIMIT = 500;

router.get('/queue', async (req, res) => {
  const w = ["s.status = 'pending_verification'"], p = {};
  if (req.query.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = req.query.seedTypeId; }
  if (req.query.farmerId) { w.push('s.farmer_id = @fid'); p.fid = req.query.farmerId; }
  const where = ' WHERE ' + w.join(' AND ');

  const total = (await one(`
    SELECT COUNT(*)::int AS n FROM submissions s
    JOIN varieties v ON v.id = s.variety_id` + where, p)).n;

  /* Deferred images sort by when they were deferred, everything else by when
     it was uploaded — so "decide later" moves an image to the back without
     touching its upload time. */
  const rows = await q(SUBMISSION_SELECT + where +
    ' ORDER BY COALESCE(s.deferred_at, s.uploaded_at) ASC LIMIT @__limit',
    { ...p, __limit: QUEUE_LIMIT });

  res.json({
    rows: rows.map(shapeSubmission),
    total,
    returned: rows.length,
    truncated: total > rows.length,
    fetchedAt: Date.now()
  });
});

/* ---------------------------------------------------- search */
router.get('/', async (req, res) => {
  const query = req.query;
  const w = [], p = {};
  if (query.status) { w.push('s.status = @status'); p.status = query.status; }
  if (query.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = query.seedTypeId; }
  if (query.varietyId) { w.push('s.variety_id = @vid'); p.vid = query.varietyId; }
  if (query.companyId) { w.push('s.company_id = @cid'); p.cid = query.companyId; }
  if (query.label) { w.push('s.final_label = @label'); p.label = query.label; }
  if (query.farmerId) { w.push('s.farmer_id = @fid'); p.fid = query.farmerId; }
  if (query.verifierId) { w.push('s.verifier_id = @vfid'); p.vfid = query.verifierId; }
  if (query.dateFrom) { w.push('s.uploaded_at >= @from'); p.from = Number(query.dateFrom); }
  if (query.dateTo) { w.push('s.uploaded_at <= @to'); p.to = Number(query.dateTo); }
  if (query.search) {
    w.push(`(LOWER(s.id) LIKE @q OR LOWER(f.name) LIKE @q OR LOWER(st.name) LIKE @q
             OR LOWER(v.name) LIKE @q OR LOWER(c.name) LIKE @q)`);
    p.q = '%' + String(query.search).trim().toLowerCase() + '%';
  }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  const page = await pagedQuery(
    SUBMISSION_SELECT + where + ' ORDER BY COALESCE(s.reviewed_at, s.uploaded_at) DESC',
    COUNT_SUBMISSIONS + where,
    p, query.page, query.limit || 10
  );
  page.rows = page.rows.map(shapeSubmission);
  res.json(page);
});

/* ---------------------------------------------------- one image */
router.get('/:id', async (req, res) => {
  const row = await one(SUBMISSION_SELECT + ' WHERE s.id = @id', { id: req.params.id });
  if (!row) throw httpError(404, 'Submission not found.');
  res.json({ ...shapeSubmission(row), trail: await loadTrail(row.id) });
});

/* ---------------------------------------------------- review
   The label is the save: one call records the decision, moves the counters
   and writes the audit line, all in one transaction. */
router.post('/:id/review', requireRole('verifier', 'admin'), async (req, res) => {
  const { action, label } = req.body;
  const row = await one('SELECT * FROM submissions WHERE id = @id', { id: req.params.id });
  if (!row) throw httpError(404, 'Submission not found.');
  if (row.status !== 'pending_verification') throw httpError(409, 'This submission has already been reviewed.');
  if (action === 'approve' && !LABELS.includes(label)) {
    throw httpError(422, 'Choose a quality label before approving.');
  }
  if (action !== 'approve' && action !== 'reject') throw httpError(422, 'Unknown review action.');

  const at = Date.now();
  const me = req.user;

  /* The status check above is only a fast path — between it and the write,
     another labeller could have claimed the same image. The UPDATE carries
     the status in its WHERE clause and we act on the row count, so the
     counters can never be moved twice for one decision. */
  const applied = await tx(async (tq) => {
    const claimed = action === 'approve'
      ? await tq(`UPDATE submissions SET status = 'approved', final_label = @label,
                    verifier_id = @me, reviewed_at = @at, deferred_at = NULL
                  WHERE id = @id AND status = 'pending_verification' RETURNING id`,
        { label, me: me.id, at, id: row.id })
      : await tq(`UPDATE submissions SET status = 'rejected', reject_reason = @reason,
                    verifier_id = @me, reviewed_at = @at, deferred_at = NULL
                  WHERE id = @id AND status = 'pending_verification' RETURNING id`,
        { reason: 'Rejected during verification', me: me.id, at, id: row.id });

    if (!claimed.length) return false;          // someone else got there first

    if (action === 'approve') {
      await tq(`INSERT INTO trail (submission_id, at, kind, title, note)
                VALUES (@id, @at, 'approve', @title, @note)`,
        { id: row.id, at, title: 'Approved by ' + me.name, note: `Final label recorded as "${label}"` });
      await bumpVarietyTx(tq, row.variety_id, { pending: -1, approved: 1, [label.toLowerCase()]: 1 });
    } else {
      await tq(`INSERT INTO trail (submission_id, at, kind, title, note)
                VALUES (@id, @at, 'reject', @title, @note)`,
        { id: row.id, at, title: 'Rejected by ' + me.name, note: 'Rejected during verification' });
      await bumpVarietyTx(tq, row.variety_id, { pending: -1, rejected: 1 });
    }
    return true;
  });

  if (!applied) throw httpError(409, 'This submission has already been reviewed.');

  const fresh = await one(SUBMISSION_SELECT + ' WHERE s.id = @id', { id: row.id });
  res.json({ ...shapeSubmission(fresh), trail: await loadTrail(row.id) });
});

/* Leaves the item pending and drops it to the back of the queue.
   Stamps deferred_at rather than rewriting uploaded_at: the upload time is
   provenance — it ships in the export manifest and drives the farmer's
   activity chart — so deferring an image must not falsify when it was taken. */
router.post('/:id/skip', requireRole('verifier', 'admin'), async (req, res) => {
  const row = await one('SELECT id, status FROM submissions WHERE id = @id', { id: req.params.id });
  if (!row) throw httpError(404, 'Submission not found.');
  if (row.status !== 'pending_verification') {
    throw httpError(409, 'This submission has already been reviewed.');
  }
  await q(`UPDATE submissions SET deferred_at = @at
           WHERE id = @id AND status = 'pending_verification'`, { at: Date.now(), id: row.id });
  res.json(shapeSubmission(await one(SUBMISSION_SELECT + ' WHERE s.id = @id', { id: row.id })));
});

/* ---------------------------------------------------- delete
   Removes photos for good: from the farmer's uploads, the queue and every
   export. Admins only. The stored object goes with the row. */
router.delete('/', requireRole('admin'), async (req, res) => {
  const raw = Array.isArray(req.body.ids) ? req.body.ids : [];
  /* De-duplicate and drop non-strings: the same id twice would decrement a
     variety's counters twice for one photo. Capped so one request cannot
     build a statement with a hundred thousand parameters. */
  const ids = [...new Set(raw.filter((x) => typeof x === 'string' && x))].slice(0, 500);
  if (!ids.length) throw httpError(422, 'No photos selected.');

  const rows = await q(`SELECT id, status, final_label, variety_id, image_key
                        FROM submissions WHERE id = ANY(@ids)`, { ids });
  if (!rows.length) throw httpError(404, 'Those photos no longer exist.');

  await tx(async (tq) => {
    for (const s of rows) {
      if (s.status === 'pending_verification') await bumpVarietyTx(tq, s.variety_id, { pending: -1 });
      else if (s.status === 'rejected') await bumpVarietyTx(tq, s.variety_id, { rejected: -1 });
      else {
        const delta = { approved: -1 };
        if (s.final_label) delta[s.final_label.toLowerCase()] = -1;
        await bumpVarietyTx(tq, s.variety_id, delta);
      }
    }
    await tq('DELETE FROM submissions WHERE id = ANY(@ids)', { ids });
  });

  /* Objects last: a failed delete in the store must not roll back a
     committed database delete. */
  await Promise.all(rows.filter((s) => s.image_key)
    .map((s) => storage.del(s.image_key).catch(() => { /* already gone */ })));

  res.json({ deleted: rows.length });
});

module.exports = router;
