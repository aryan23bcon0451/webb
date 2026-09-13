/* ============================================================
   Postgres access, for both targets.

     DATABASE_URL set    -> node-postgres against RDS (Lambda, production)
     DATABASE_URL unset  -> PGlite, a real Postgres compiled to WASM, backed
                            by a file under server/. Same SQL, same planner,
                            no Docker and no install for local work.

   Both expose the same two calls: q() for a single statement and tx() for
   a transaction. Everything is async — unlike better-sqlite3, which this
   replaced, node-postgres has no synchronous mode.
   ============================================================ */
'use strict';

const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_PG = !!DATABASE_URL;
const PGLITE_DIR = process.env.PGLITE_DIR || path.join(__dirname, '..', 'pgdata');

/* ---------------------------------------------------- named parameters
   The SQL carries @name placeholders (carried over from the SQLite layer,
   and far easier to read than $1..$14). Postgres only understands
   positional ones, so rewrite immediately before sending. */
function bind(sql, params) {
  if (!params || Array.isArray(params)) return { text: sql, values: params || [] };
  const values = [];
  const index = new Map();
  const text = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name) => {
    if (!(name in params)) throw new Error(`SQL parameter @${name} was not supplied`);
    if (!index.has(name)) { values.push(params[name]); index.set(name, values.length); }
    return '$' + index.get(name);
  });
  return { text, values };
}

let impl = null;

/* ---------------------------------------------------- node-postgres */
function pgImpl() {
  const pg = require('pg');

  /* int8 (OID 20) arrives as a string so that values beyond 2^53 survive.
     Every bigint here is an epoch in milliseconds or a row count, both well
     inside the safe range, and the whole app compares them as numbers. */
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  /* numeric (1700) likewise — the percentages are read as numbers. */
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    /* One connection per Lambda container. A pool of ten per container is
       how a modest Lambda concurrency exhausts a db.t3.micro's 85 slots.
       Put RDS Proxy in front if concurrency climbs. */
    max: Number(process.env.PG_POOL_MAX) || 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT) || 8000,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
  });
  pool.on('error', (e) => console.error('idle postgres client error', e));

  return {
    kind: 'postgres',
    async q(sql, params) {
      const { text, values } = bind(sql, params);
      return (await pool.query(text, values)).rows;
    },
    /* Raw multi-statement DDL. Passing no values keeps node-postgres on the
       simple query protocol, which is the only one that accepts more than
       one command in a string. */
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async (sql, params) => {
          const { text, values } = bind(sql, params);
          return (await client.query(text, values)).rows;
        });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); }
  };
}

/* ---------------------------------------------------- PGlite */
function pgliteImpl() {
  let PGlite;
  try {
    ({ PGlite } = require('@electric-sql/pglite'));
  } catch (e) {
    throw new Error(
      'DATABASE_URL is not set and @electric-sql/pglite is not installed. ' +
      'Either set DATABASE_URL to a Postgres connection string, or run ' +
      '`npm install` to get the local development database.'
    );
  }
  /* A devDependency on purpose: it carries a 25 MB WASM build of Postgres,
     which has no business inside a Lambda package that always has
     DATABASE_URL set. */
  const ready = PGlite.create({ dataDir: PGLITE_DIR });

  /* One connection, so overlapping transactions would interleave their
     BEGIN/COMMIT. Serialise every transaction through a promise chain —
     the same guarantee the connection pool gives the Postgres path. */
  let chain = Promise.resolve();

  return {
    kind: 'pglite',
    async q(sql, params) {
      const db = await ready;
      const { text, values } = bind(sql, params);
      return (await db.query(text, values)).rows;
    },
    async exec(sql) { (await ready).exec(sql); },
    async tx(fn) {
      const db = await ready;
      const run = chain.then(async () => {
        await db.exec('BEGIN');
        try {
          const out = await fn(async (sql, params) => {
            const { text, values } = bind(sql, params);
            return (await db.query(text, values)).rows;
          });
          await db.exec('COMMIT');
          return out;
        } catch (e) {
          try { await db.exec('ROLLBACK'); } catch (_) { /* nothing open */ }
          throw e;
        }
      });
      chain = run.catch(() => {});   // a failed transaction must not break the chain
      return run;
    },
    async close() { (await ready).close(); }
  };
}

function backend() {
  if (!impl) impl = USE_PG ? pgImpl() : pgliteImpl();
  return impl;
}

/** Run one statement. Returns rows. */
const q = (sql, params) => backend().q(sql, params);

/** Run several statements atomically. The callback receives its own `q`
    bound to the transaction — use that one, never the module-level q, or
    the statement runs outside the transaction. */
const tx = (fn) => backend().tx(fn);

/** First row, or undefined. */
const one = async (sql, params) => (await q(sql, params))[0];

const exec = (sql) => backend().exec(sql);
const close = () => backend().close();
const kind = () => backend().kind;

module.exports = { q, tx, one, exec, close, kind, bind, USE_PG };
