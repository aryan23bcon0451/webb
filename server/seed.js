/* ============================================================
   One-time seed: js/data.js  ->  cafe.db

   data.js already generates a coherent world (the counts the spec
   quotes, a reviewed corpus with audit trails, farmers whose figures
   roll up correctly). Rather than hand-write fixtures, we execute it
   with a fake `window` and insert what it produced.

     node seed.js          # refuses if cafe.db already has rows
     node seed.js --force  # wipes and re-seeds
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, migrate } = require('./db');

const DEV_PASSWORD = process.env.SEED_PASSWORD || 'cafe1234';

/* ---------------------------------------------------- load data.js */
function loadDB() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
  const fakeWindow = {};
  /* data.js is an IIFE ending in `})(window)` — hand it an object to
     hang DB off instead of the browser global. */
  new Function('window', src)(fakeWindow);
  if (!fakeWindow.DB) throw new Error('js/data.js did not produce a DB global.');
  return fakeWindow.DB;
}

/* ---------------------------------------------------- run */
migrate();

const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
if (existing && !force) {
  console.error(`cafe.db already holds ${existing} submissions. Re-run with --force to wipe and re-seed.`);
  process.exit(1);
}

const DATA = loadDB();
const hash = bcrypt.hashSync(DEV_PASSWORD, 10);

const insert = db.transaction(() => {
  if (force) {
    /* Children first — foreign keys are on. */
    for (const t of ['trail', 'submissions', 'variety_stats', 'varieties', 'seed_types', 'companies', 'users', 'totals']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  }

  const now = DATA.now;

  /* -------- people. Staff and farmers are one table, split by role. */
  const addUser = db.prepare(`INSERT INTO users (id, name, email, role, region, password_hash, created_at)
                              VALUES (@id, @name, @email, @role, @region, @hash, @createdAt)`);
  for (const u of DATA.users) {
    addUser.run({ id: u.id, name: u.name, email: u.email, role: u.role, region: u.region, hash, createdAt: now });
  }
  for (const f of DATA.farmers) {
    /* Farmers sign in on the capture app, not here; they still need a row
       so submissions.farmer_id has something to point at. */
    addUser.run({
      id: f.id, name: f.name,
      email: f.name.toLowerCase().replace(/[^a-z]+/g, '.') + '@farm.cafe.ag',
      role: 'farmer', region: f.region, hash, createdAt: now
    });
  }

  /* -------- reference data */
  const addSeedType = db.prepare(`INSERT INTO seed_types (id, name, glyph, category, active, created_at)
                                  VALUES (@id, @name, @glyph, @category, @active, @createdAt)`);
  for (const s of DATA.seedTypes) {
    addSeedType.run({ ...s, active: s.active ? 1 : 0 });
  }

  const addVariety = db.prepare(`INSERT INTO varieties (id, name, seed_type_id, target, active, created_at)
                                 VALUES (@id, @name, @seedTypeId, @target, @active, @createdAt)`);
  const addStats = db.prepare(`INSERT INTO variety_stats (variety_id, approved, pending, rejected, good, normal, bad)
                               VALUES (@id, @approved, @pending, @rejected, @good, @normal, @bad)`);
  for (const v of DATA.varieties) {
    addVariety.run({
      id: v.id, name: v.name, seedTypeId: v.seedTypeId,
      target: v.target, active: v.active ? 1 : 0, createdAt: v.createdAt
    });
    /* The warehouse-scale counters. Live submissions adjust these as they
       are reviewed; see bumpVariety() in db.js. */
    addStats.run({
      id: v.id, approved: v.approved, pending: v.pending, rejected: v.rejected,
      good: v.labels.good, normal: v.labels.normal, bad: v.labels.bad
    });
  }

  const addCompany = db.prepare(`INSERT INTO companies (id, name, location, active, created_at)
                                 VALUES (@id, @name, @location, @active, @createdAt)`);
  for (const c of DATA.companies) {
    addCompany.run({ ...c, active: c.active ? 1 : 0 });
  }

  /* -------- submissions + audit trail */
  const addSub = db.prepare(`
    INSERT INTO submissions (id, seq, status, variety_id, company_id, farmer_id,
                             label_by_user, final_label, verifier_id, reviewed_at,
                             reject_reason, adjudicated, width, height, uploaded_at, image_key)
    VALUES (@id, @seq, @status, @varietyId, @companyId, @farmerId,
            @labelByUser, @finalLabel, @verifierId, @reviewedAt,
            @rejectReason, @adjudicated, @width, @height, @uploadedAt, NULL)`);
  const addTrail = db.prepare(`INSERT INTO trail (submission_id, at, kind, title, note)
                               VALUES (@sid, @at, @kind, @title, @note)`);

  for (const s of DATA.submissions) {
    addSub.run({
      id: s.id, seq: s.seq, status: s.status,
      varietyId: s.varietyId, companyId: s.companyId, farmerId: s.farmerId,
      labelByUser: s.labelByUser, finalLabel: s.finalLabel,
      verifierId: s.verifierId, reviewedAt: s.reviewedAt,
      rejectReason: s.rejectReason, adjudicated: s.adjudicated ? 1 : 0,
      width: s.width, height: s.height, uploadedAt: s.uploadedAt
    });
    for (const t of s.trail) {
      addTrail.run({ sid: s.id, at: t.at, kind: t.kind, title: t.title, note: t.note });
    }
  }

  /* -------- warehouse aggregates */
  const t = DATA.totals;
  db.prepare(`INSERT INTO totals (id, total_images, approved, pending, rejected, week_delta,
                                  good, normal, bad, total_photos, photos_week_delta)
              VALUES (1, @totalImages, @approved, @pending, @rejected, @weekDelta,
                      @good, @normal, @bad, @totalPhotos, @photosWeekDelta)`).run({
    totalImages: t.totalImages, approved: t.approved, pending: t.pending,
    rejected: t.rejected, weekDelta: t.weekDelta,
    good: t.labels.good, normal: t.labels.normal, bad: t.labels.bad,
    totalPhotos: t.dashboard.totalPhotos, photosWeekDelta: t.dashboard.photosWeekDelta
  });
});

insert();

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log('Seeded cafe.db');
console.log(`  users        ${count('users')}   (${DATA.users.length} staff, ${DATA.farmers.length} farmers)`);
console.log(`  seed_types   ${count('seed_types')}`);
console.log(`  varieties    ${count('varieties')}`);
console.log(`  companies    ${count('companies')}`);
console.log(`  submissions  ${count('submissions')}`);
console.log(`  trail        ${count('trail')}`);
console.log(`\nSign in as ${DATA.users[0].email} (admin) or ${DATA.users[1].email} (labeller).`);
console.log(`Password for every seeded account: ${DEV_PASSWORD}`);
