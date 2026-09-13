/* ============================================================
   SQLite connection + the helpers every route shares.

   Everything is synchronous on purpose: better-sqlite3 is faster
   than the async drivers at this size and removes a whole class of
   ordering bug. When this moves to Postgres, the call sites become
   `await` and the SQL is unchanged.
   ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cafe.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');       // concurrent reads while a write is in flight
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

/* ---------------------------------------------------- helpers */

/** The pagination envelope every list route returns. Matches the
    shape js/api.js used, which the pagination UI reads directly. */
function paginate(rows, total, page, limit) {
  page = Math.max(1, Number(page) || 1);
  limit = Math.max(1, Number(limit) || 10);
  const pages = Math.max(1, Math.ceil(total / limit));
  return { rows, total, page: Math.min(page, pages), pages, limit };
}

/** Runs a `SELECT ... FROM x WHERE ...` as both a COUNT and one page. */
function pagedQuery(selectSql, countSql, params, page, limit) {
  page = Math.max(1, Number(page) || 1);
  limit = Math.max(1, Number(limit) || 10);
  const total = db.prepare(countSql).get(params).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const rows = db.prepare(selectSql + ' LIMIT @__limit OFFSET @__offset')
    .all({ ...params, __limit: limit, __offset: (safePage - 1) * limit });
  return { rows, total, page: safePage, pages, limit };
}

/** Deterministic train / validation / test assignment, 5 / 1 / 1.
    Must stay identical to API.splitOf() in js/api.js — an image that
    changes split between the UI and an export is a silent data leak. */
const SPLIT_CYCLE = ['train', 'train', 'train', 'train', 'train', 'val', 'test'];
const splitOf = (seq) => SPLIT_CYCLE[seq % SPLIT_CYCLE.length];

/** Next submission sequence. MAX+1, never COUNT — deleting a row must
    not hand its split slot to the next upload. */
function nextSeq() {
  return (db.prepare('SELECT COALESCE(MAX(seq), 10000) AS m FROM submissions').get().m) + 1;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Move one submission between counter buckets on a variety.
    Prepared on first use, not at import — migrate() has not necessarily
    created the table by the time this module is required. */
let bumpStmt = null;

function bumpVariety(varietyId, delta) {
  if (!bumpStmt) {
    bumpStmt = db.prepare(`
      UPDATE variety_stats SET
        approved = MAX(0, approved + @approved),
        pending  = MAX(0, pending  + @pending),
        rejected = MAX(0, rejected + @rejected),
        good     = MAX(0, good     + @good),
        normal   = MAX(0, normal   + @normal),
        bad      = MAX(0, bad      + @bad)
      WHERE variety_id = @varietyId`);
  }
  bumpStmt.run({
    varietyId,
    approved: 0, pending: 0, rejected: 0, good: 0, normal: 0, bad: 0,
    ...delta
  });
}

/** An HTTP-shaped error. Routes throw it; the error middleware in
    index.js turns it into { message } with the right status, which is
    what the browser's request() helper reads off err.status. */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const httpError = (status, message) => new HttpError(status, message);

/* Common SELECT for submissions — joins the display names the views
   expect back onto each row. */
const SUBMISSION_SELECT = `
  SELECT s.id, s.seq, s.status,
         s.variety_id  AS varietyId,  v.name  AS varietyName,
         v.seed_type_id AS seedTypeId, st.name AS seedTypeName, st.glyph AS glyph,
         s.company_id  AS companyId,  c.name  AS companyName,
         s.farmer_id   AS farmerId,   f.name  AS farmerName,
         s.label_by_user AS labelByUser, s.final_label AS finalLabel,
         s.verifier_id AS verifierId, s.reviewed_at AS reviewedAt,
         s.reject_reason AS rejectReason, s.adjudicated AS adjudicated,
         s.width, s.height, s.uploaded_at AS uploadedAt, s.image_key AS imageKey
  FROM submissions s
  JOIN varieties  v  ON v.id  = s.variety_id
  JOIN seed_types st ON st.id = v.seed_type_id
  JOIN companies  c  ON c.id  = s.company_id
  JOIN users      f  ON f.id  = s.farmer_id`;

/** Shape one DB row the way the browser expects it. `imageUrl` points at
    the authenticated image route when a file was actually stored;
    js/photos.js falls back to the procedural image when it is null. */
function shapeSubmission(row) {
  if (!row) return row;
  return {
    ...row,
    adjudicated: !!row.adjudicated,
    imageUrl: row.imageKey ? '/api/images/' + encodeURIComponent(row.id) : null
  };
}

module.exports = {
  db, migrate, paginate, pagedQuery, splitOf, nextSeq, startOfToday,
  bumpVariety, httpError, HttpError, SUBMISSION_SELECT, shapeSubmission,
  UPLOAD_DIR, DB_PATH
};
