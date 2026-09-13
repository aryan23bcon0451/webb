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
const fs = require('fs');
const path = require('path');
const {
  db, pagedQuery, httpError, bumpVariety, writeTxn,
  SUBMISSION_SELECT, shapeSubmission, UPLOAD_DIR
} = require('../db');
const { requireSession, requireRole } = require('../auth');

const router = express.Router();
router.use(requireSession);

const LABELS = ['Good', 'Normal', 'Bad'];

function loadTrail(id) {
  return db.prepare('SELECT at, kind, title, note FROM trail WHERE submission_id = ? ORDER BY at ASC').all(id);
}

/* ---------------------------------------------------- queue
   Oldest first, and not paginated: the labelling screen holds a working set
   so one keypress can advance to the next image with no fetch.

   It is capped, though. "Not paginated" and "send every pending row" are
   different things — there are hundreds of thousands of pending images in
   production, and serialising them all would take the server down. The cap
   is a working set; `total` still reports the true figure. */
const QUEUE_LIMIT = 500;

router.get('/queue', (req, res) => {
  const w = ["s.status = 'pending_verification'"], p = {};
  if (req.query.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = req.query.seedTypeId; }
  if (req.query.farmerId) { w.push('s.farmer_id = @fid'); p.fid = req.query.farmerId; }
  const where = ' WHERE ' + w.join(' AND ');

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM submissions s
    JOIN varieties v ON v.id = s.variety_id` + where).get(p).n;

  /* Deferred images sort by when they were deferred, everything else by when
     it was uploaded — so "decide later" moves an image to the back without
     touching its upload time. */
  const rows = db.prepare(SUBMISSION_SELECT + where +
    ' ORDER BY COALESCE(s.deferred_at, s.uploaded_at) ASC LIMIT @__limit')
    .all({ ...p, __limit: QUEUE_LIMIT });

  res.json({
    rows: rows.map(shapeSubmission),
    total,
    returned: rows.length,
    truncated: total > rows.length,
    fetchedAt: Date.now()
  });
});

/* ---------------------------------------------------- search */
router.get('/', (req, res) => {
  const q = req.query;
  const w = [], p = {};
  if (q.status) { w.push('s.status = @status'); p.status = q.status; }
  if (q.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = q.seedTypeId; }
  if (q.varietyId) { w.push('s.variety_id = @vid'); p.vid = q.varietyId; }
  if (q.companyId) { w.push('s.company_id = @cid'); p.cid = q.companyId; }
  if (q.label) { w.push('s.final_label = @label'); p.label = q.label; }
  if (q.farmerId) { w.push('s.farmer_id = @fid'); p.fid = q.farmerId; }
  if (q.verifierId) { w.push('s.verifier_id = @vfid'); p.vfid = q.verifierId; }
  if (q.dateFrom) { w.push('s.uploaded_at >= @from'); p.from = Number(q.dateFrom); }
  if (q.dateTo) { w.push('s.uploaded_at <= @to'); p.to = Number(q.dateTo); }
  if (q.search) {
    w.push(`(LOWER(s.id) LIKE @q OR LOWER(f.name) LIKE @q OR LOWER(st.name) LIKE @q
             OR LOWER(v.name) LIKE @q OR LOWER(c.name) LIKE @q)`);
    p.q = '%' + String(q.search).trim().toLowerCase() + '%';
  }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  const page = pagedQuery(
    SUBMISSION_SELECT + where + ' ORDER BY COALESCE(s.reviewed_at, s.uploaded_at) DESC',
    `SELECT COUNT(*) AS n FROM submissions s
       JOIN varieties v ON v.id = s.variety_id
       JOIN seed_types st ON st.id = v.seed_type_id
       JOIN companies c ON c.id = s.company_id
       JOIN users f ON f.id = s.farmer_id` + where,
    p, q.page, q.limit || 10
  );
  page.rows = page.rows.map(shapeSubmission);
  res.json(page);
});

/* ---------------------------------------------------- one image */
router.get('/:id', (req, res, next) => {
  const row = db.prepare(SUBMISSION_SELECT + ' WHERE s.id = @id').get({ id: req.params.id });
  if (!row) return next(httpError(404, 'Submission not found.'));
  res.json({ ...shapeSubmission(row), trail: loadTrail(row.id) });
});

/* ---------------------------------------------------- review
   The label is the save: one call records the decision, moves the counters
   and writes the audit line, all in one transaction. */
router.post('/:id/review', requireRole('verifier', 'admin'), (req, res, next) => {
  const { action, label } = req.body;
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return next(httpError(404, 'Submission not found.'));
  if (row.status !== 'pending_verification') return next(httpError(409, 'This submission has already been reviewed.'));
  if (action === 'approve' && !LABELS.includes(label)) {
    return next(httpError(422, 'Choose a quality label before approving.'));
  }
  if (action !== 'approve' && action !== 'reject') return next(httpError(422, 'Unknown review action.'));

  const at = Date.now();
  const me = req.user;

  /* The status check above is only a fast path — between it and the write,
     another labeller could have claimed the same image. The UPDATE carries
     the status in its WHERE clause and we act on the row count, so the
     counters can never be moved twice for one decision. */
  const applied = writeTxn(() => {
    const claim = action === 'approve'
      ? db.prepare(`UPDATE submissions SET status = 'approved', final_label = @label,
                      verifier_id = @me, reviewed_at = @at, deferred_at = NULL
                    WHERE id = @id AND status = 'pending_verification'`)
        .run({ label, me: me.id, at, id: row.id })
      : db.prepare(`UPDATE submissions SET status = 'rejected', reject_reason = @reason,
                      verifier_id = @me, reviewed_at = @at, deferred_at = NULL
                    WHERE id = @id AND status = 'pending_verification'`)
        .run({ reason: 'Rejected during verification', me: me.id, at, id: row.id });

    if (claim.changes === 0) return false;      // someone else got there first

    if (action === 'approve') {
      db.prepare(`INSERT INTO trail (submission_id, at, kind, title, note) VALUES (?, ?, 'approve', ?, ?)`)
        .run(row.id, at, 'Approved by ' + me.name, `Final label recorded as "${label}"`);
      bumpVariety(row.variety_id, { pending: -1, approved: 1, [label.toLowerCase()]: 1 });
    } else {
      db.prepare(`INSERT INTO trail (submission_id, at, kind, title, note) VALUES (?, ?, 'reject', ?, ?)`)
        .run(row.id, at, 'Rejected by ' + me.name, 'Rejected during verification');
      bumpVariety(row.variety_id, { pending: -1, rejected: 1 });
    }
    return true;
  })();

  if (!applied) return next(httpError(409, 'This submission has already been reviewed.'));

  const fresh = db.prepare(SUBMISSION_SELECT + ' WHERE s.id = @id').get({ id: row.id });
  res.json({ ...shapeSubmission(fresh), trail: loadTrail(row.id) });
});

/* Leaves the item pending and drops it to the back of the queue.
   Stamps deferred_at rather than rewriting uploaded_at: the upload time is
   provenance — it ships in the export manifest and drives the farmer's
   activity chart — so deferring an image must not falsify when it was taken. */
router.post('/:id/skip', requireRole('verifier', 'admin'), (req, res, next) => {
  const row = db.prepare('SELECT id, status FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return next(httpError(404, 'Submission not found.'));
  if (row.status !== 'pending_verification') {
    return next(httpError(409, 'This submission has already been reviewed.'));
  }
  db.prepare('UPDATE submissions SET deferred_at = ? WHERE id = ? AND status = ?')
    .run(Date.now(), row.id, 'pending_verification');
  const fresh = db.prepare(SUBMISSION_SELECT + ' WHERE s.id = @id').get({ id: row.id });
  res.json(shapeSubmission(fresh));
});

/* ---------------------------------------------------- delete
   Removes photos for good: from the farmer's uploads, the queue and every
   export. Admins only. The stored file goes with the row. */
router.delete('/', requireRole('admin'), (req, res, next) => {
  const raw = Array.isArray(req.body.ids) ? req.body.ids : [];
  /* De-duplicate and drop non-strings: the same id twice would decrement a
     variety's counters twice for one photo. Capped so one request cannot
     build a statement with a hundred thousand placeholders. */
  const ids = [...new Set(raw.filter((x) => typeof x === 'string' && x))].slice(0, 500);
  if (!ids.length) return next(httpError(422, 'No photos selected.'));

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, status, final_label, variety_id, image_key
                           FROM submissions WHERE id IN (${placeholders})`).all(...ids);
  if (!rows.length) return next(httpError(404, 'Those photos no longer exist.'));

  writeTxn(() => {
    for (const s of rows) {
      if (s.status === 'pending_verification') bumpVariety(s.variety_id, { pending: -1 });
      else if (s.status === 'rejected') bumpVariety(s.variety_id, { rejected: -1 });
      else {
        const delta = { approved: -1 };
        if (s.final_label) delta[s.final_label.toLowerCase()] = -1;
        bumpVariety(s.variety_id, delta);
      }
    }
    db.prepare(`DELETE FROM submissions WHERE id IN (${placeholders})`).run(...ids);
  })();

  /* Files last: a failed unlink must not roll back a committed delete. */
  for (const s of rows) {
    if (!s.image_key) continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(s.image_key))); }
    catch (e) { /* already gone, or never written */ }
  }

  res.json({ deleted: rows.length });
});

module.exports = router;
