/* ============================================================
   Builds the Express app. Shared by both entry points:

     index.js   listens on a port          (local development)
     lambda.js  wraps it for API Gateway   (deployed)

   Nothing in here knows which one it is running under.
   ============================================================ */
'use strict';

const path = require('path');
const express = require('express');
const { HttpError } = require('./db');

const ROOT = path.join(__dirname, '..');

/* Serving the static frontend only makes sense when one process answers
   both. Behind Amplify the page comes from the CDN and the function should
   answer /api and nothing else. */
const SERVE_STATIC = process.env.SERVE_STATIC !== 'false' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

/* Allowed browser origins, for the split deployment where the page is on
   Amplify and the API is on API Gateway. Empty means same-origin only,
   which needs no CORS at all. */
const ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function build() {
  const app = express();
  app.disable('x-powered-by');

  /* API Gateway terminates TLS and forwards X-Forwarded-Proto; without this
     req.secure is false and the image cookie never gets the Secure flag. */
  app.set('trust proxy', true);

  if (ORIGINS.length) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });
  }

  /* Photos arrive as base64 data URLs from the farmer upload panel, up to
     100 at a time — the default 100kb body limit would reject the first
     one. API Gateway caps a request at 10 MB regardless, so a large batch
     has to be split by the client; see the note in README. */
  app.use(express.json({ limit: process.env.BODY_LIMIT || '150mb' }));

  /* Express 5 leaves req.body undefined when a request carries no body (v4
     set it to {}). Routes read req.body.x directly, so without this a
     body-less POST is a TypeError and a 500 instead of a clean 422. */
  app.use((req, res, next) => {
    if (req.body === undefined || req.body === null) req.body = {};
    next();
  });

  /* ---------------------------------------------------- API */
  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true, at: Date.now() }));
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
  if (SERVE_STATIC) {
    app.use(express.static(ROOT, {
      index: 'index.html',
      setHeaders(res, file) {
        /* No build step and no content hashes in filenames, so a cached js/
           file would silently pin an old app against a new API. */
        if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      }
    }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  }

  /* ---------------------------------------------------- errors
     One shape for every failure: { message }, with the status the browser's
     request() helper reads off err.status. */
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ message: 'Those photos are too large to upload in one go. Add fewer at a time.' });
    }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({ message: 'That request body was not valid JSON.' });
    }
    /* 23505 unique_violation, 23503 foreign_key_violation — a write that
       raced another one. Retryable, not a server fault. */
    if (err && (err.code === '23505' || err.code === '23503')) {
      console.error(err);
      return res.status(409).json({ message: 'That change clashed with another one. Try again.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = { build, SERVE_STATIC, ORIGINS };
