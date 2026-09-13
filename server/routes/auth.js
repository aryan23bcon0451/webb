/* POST /api/auth/login, POST /api/auth/logout */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { one, httpError } = require('../db');
const { issue, imageCookie, clearImageCookie } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!identifier) throw httpError(422, 'Enter your email or username.');

  /* The same three ways in the mock accepted: full email, full name, or the
     local part of the email. split_part, not SQLite's INSTR/SUBSTR.
     Farmers do not sign in here. */
  const user = await one(`
    SELECT * FROM users
    WHERE role IN ('admin', 'verifier')
      AND (LOWER(email) = @id OR LOWER(name) = @id OR LOWER(split_part(email, '@', 1)) = @id)
    LIMIT 1`, { id: identifier });

  if (!user) throw httpError(401, 'No account matches that email or username.');
  if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    throw httpError(401, 'Incorrect password.');
  }

  const session = issue(user);
  res.setHeader('Set-Cookie', imageCookie(session.token, req));
  res.json(session);
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearImageCookie());
  res.status(204).end();
});

module.exports = router;
