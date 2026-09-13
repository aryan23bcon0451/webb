/* GET /api/images/:id — the stored photo for one submission.

   These are people's own crop photos, so the bucket is private and never
   served directly. <img> cannot set an Authorization header, so this one
   route also honours the httpOnly cookie set at login (see auth.js).

   On S3 the reply is a redirect to a short-lived presigned URL: the bytes
   never pass through Lambda, which sidesteps the 6 MB response ceiling and
   keeps a thumbnail from costing a function invocation's worth of egress.
*/
'use strict';

const express = require('express');
const { one, httpError } = require('../db');
const { requireImageSession } = require('../auth');
const storage = require('../storage');

const router = express.Router();
router.use(requireImageSession);

router.get('/:id', async (req, res) => {
  const row = await one('SELECT image_key FROM submissions WHERE id = @id', { id: req.params.id });
  if (!row || !row.image_key) throw httpError(404, 'No stored photo for that image.');

  const found = await storage.read(row.image_key);
  if (!found) throw httpError(404, 'No stored photo for that image.');

  /* The bytes for an id never change, but a photo can be deleted — and
     "removes photos for good" must not leave it in a viewer's cache for a
     day. `no-cache` still lets the browser reuse it, after revalidating. */
  res.setHeader('Cache-Control', 'private, no-cache');

  if (found.redirect) return res.redirect(302, found.redirect);

  res.setHeader('Content-Type', found.contentType);
  found.stream.pipe(res);
});

module.exports = router;
