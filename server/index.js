/* Local development entry point: migrate, then listen.
   The deployed entry point is lambda.js. */
'use strict';

const db = require('./db');
const storage = require('./storage');
const { build } = require('./app');

const PORT = Number(process.env.PORT) || 4321;

(async () => {
  await db.migrate();

  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM submissions');
  if (!n) console.warn('The database holds no submissions. Run `npm run seed` first.');

  build().listen(PORT, () => {
    console.log(`CAFE dashboard on http://localhost:${PORT}`);
    console.log(`  database ${db.kind()}${process.env.DATABASE_URL ? ' (DATABASE_URL)' : ' (local pgdata/)'}`);
    console.log(`  photos   ${storage.kind}${process.env.S3_BUCKET ? ' (' + process.env.S3_BUCKET + ')' : ' (server/uploads)'}`);
  });
})().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
