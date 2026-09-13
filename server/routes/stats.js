/* Dashboard tiles, queue counters, dataset readiness, people.

     GET /api/stats/dashboard
     GET /api/stats/review-queue
     GET /api/stats/dataset-health?seedTypeId=
     GET /api/users?role=&search=
     GET /api/uploaders
*/
'use strict';

const express = require('express');
const { db, pagedQuery, startOfToday } = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(requireSession);

const fmt = (n) => (n == null ? 0 : Math.round(n)).toLocaleString('en-US');
const totalsRow = () => db.prepare('SELECT * FROM totals WHERE id = 1').get() || {};

/* ---------------------------------------------------- dashboard */
router.get('/stats/dashboard', (req, res) => {
  const t = totalsRow();
  const today = startOfToday();
  res.json({
    totalPhotos: t.total_photos,
    photosWeekDelta: t.photos_week_delta,
    totalSeedTypes: db.prepare('SELECT COUNT(*) AS n FROM seed_types WHERE active = 1').get().n,
    allSeedTypes: db.prepare('SELECT COUNT(*) AS n FROM seed_types').get().n,
    pendingReview: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending_verification'").get().n,
    approvedToday: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'approved' AND reviewed_at >= ?").get(today).n,
    rejectedToday: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'rejected' AND reviewed_at >= ?").get(today).n
  });
});

router.get('/stats/review-queue', (req, res) => {
  const today = startOfToday();
  res.json({
    pending: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending_verification'").get().n,
    approvedToday: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'approved' AND reviewed_at >= ?").get(today).n,
    rejectedToday: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'rejected' AND reviewed_at >= ?").get(today).n
  });
});

/* ---------------------------------------------------- dataset health
   The training-readiness summary. Thresholds are product decisions carried
   over unchanged from the mock: 10,000 images, balance ratio <= 4,
   80% label agreement, every variety past 60% of target. */
