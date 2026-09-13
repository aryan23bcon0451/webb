/* GET /api/export/manifest?split=&label=&seedTypeId=&varietyId=&companyId=
   One row per labelled image, in the shape a training script reads. */
'use strict';

const express = require('express');
const { q, splitOf, SPLIT_SQL, httpError } = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(requireSession);

router.get('/manifest', async (req, res) => {
  const query = req.query;
  const w = ["s.status = 'approved'", 's.final_label IS NOT NULL'], p = {};
  if (query.seedTypeId) { w.push('v.seed_type_id = @st'); p.st = query.seedTypeId; }
  if (query.varietyId) { w.push('s.variety_id = @vid'); p.vid = query.varietyId; }
  if (query.companyId) { w.push('s.company_id = @cid'); p.cid = query.companyId; }
  if (query.label) { w.push('s.final_label = @label'); p.label = query.label; }
  if (query.split) {
    if (!SPLIT_SQL[query.split]) throw httpError(422, 'Unknown split.');
    w.push(SPLIT_SQL[query.split]);
  }

  const rows = await q(`
    SELECT s.id, s.seq, s.final_label AS "finalLabel", s.width, s.height,
           s.uploaded_at AS "uploadedAt", s.reviewed_at AS "reviewedAt",
           s.label_by_user AS "labelByUser", s.image_key AS "imageKey",
           st.name AS "seedTypeName", v.name AS "varietyName", c.name AS "companyName",
           f.name AS "farmerName", r.name AS "verifierName"
    FROM submissions s
    JOIN varieties v ON v.id = s.variety_id
    JOIN seed_types st ON st.id = v.seed_type_id
    JOIN companies c ON c.id = s.company_id
    JOIN users f ON f.id = s.farmer_id
    LEFT JOIN users r ON r.id = s.verifier_id
    WHERE ${w.join(' AND ')}
    ORDER BY s.id ASC`, p);

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
      uploaded_at: new Date(Number(s.uploadedAt)).toISOString(),
      labelled_by: s.verifierName || '',
      labelled_at: s.reviewedAt ? new Date(Number(s.reviewedAt)).toISOString() : '',
      uploader_label: (s.labelByUser || '').toLowerCase()
    })),
    total: rows.length,
    generatedAt: Date.now()
  });
});

module.exports = router;
