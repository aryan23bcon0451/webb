/* ============================================================
   CAFE seed image dataset — relational schema.

   Shapes follow what js/api.js already returns, so the JSON the
   browser receives is unchanged. Display names (varietyName,
   seedTypeName, glyph, farmerName, companyName) are NOT stored
   on submissions — they are joined back in the route.
   ============================================================ */

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'verifier', 'farmer')),
  region        TEXT,
  password_hash TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);

CREATE TABLE IF NOT EXISTS seed_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  glyph      TEXT,
  category   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS varieties (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  seed_type_id TEXT NOT NULL REFERENCES seed_types(id),
  target       INTEGER NOT NULL DEFAULT 150000,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  UNIQUE (seed_type_id, name)
);
CREATE INDEX IF NOT EXISTS ix_var_seed_type ON varieties(seed_type_id);

CREATE TABLE IF NOT EXISTS companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  location   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

/* Denormalised counters. The dashboard reports warehouse-scale figures
   (millions of images) that no sample table holds as rows, so the counts
   live here and every write that changes a submission's status updates
   them in the same transaction. See bumpVariety() in db.js. */
CREATE TABLE IF NOT EXISTS variety_stats (
  variety_id TEXT PRIMARY KEY REFERENCES varieties(id) ON DELETE CASCADE,
  approved   INTEGER NOT NULL DEFAULT 0,
  pending    INTEGER NOT NULL DEFAULT 0,
  rejected   INTEGER NOT NULL DEFAULT 0,
  good       INTEGER NOT NULL DEFAULT 0,
  normal     INTEGER NOT NULL DEFAULT 0,
  bad        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  /* Drives splitOf(seq) — an image keeps its train/val/test slot forever,
     so this is a monotonic sequence, never a row count. */
  seq           INTEGER NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('pending_verification', 'approved', 'rejected')),
  variety_id    TEXT NOT NULL REFERENCES varieties(id),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  farmer_id     TEXT NOT NULL REFERENCES users(id),
  label_by_user TEXT,
  final_label   TEXT CHECK (final_label IN ('Good', 'Normal', 'Bad') OR final_label IS NULL),
  verifier_id   TEXT REFERENCES users(id),
  reviewed_at   INTEGER,
  reject_reason TEXT,
  adjudicated   INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  /* When the photo was actually taken/uploaded. Never rewritten — it is
     provenance, and it ships in the export manifest. */
  uploaded_at   INTEGER NOT NULL,
  /* Set when a labeller defers an image ("decide later"). The queue orders
     by COALESCE(deferred_at, uploaded_at) so a deferred image moves to the
     back without its upload time being falsified. */
  deferred_at   INTEGER,
  /* Relative path under UPLOAD_DIR. NULL means no stored file: the browser
     falls back to the procedural image in js/photos.js. */
  image_key     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sub_status  ON submissions(status, uploaded_at);
/* ix_sub_queue covers deferred_at and is created by migrate() in db.js —
   on a database that predates that column, this file runs before the
   ALTER TABLE that adds it. */
CREATE INDEX IF NOT EXISTS ix_sub_farmer  ON submissions(farmer_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS ix_sub_variety ON submissions(variety_id, status);
CREATE INDEX IF NOT EXISTS ix_sub_review  ON submissions(reviewed_at);
CREATE INDEX IF NOT EXISTS ix_sub_final   ON submissions(final_label);

CREATE TABLE IF NOT EXISTS trail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS ix_trail_sub ON trail(submission_id, at);

/* Single-row table for the warehouse aggregates the Home screen quotes. */
CREATE TABLE IF NOT EXISTS totals (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  total_images   INTEGER, approved INTEGER, pending INTEGER, rejected INTEGER,
  week_delta     INTEGER,
  good           INTEGER, normal INTEGER, bad INTEGER,
  total_photos   INTEGER, photos_week_delta INTEGER
);
