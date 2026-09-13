/* GET /api/export/manifest?split=&label=&seedTypeId=&varietyId=&companyId=
   One row per labelled image, in the shape a training script reads. */
'use strict';

const express = require('express');
const { db, splitOf, httpError } = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(requireSession);

/* splitOf() as SQL, so a split filter narrows the query instead of pulling
   the whole set into memory first. Must stay in step with SPLIT_CYCLE. */
const SPLIT_SQL = {
  train: 's.seq % 7 < 5',
  val: 's.seq % 7 = 5',
  test: 's.seq % 7 = 6'
};

router.get('/manifest', (req, res, next) => {
  const q = req.query;
  const w = ["s.status = 'approved'", 's.final_label IS NOT NULL'], p = {};
  if (q.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = q.seedTypeId; }
  if (q.varietyId) { w.push('s.variety_id = @vid'); p.vid = q.varietyId; }
  if (q.companyId) { w.push('s.company_id = @cid'); p.cid = q.companyId; }
  if (q.label) { w.push('s.final_label = @label'); p.label = q.label; }
  if (q.split) {
    if (!SPLIT_SQL[q.split]) return next(httpError(422, 'Unknown split.'));
    w.push(SPLIT_SQL[q.split]);
  }

  const rows = db.prepare(`
    SELECT s.id, s.seq, s.final_label AS finalLabel, s.width, s.height,
           s.uploaded_at AS uploadedAt, s.reviewed_at AS reviewedAt,
           s.label_by_user AS labelByUser, s.image_key AS imageKey,
           st.name AS seedTypeName, v.name AS varietyName, c.name AS companyName,
           f.name AS farmerName, r.name AS verifierName
    FROM submissions s
    JOIN varieties v ON v.id = s.variety_id
    JOIN seed_types st ON st.id = v.seed_type_id
    JOIN companies c ON c.id = s.company_id
    JOIN users f ON f.id = s.farmer_id
    LEFT JOIN users r ON r.id = s.verifier_id
    WHERE ${w.join(' AND ')}
    ORDER BY s.id ASC`).all(p);

  res.json({
    rows: rows.map((s) => ({
      image_id: s.id,
      file_name: 'images/' + (s.imageKey || s.id + '.jpg'),
      label: s.finalLabel.toLowerCase(),
      split: splitOf(s.seq),
      seed_type: s.seedTypeName,
      variety: s.varietyName,
      company: s.companyName,
      width: s.width,
      height: s.height,
      uploaded_by: s.farmerName,
      uploaded_at: new Date(s.uploadedAt).toISOString(),
      labelled_by: s.verifierName || '',
      labelled_at: s.reviewedAt ? new Date(s.reviewedAt).toISOString() : '',
      uploader_label: (s.labelByUser || '').toLowerCase()
    })),
    total: rows.length,
    generatedAt: Date.now()
  });
});

module.exports = router;
