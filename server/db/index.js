/* ============================================================
   The helpers every route shares, on top of db/pool.js.

   Porting notes that matter, because each one is a silent wrong answer
   rather than an error if it is missed:

     * SQLite's MAX(a, b) is a two-argument scalar. Postgres MAX() is an
       aggregate — the counter clamp uses GREATEST() instead.
     * COUNT(*) is bigint. Every count is cast ::int so it arrives as a
       number rather than a string.
     * INSTR() is SQLite-only; the login lookup uses split_part().
     * Booleans are real booleans now, so `active` needs no !! coercion.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, tx, one, exec, kind } = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
  /* Multi-statement DDL goes through exec, not q — a prepared statement
     can only carry one command. */
  await exec(sql);
}

/* ---------------------------------------------------- pagination */

/** Hard ceiling on any page size. The screens ask for at most 999; beyond
    this is either a mistake or an attempt to pull the whole table at once. */
const MAX_LIMIT = 1000;

const cleanPage = (page) => Math.max(1, Math.floor(Number(page)) || 1);
function cleanLimit(limit, fallback) {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_LIMIT);
}

/** The envelope every list route returns — the pagination UI reads it. */
function paginate(rows, total, page, limit) {
  page = cleanPage(page);
  limit = cleanLimit(limit, 10);
  const pages = Math.max(1, Math.ceil(total / limit));
  return { rows, total, page: Math.min(page, pages), pages, limit };
}

/** Runs a SELECT as both a COUNT and one page. */
async function pagedQuery(selectSql, countSql, params, page, limit) {
  page = cleanPage(page);
  limit = cleanLimit(limit, 10);
  const total = (await one(countSql, params)).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const rows = await q(selectSql + ' LIMIT @__limit OFFSET @__offset',
    { ...params, __limit: limit, __offset: (safePage - 1) * limit });
  return { rows, total, page: safePage, pages, limit };
}

/* ---------------------------------------------------- splits */

/** Deterministic train / validation / test assignment, 5 / 1 / 1.
    Must stay identical to API.splitOf() in js/api.js — an image that
    changes split between the UI and an export is a silent data leak. */
const SPLIT_CYCLE = ['train', 'train', 'train', 'train', 'train', 'val', 'test'];
const splitOf = (seq) => SPLIT_CYCLE[Number(seq) % SPLIT_CYCLE.length];

/** The same cycle as SQL, so a split filter narrows the query instead of
    pulling the whole set into memory first. */
const SPLIT_SQL = {
  train: 's.seq % 7 < 5',
  val: 's.seq % 7 = 5',
  test: 's.seq % 7 = 6'
};

/** Next submission id, from a real sequence rather than MAX(seq)+1 — which
    two concurrent Lambdas could read identically. */
const nextSeq = async () => Number((await one("SELECT nextval('submission_seq') AS seq")).seq);

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ---------------------------------------------------- counters */

/** Move one submission between counter buckets on a variety.
    GREATEST, not MAX: in Postgres MAX() is an aggregate function. */
const BUMP_SQL = `
  UPDATE variety_stats SET
    approved = GREATEST(0, approved + @approved),
    pending  = GREATEST(0, pending  + @pending),
    rejected = GREATEST(0, rejected + @rejected),
    good     = GREATEST(0, good     + @good),
    normal   = GREATEST(0, normal   + @normal),
    bad      = GREATEST(0, bad      + @bad)
  WHERE variety_id = @varietyId`;

const bumpArgs = (varietyId, delta) => ({
  varietyId, approved: 0, pending: 0, rejected: 0, good: 0, normal: 0, bad: 0, ...delta
});

/** Outside a transaction. */
const bumpVariety = (varietyId, delta) => q(BUMP_SQL, bumpArgs(varietyId, delta));
/** Inside one — pass the transaction's own q. */
const bumpVarietyTx = (tq, varietyId, delta) => tq(BUMP_SQL, bumpArgs(varietyId, delta));

/* ---------------------------------------------------- errors */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const httpError = (status, message) => new HttpError(status, message);

/* ---------------------------------------------------- submissions */

const SUBMISSION_SELECT = `
  SELECT s.id, s.seq, s.status,
         s.variety_id  AS "varietyId",  v.name  AS "varietyName",
         v.seed_type_id AS "seedTypeId", st.name AS "seedTypeName", st.glyph AS glyph,
         s.company_id  AS "companyId",  c.name  AS "companyName",
         s.farmer_id   AS "farmerId",   f.name  AS "farmerName",
         s.label_by_user AS "labelByUser", s.final_label AS "finalLabel",
         s.verifier_id AS "verifierId", s.reviewed_at AS "reviewedAt",
         s.reject_reason AS "rejectReason", s.adjudicated AS adjudicated,
         s.width, s.height, s.uploaded_at AS "uploadedAt",
         s.deferred_at AS "deferredAt", s.image_key AS "imageKey"
  FROM submissions s
  JOIN varieties  v  ON v.id  = s.variety_id
  JOIN seed_types st ON st.id = v.seed_type_id
  JOIN companies  c  ON c.id  = s.company_id
  JOIN users      f  ON f.id  = s.farmer_id`;

const COUNT_SUBMISSIONS = `
  SELECT COUNT(*)::int AS n
  FROM submissions s
  JOIN varieties  v  ON v.id  = s.variety_id
  JOIN seed_types st ON st.id = v.seed_type_id
  JOIN companies  c  ON c.id  = s.company_id
  JOIN users      f  ON f.id  = s.farmer_id`;

/** Shape one row the way the browser expects. imageKey is the storage key —
    internal, and of no use to a browser that addresses photos by id. */
function shapeSubmission(row) {
  if (!row) return row;
  const { imageKey, ...rest } = row;
  return {
    ...rest,
    seq: Number(row.seq),
    imageUrl: imageKey ? '/api/images/' + encodeURIComponent(row.id) : null
  };
}

module.exports = {
  q, tx, one, exec, kind, migrate,
  paginate, pagedQuery, cleanPage, cleanLimit, MAX_LIMIT,
  splitOf, SPLIT_SQL, nextSeq, startOfToday,
  bumpVariety, bumpVarietyTx,
  httpError, HttpError,
  SUBMISSION_SELECT, COUNT_SUBMISSIONS, shapeSubmission
};
