/* ============================================================
   One-time seed: js/data.js  ->  Postgres

   data.js already generates a coherent world (the counts the spec quotes,
   a reviewed corpus with audit trails, farmers whose figures roll up
   correctly). Rather than hand-write fixtures, we execute it with a fake
   `window` and insert what it produced.

     npm run seed            # refuses if the database already has rows
     npm run seed -- --force # wipes and re-seeds

   Runs against whatever db/pool.js resolves to: RDS when DATABASE_URL is
   set, the local PGlite database otherwise.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const DEV_PASSWORD = process.env.SEED_PASSWORD || 'cafe1234';
const BATCH = 500;

function loadDB() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
  const fakeWindow = {};
  /* data.js is an IIFE ending in `})(window)` — hand it an object to hang
     DB off instead of the browser global. */
  new Function('window', src)(fakeWindow);
  if (!fakeWindow.DB) throw new Error('js/data.js did not produce a DB global.');
  return fakeWindow.DB;
}

/** Builds a multi-row INSERT: one round trip per batch instead of per row,
    which over a network connection to RDS is the difference between a few
    seconds and several minutes. */
function bulkInsert(tq, table, columns, rows) {
  if (!rows.length) return Promise.resolve();
  const values = [];
  const tuples = rows.map((row) => '(' + columns.map((c) => {
    values.push(row[c]);
    return '$' + values.length;
  }).join(', ') + ')');
  const sql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`;
  return tq(sql, values);
}

async function batched(tq, table, columns, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await bulkInsert(tq, table, columns, rows.slice(i, i + BATCH));
  }
}

(async () => {
  await db.migrate();

  const force = process.argv.includes('--force');
  const existing = (await db.one('SELECT COUNT(*)::int AS n FROM submissions')).n;
  if (existing && !force) {
    console.error(`The database already holds ${existing} submissions. Re-run with --force to wipe and re-seed.`);
    process.exit(1);
  }

  const DATA = loadDB();
  const hash = bcrypt.hashSync(DEV_PASSWORD, 10);
  const now = DATA.now;

  await db.tx(async (tq) => {
    if (force) {
      /* TRUNCATE ... CASCADE clears the dependent tables in one statement,
         which DELETE in dependency order would not do as cleanly. */
      await tq('TRUNCATE trail, submissions, variety_stats, varieties, seed_types, companies, users, totals CASCADE');
    }

    /* -------- people. Staff and farmers are one table, split by role. */
    const users = DATA.users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      region: u.region, password_hash: hash, created_at: now
    })).concat(DATA.farmers.map((f) => ({
      /* Farmers sign in on the capture app, not here; they still need a row
         so submissions.farmer_id has something to point at. */
      id: f.id, name: f.name,
      email: f.name.toLowerCase().replace(/[^a-z]+/g, '.') + '@farm.cafe.ag',
      role: 'farmer', region: f.region, password_hash: hash, created_at: now
    })));
    await batched(tq, 'users',
      ['id', 'name', 'email', 'role', 'region', 'password_hash', 'created_at'], users);

    /* -------- reference data */
    await batched(tq, 'seed_types', ['id', 'name', 'glyph', 'category', 'active', 'created_at'],
      DATA.seedTypes.map((s) => ({ ...s, active: !!s.active, created_at: s.createdAt })));

    await batched(tq, 'varieties', ['id', 'name', 'seed_type_id', 'target', 'active', 'created_at'],
      DATA.varieties.map((v) => ({
        id: v.id, name: v.name, seed_type_id: v.seedTypeId,
        target: v.target, active: !!v.active, created_at: v.createdAt
      })));

    /* The warehouse-scale counters. Live submissions adjust these as they
       are reviewed; see bumpVariety() in db/index.js. */
    await batched(tq, 'variety_stats',
      ['variety_id', 'approved', 'pending', 'rejected', 'good', 'normal', 'bad'],
      DATA.varieties.map((v) => ({
        variety_id: v.id, approved: v.approved, pending: v.pending, rejected: v.rejected,
        good: v.labels.good, normal: v.labels.normal, bad: v.labels.bad
      })));

    await batched(tq, 'companies', ['id', 'name', 'location', 'active', 'created_at'],
      DATA.companies.map((c) => ({ ...c, active: !!c.active, created_at: c.createdAt })));

    /* -------- submissions + audit trail */
    await batched(tq, 'submissions',
      ['id', 'seq', 'status', 'variety_id', 'company_id', 'farmer_id', 'label_by_user',
        'final_label', 'verifier_id', 'reviewed_at', 'reject_reason', 'adjudicated',
        'width', 'height', 'uploaded_at', 'image_key'],
      DATA.submissions.map((s) => ({
        id: s.id, seq: s.seq, status: s.status,
        variety_id: s.varietyId, company_id: s.companyId, farmer_id: s.farmerId,
        label_by_user: s.labelByUser, final_label: s.finalLabel,
        verifier_id: s.verifierId, reviewed_at: s.reviewedAt,
        reject_reason: s.rejectReason, adjudicated: !!s.adjudicated,
        width: s.width, height: s.height, uploaded_at: s.uploadedAt, image_key: null
      })));

    const trail = [];
    for (const s of DATA.submissions) {
      for (const t of s.trail) {
        trail.push({ submission_id: s.id, at: t.at, kind: t.kind, title: t.title, note: t.note });
      }
    }
    await batched(tq, 'trail', ['submission_id', 'at', 'kind', 'title', 'note'], trail);

    /* The sequence must continue past the seeded ids, or the next upload
       collides on submissions.seq. */
    const maxSeq = DATA.submissions.reduce((m, s) => Math.max(m, s.seq), 10000);
    await tq(`SELECT setval('submission_seq', ${maxSeq + 1}, false)`);

    /* -------- warehouse aggregates */
    const t = DATA.totals;
    await tq(`INSERT INTO totals (id, total_images, approved, pending, rejected, week_delta,
                                  good, normal, bad, total_photos, photos_week_delta)
              VALUES (1, @totalImages, @approved, @pending, @rejected, @weekDelta,
                      @good, @normal, @bad, @totalPhotos, @photosWeekDelta)`, {
      totalImages: t.totalImages, approved: t.approved, pending: t.pending,
      rejected: t.rejected, weekDelta: t.weekDelta,
      good: t.labels.good, normal: t.labels.normal, bad: t.labels.bad,
      totalPhotos: t.dashboard.totalPhotos, photosWeekDelta: t.dashboard.photosWeekDelta
    });
  });

  const count = async (table) => (await db.one(`SELECT COUNT(*)::int AS n FROM ${table}`)).n;
  console.log(`Seeded ${db.kind()}${process.env.DATABASE_URL ? ' (DATABASE_URL)' : ' (local pgdata/)'}`);
  console.log(`  users        ${await count('users')}   (${DATA.users.length} staff, ${DATA.farmers.length} farmers)`);
  console.log(`  seed_types   ${await count('seed_types')}`);
  console.log(`  varieties    ${await count('varieties')}`);
  console.log(`  companies    ${await count('companies')}`);
  console.log(`  submissions  ${await count('submissions')}`);
  console.log(`  trail        ${await count('trail')}`);
  console.log(`  next seq     ${(await db.one("SELECT last_value FROM submission_seq")).last_value}`);
  console.log(`\nSign in as ${DATA.users[0].email} (admin) or ${DATA.users[1].email} (labeller).`);
  console.log(`Password for every seeded account: ${DEV_PASSWORD}`);
  process.exit(0);
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
