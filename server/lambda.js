/* ============================================================
   Lambda entry point, behind an API Gateway HTTP API proxy route.

   The Express app is unchanged — serverless-express translates the API
   Gateway event into the req/res pair Express expects. Keeping one app
   means the routes, the auth and the 32 audited invariants are the same
   code locally and deployed.

   Two things are done once per container rather than per request:
     * the Postgres pool is created lazily by db/pool.js and reused
     * migrate() runs behind a promise that later invocations await
   ============================================================ */
'use strict';

const serverlessExpress = require('@codegenie/serverless-express');
const db = require('./db');
const { build } = require('./app');

/* Held across invocations on a warm container. A rejected migration is not
   cached, so the next invocation retries rather than serving a broken
   function for the life of the container. */
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      if (process.env.RUN_MIGRATIONS === 'false') return;
      await db.migrate();
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const handler = serverlessExpress({ app: build() });

exports.handler = async (event, context) => {
  /* Without this the function waits for the pg pool's idle socket before
     returning, adding the idle timeout to every invocation's billed time. */
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    await ensureReady();
  } catch (e) {
    console.error('Startup failed:', e);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'The service is starting up. Try again in a moment.' })
    };
  }

  return handler(event, context);
};
