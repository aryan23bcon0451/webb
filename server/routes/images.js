/* GET /api/images/:id — the stored photo for one submission.

   These are people's own crop photos, so the folder is never served
   statically. <img> cannot set an Authorization header, so this route
   also accepts the httpOnly cookie set at login (see auth.js). */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, httpError, UPLOAD_DIR } = require('../db');
const { requireImageSession } = require('../auth');

const router = express.Router();
router.use(requireImageSession);

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

router.get('/:id', (req, res, next) => {
  const row = db.prepare('SELECT image_key FROM submissions WHERE id = ?').get(req.params.id);
  if (!row || !row.image_key) return next(httpError(404, 'No stored photo for that image.'));

  /* basename() so a crafted image_key can never escape the upload folder. */
  const file = path.join(UPLOAD_DIR, path.basename(row.image_key));
  if (!fs.existsSync(file)) return next(httpError(404, 'No stored photo for that image.'));

  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  /* The bytes for an id never change, but a photo can be deleted — and
     "removes photos for good" must not leave it in a viewer's cache for a
     day. `no-cache` still lets the browser reuse the file, it just has to
     revalidate first, and this route is cheap. */
  res.setHeader('Cache-Control', 'private, no-cache');
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
