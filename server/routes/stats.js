/* Dashboard tiles, queue counters, dataset readiness, people.

     GET /api/stats/dashboard
     GET /api/stats/review-queue
     GET /api/stats/dataset-health?seedTypeId=
     GET /api/users?role=&search=
     GET /api/uploaders
*/
'use strict';

const express = require('express');
const { q, one, pagedQuery, startOfToday } = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(requireSession);

const fmt = (n) => (n == null ? 0 : Math.round(n)).toLocaleString('en-US');
const totalsRow = async () => (await one('SELECT * FROM totals WHERE id = 1')) || {};

const countOf = async (sql, params) => (await one(sql, params)).n;

/* ---------------------------------------------------- dashboard */
router.get('/stats/dashboard', async (req, res) => {
  const t = await totalsRow();
  const today = startOfToday();
  res.json({
    totalPhotos: t.total_photos,
    photosWeekDelta: t.photos_week_delta,
    totalSeedTypes: await countOf('SELECT COUNT(*)::int AS n FROM seed_types WHERE active = TRUE'),
    allSeedTypes: await countOf('SELECT COUNT(*)::int AS n FROM seed_types'),
    pendingReview: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'pending_verification'"),
    approvedToday: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'approved' AND reviewed_at >= @t", { t: today }),
    rejectedToday: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'rejected' AND reviewed_at >= @t", { t: today })
  });
});

router.get('/stats/review-queue', async (req, res) => {
  const today = startOfToday();
  res.json({
    pending: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'pending_verification'"),
    approvedToday: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'approved' AND reviewed_at >= @t", { t: today }),
    rejectedToday: await countOf("SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'rejected' AND reviewed_at >= @t", { t: today })
  });
});

/* ---------------------------------------------------- dataset health
   The training-readiness summary. Thresholds are product decisions carried
   over unchanged: 10,000 images, balance ratio <= 4, 80% label agreement,
   every variety past 60% of target. */
router.get('/stats/dataset-health', async (req, res) => {
  const seedTypeId = req.query.seedTypeId || null;

  /* Class counts: warehouse totals dataset-wide, per-variety counters when
     the screen is scoped to one crop. */
  let counts;
  if (!seedTypeId) {
    const t = await totalsRow();
    counts = { good: t.good || 0, normal: t.normal || 0, bad: t.bad || 0 };
  } else {
    counts = await one(`
      SELECT COALESCE(SUM(vs.good), 0)::int   AS good,
             COALESCE(SUM(vs.normal), 0)::int AS normal,
             COALESCE(SUM(vs.bad), 0)::int    AS bad
      FROM varieties v JOIN variety_stats vs ON vs.variety_id = v.id
      WHERE v.seed_type_id = @st`, { st: seedTypeId });
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
  const agree = await one(`
    SELECT COUNT(*)::int AS total,
           COALESCE(SUM(CASE WHEN s.final_label = s.label_by_user THEN 1 ELSE 0 END), 0)::int AS matched
    FROM submissions s JOIN varieties v ON v.id = s.variety_id
    WHERE s.final_label IS NOT NULL ${seedTypeId ? 'AND v.seed_type_id = @st' : ''}`,
    seedTypeId ? { st: seedTypeId } : {});
  const reviewedTotal = agree.total || 0;
  const matched = agree.matched || 0;

  /* Variety coverage, from the same derived progress the tables show. */
  const vs = await q(`
    SELECT COALESCE(vs.approved, 0) AS approved, v.target, COALESCE(vs.pending, 0) AS pending
    FROM varieties v LEFT JOIN variety_stats vs ON vs.variety_id = v.id
    WHERE v.active = TRUE ${seedTypeId ? 'AND v.seed_type_id = @st' : ''}`,
    seedTypeId ? { st: seedTypeId } : {});

  const progressOf = (v) => (v.target ? Math.round(v.approved / v.target * 100) : 0);
  const atTarget = vs.filter((v) => progressOf(v) >= 100).length;
  const thin = vs.filter((v) => progressOf(v) < 60).length;

  const totals = await totalsRow();
  const pending = seedTypeId
    ? vs.reduce((n, v) => n + v.pending, 0)
    : (totals.pending || 0);

  const discarded = seedTypeId
    ? (await one(`SELECT COALESCE(SUM(vs.rejected), 0)::int AS n FROM varieties v
                  JOIN variety_stats vs ON vs.variety_id = v.id WHERE v.seed_type_id = @st`,
      { st: seedTypeId })).n
    : (totals.rejected || 0);

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
router.get('/users', async (req, res) => {
  const w = [], p = {};
  if (req.query.role) { w.push('u.role = @role'); p.role = req.query.role; }
  if (req.query.search) {
    w.push("(LOWER(u.name) LIKE @q OR LOWER(COALESCE(u.email, '')) LIKE @q)");
    p.q = '%' + String(req.query.search).trim().toLowerCase() + '%';
  }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';

  res.json(await pagedQuery(`
    SELECT u.id, u.name, u.role, u.email, u.region,
           (SELECT COUNT(*)::int FROM submissions s WHERE s.verifier_id = u.id) AS reviewed,
           (SELECT COUNT(*)::int FROM submissions s WHERE s.farmer_id  = u.id) AS uploaded
    FROM users u${where}
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'verifier' THEN 1 ELSE 2 END, u.name`,
    'SELECT COUNT(*)::int AS n FROM users u' + where,
    p, req.query.page, req.query.limit || 8
  ));
});

/** Uploaders that actually appear in the queue — powers the User filter. */
router.get('/uploaders', async (req, res) => {
  res.json(await q(`
    SELECT u.id, u.name, u.role, u.region
    FROM users u
    WHERE u.role = 'farmer' AND EXISTS (SELECT 1 FROM submissions s WHERE s.farmer_id = u.id)
    ORDER BY u.name`));
});

module.exports = router;
