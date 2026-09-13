/* ============================================================
   CAFE seed image dataset — Postgres schema.

   Ported from the SQLite version. What changed and why:
     * INTEGER 0/1 flags  -> BOOLEAN (Postgres has a real one)
     * timestamps stay BIGINT epoch-ms, so the JSON the browser already
       parses is unchanged; node-postgres is told to read int8 as a number
     * AUTOINCREMENT      -> GENERATED ALWAYS AS IDENTITY
     * seq gets its own sequence, so concurrent Lambdas cannot collide on
       MAX(seq)+1 the way two processes could against SQLite
   ============================================================ */

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'verifier', 'farmer')),
  region        TEXT,
  password_hash TEXT,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);

CREATE TABLE IF NOT EXISTS seed_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  glyph      TEXT,
  category   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS varieties (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  seed_type_id TEXT NOT NULL REFERENCES seed_types(id),
  target       INTEGER NOT NULL DEFAULT 150000,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   BIGINT NOT NULL,
  UNIQUE (seed_type_id, name)
);
CREATE INDEX IF NOT EXISTS ix_var_seed_type ON varieties(seed_type_id);

CREATE TABLE IF NOT EXISTS companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  location   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

/* Denormalised counters. The dashboard reports warehouse-scale figures that
   no sample table holds as rows, so the counts live here and every write
   that changes a submission's status updates them in the same transaction. */
CREATE TABLE IF NOT EXISTS variety_stats (
  variety_id TEXT PRIMARY KEY REFERENCES varieties(id) ON DELETE CASCADE,
  approved   INTEGER NOT NULL DEFAULT 0,
  pending    INTEGER NOT NULL DEFAULT 0,
  rejected   INTEGER NOT NULL DEFAULT 0,
  good       INTEGER NOT NULL DEFAULT 0,
  normal     INTEGER NOT NULL DEFAULT 0,
  bad        INTEGER NOT NULL DEFAULT 0
);

/* Drives splitOf(seq): an image keeps its train/val/test slot forever, so
   this must never be recycled. A sequence guarantees that under any number
   of concurrent Lambda invocations — MAX(seq)+1 would not. */
CREATE SEQUENCE IF NOT EXISTS submission_seq START WITH 10001;

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  seq           BIGINT NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('pending_verification', 'approved', 'rejected')),
  variety_id    TEXT NOT NULL REFERENCES varieties(id),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  farmer_id     TEXT NOT NULL REFERENCES users(id),
  label_by_user TEXT,
  final_label   TEXT CHECK (final_label IN ('Good', 'Normal', 'Bad') OR final_label IS NULL),
  verifier_id   TEXT REFERENCES users(id),
  reviewed_at   BIGINT,
  reject_reason TEXT,
  adjudicated   BOOLEAN NOT NULL DEFAULT FALSE,
  width         INTEGER,
  height        INTEGER,
  /* When the photo was taken. Never rewritten — it is provenance and it
     ships in the export manifest. */
  uploaded_at   BIGINT NOT NULL,
  /* Set when a labeller defers an image. The queue orders by
     COALESCE(deferred_at, uploaded_at) so deferring moves an image to the
     back without falsifying when it was taken. */
  deferred_at   BIGINT,
  /* S3 object key (or a local filename in dev). NULL means no stored file
     and the browser falls back to the procedural image in js/photos.js. */
  image_key     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sub_status  ON submissions(status, uploaded_at);
CREATE INDEX IF NOT EXISTS ix_sub_queue   ON submissions(status, deferred_at, uploaded_at);
CREATE INDEX IF NOT EXISTS ix_sub_farmer  ON submissions(farmer_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS ix_sub_variety ON submissions(variety_id, status);
CREATE INDEX IF NOT EXISTS ix_sub_review  ON submissions(reviewed_at);
CREATE INDEX IF NOT EXISTS ix_sub_final   ON submissions(final_label);

CREATE TABLE IF NOT EXISTS trail (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  at            BIGINT NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS ix_trail_sub ON trail(submission_id, at);

/* Single-row table for the warehouse aggregates the Home screen quotes. */
CREATE TABLE IF NOT EXISTS totals (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  total_images   BIGINT, approved BIGINT, pending BIGINT, rejected BIGINT,
  week_delta     BIGINT,
  good           BIGINT, normal BIGINT, bad BIGINT,
  total_photos   BIGINT, photos_week_delta BIGINT
);
