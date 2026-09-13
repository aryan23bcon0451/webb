/* ============================================================
   CAFE dashboard server.

   The API and the static frontend are served from one origin, so
   there is no CORS to configure and one process to run or deploy.
   ============================================================ */
'use strict';

const path = require('path');
const express = require('express');
const { migrate, db, HttpError } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 4321;
const ROOT = path.join(__dirname, '..');

migrate();

/* Photos arrive as base64 data URLs from the farmer upload panel, up to
   100 at a time — the default 100kb body limit would reject the first one. */
app.use(express.json({ limit: process.env.BODY_LIMIT || '150mb' }));

/* ---------------------------------------------------- API */
const api = express.Router();
api.use('/auth', require('./routes/auth'));
api.use('/images', require('./routes/images'));
api.use('/farmers', require('./routes/farmers'));
api.use('/submissions', require('./routes/submissions'));
api.use('/export', require('./routes/export'));
api.use('/', require('./routes/reference'));     // /seed-types, /varieties, /companies
api.use('/', require('./routes/stats'));         // /stats/*, /users, /uploaders

api.use((req, res) => res.status(404).json({ message: 'No such endpoint.' }));
app.use('/api', api);

/* ---------------------------------------------------- frontend */
app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, file) {
    /* No build step and no content hashes in filenames, so a cached js/
       file would silently pin an old app against a new API. */
    if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

/* ---------------------------------------------------- errors
   One shape for every failure: { message }, with the status the browser's
   request() helper reads off err.status. */
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Those photos are too large to upload in one go. Add fewer at a time.' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const rows = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
if (!rows) console.warn('cafe.db holds no submissions. Run `npm run seed` first.');

app.listen(PORT, () => {
  console.log(`CAFE dashboard on http://localhost:${PORT}`);
});
