/* GET /api/images/:id — the stored photo for one submission.

   These are people's own crop photos, so the folder is never served
   statically. <img> cannot set an Authorization header, so this route
   also accepts the httpOnly cookie set at login (see auth.js). */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, httpError, UPLOAD_DIR } = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(requireSession);

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

router.get('/:id', (req, res, next) => {
  const row = db.prepare('SELECT image_key FROM submissions WHERE id = ?').get(req.params.id);
  if (!row || !row.image_key) return next(httpError(404, 'No stored photo for that image.'));

  /* basename() so a crafted image_key can never escape the upload folder. */
  const file = path.join(UPLOAD_DIR, path.basename(row.image_key));
  if (!fs.existsSync(file)) return next(httpError(404, 'No stored photo for that image.'));

  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');   // image bytes never change for an id
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