router.get('/stats/dataset-health', (req, res) => {
  const seedTypeId = req.query.seedTypeId || null;

  /* Class counts: warehouse totals dataset-wide, per-variety counters when
     the screen is scoped to one crop. */
  let counts;
  if (!seedTypeId) {
    const t = totalsRow();
    counts = { good: t.good || 0, normal: t.normal || 0, bad: t.bad || 0 };
  } else {
    counts = db.prepare(`
      SELECT COALESCE(SUM(vs.good), 0) AS good,
             COALESCE(SUM(vs.normal), 0) AS normal,
             COALESCE(SUM(vs.bad), 0) AS bad
      FROM varieties v JOIN variety_stats vs ON vs.variety_id = v.id
      WHERE v.seed_type_id = ?`).get(seedTypeId);
  }
  const labelled = counts.good + counts.normal + counts.bad;

  const classes = [
    { key: 'good', label: 'Good', count: counts.good, color: 'var(--green)' },
    { key: 'normal', label: 'Normal', count: counts.normal, color: 'var(--amber)' },
    { key: 'bad', label: 'Bad', count: counts.bad, color: 'var(--red)' }
  ].map((c) => ({ ...c, pct: labelled ? c.count / labelled * 100 : 0 }));

  const sorted = classes.slice().sort((a, b) => a.count - b.count);
  const smallest = sorted[0], largest = sorted[sorted.length - 1];
  const ratio = smallest.count ? largest.count / smallest.count : 0;

  /* Label agreement is measured on the reviewed rows we actually hold, not
     on the warehouse totals — a low figure means the capture instructions
     are being read two ways. */
  const agreeWhere = seedTypeId ? 'AND v.seed_type_id = @st' : '';
  const agree = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN s.final_label = s.label_by_user THEN 1 ELSE 0 END) AS matched
    FROM submissions s JOIN varieties v ON v.id = s.variety_id
    WHERE s.final_label IS NOT NULL ${agreeWhere}`).get(seedTypeId ? { st: seedTypeId } : {});
  const reviewedTotal = agree.total || 0;
  const matched = agree.matched || 0;

  /* Variety coverage, from the same derived progress the tables show. */
  const varietyWhere = seedTypeId ? 'AND v.seed_type_id = @st' : '';
  const vs = db.prepare(`
    SELECT COALESCE(vs.approved, 0) AS approved, v.target, COALESCE(vs.pending, 0) AS pending
    FROM varieties v LEFT JOIN variety_stats vs ON vs.variety_id = v.id
    WHERE v.active = 1 ${varietyWhere}`).all(seedTypeId ? { st: seedTypeId } : {});

  const progressOf = (v) => (v.target ? Math.round(v.approved / v.target * 100) : 0);
  const atTarget = vs.filter((v) => progressOf(v) >= 100).length;
  const thin = vs.filter((v) => progressOf(v) < 60).length;

  const pending = seedTypeId
    ? vs.reduce((n, v) => n + v.pending, 0)
    : (totalsRow().pending || 0);

  const discarded = seedTypeId
    ? db.prepare(`SELECT COALESCE(SUM(vs.rejected), 0) AS n FROM varieties v
                  JOIN variety_stats vs ON vs.variety_id = v.id WHERE v.seed_type_id = ?`).get(seedTypeId).n
    : (totalsRow().rejected || 0);

  /* Split sizes follow the same 5 / 1 / 1 cycle the export manifest uses. */
  const splits = {
    train: Math.round(labelled * 5 / 7),
    val: Math.round(labelled * 1 / 7),
    test: labelled - Math.round(labelled * 5 / 7) - Math.round(labelled * 1 / 7)
  };

  const checks = [
    {
      ok: labelled >= 10000,
      title: 'Enough labelled images',
      detail: fmt(labelled) + ' labelled. A first model wants at least 10,000.'
    },
    {
      ok: ratio > 0 && ratio <= 4,
      title: 'Classes are balanced',
      detail: ratio
        ? `"${largest.label}" has ${ratio.toFixed(1)}× more images than "${smallest.label}".` +
          (ratio > 4 ? ` Collect more "${smallest.label}" or weight the loss.` : '')
        : 'One class has no images yet.'
    },
    {
      ok: reviewedTotal ? matched / reviewedTotal >= 0.8 : false,
      title: 'Labels agree',
      detail: reviewedTotal
        ? Math.round(matched / reviewedTotal * 100) + '% of uploads kept the label the uploader gave them.'
        : 'Nothing reviewed yet.'
    },
    {
      ok: thin === 0,
      title: 'Every variety is covered',
      detail: thin
        ? `${thin} ${thin === 1 ? 'variety is' : 'varieties are'} under 60% of target — the model will be weak on ${thin === 1 ? 'it' : 'them'}.`
        : `All ${vs.length} varieties are past 60% of target.`
    },
    {
      ok: pending < labelled * 0.15,
      title: 'The queue is under control',
      detail: fmt(pending) + ' images are still waiting to be labelled.'
    }
  ];

  res.json({
    labelled, pending, discarded, classes, smallest, largest,
    balanceRatio: ratio,
    agreement: { matched, total: reviewedTotal, pct: reviewedTotal ? matched / reviewedTotal * 100 : 0 },
    varieties: { total: vs.length, atTarget, thin },
    splits, checks,
    passing: checks.filter((c) => c.ok).length
  });
});

/* ---------------------------------------------------- people */
router.get('/users', (req, res) => {
  const w = [], p = {};
  if (req.query.role) { w.push('u.role = @role'); p.role = req.query.role; }
  if (req.query.search) {
    w.push('(LOWER(u.name) LIKE @q OR LOWER(COALESCE(u.email, \'\')) LIKE @q)');
    p.q = '%' + String(req.query.search).trim().toLowerCase() + '%';
  }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  const page = pagedQuery(`
    SELECT u.id, u.name, u.role, u.email, u.region,
           (SELECT COUNT(*) FROM submissions s WHERE s.verifier_id = u.id) AS reviewed,
           (SELECT COUNT(*) FROM submissions s WHERE s.farmer_id  = u.id) AS uploaded
    FROM users u${where}
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'verifier' THEN 1 ELSE 2 END, u.name`,
    'SELECT COUNT(*) AS n FROM users u' + where,
    p, req.query.page, req.query.limit || 8
  );
  res.json(page);
});

/** Uploaders that actually appear in the queue — powers the User filter. */
router.get('/uploaders', (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, u.role, u.region
    FROM users u
    WHERE u.role = 'farmer' AND EXISTS (SELECT 1 FROM submissions s WHERE s.farmer_id = u.id)
    ORDER BY u.name`).all());
});

module.exports = router;
