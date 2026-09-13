/* ============================================================
   Real JWT auth, replacing the unsigned stand-in js/api.js used.

   Two carriers for the same token:
     Authorization: Bearer <jwt>   — every fetch() the app makes
     cafe_img cookie (httpOnly)    — <img src> cannot set a header,
                                     and photos are people's own crop
                                     images, so the route stays behind
                                     auth rather than being public.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { httpError } = require('./db');

/* In production JWT_SECRET must be set explicitly. For local work we
   generate a random one once and keep it in a gitignored file, so
   sessions survive a restart — but there is never a shared default
   secret baked into the repo. */
function devSecret() {
  const file = path.join(__dirname, '.jwt-secret');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
    console.warn('JWT_SECRET not set — generated a local one in server/.jwt-secret.');
    console.warn('Set JWT_SECRET in the environment before deploying this anywhere real.');
  }
  return fs.readFileSync(file, 'utf8').trim();
}

const SECRET = process.env.JWT_SECRET || devSecret();

const TTL_SECONDS = 8 * 3600;
const IMG_COOKIE = 'cafe_img';

function issue(user) {
  const token = jwt.sign(
    { sub: user.id, name: user.name, role: user.role },
    SECRET,
    { expiresIn: TTL_SECONDS }
  );
  return {
    token,
    user: { id: user.id, name: user.name, role: user.role, email: user.email, region: user.region },
    exp: Date.now() + TTL_SECONDS * 1000
  };
}

/** Cookie the <img> route reads. Scoped to that path so it is never sent
    with anything else. `secure` is on whenever we are not on plain HTTP. */
function imageCookie(token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `${IMG_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/images; Max-Age=${TTL_SECONDS}` +
    (secure ? '; Secure' : '');
}
const clearImageCookie = () => `${IMG_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/images; Max-Age=0`;

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function verify(token) {
  try { return jwt.verify(token, SECRET); }
  catch (e) { return null; }
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function accept(req, token, next, ok) {
  const claims = token && verify(token);
  if (!claims) return next(httpError(401, 'Session expired. Sign in again.'));
  req.user = { id: claims.sub, name: claims.name, role: claims.role };
  ok();
}

/** Bearer token only. The cookie is deliberately NOT accepted here: a
    cookie is attached by the browser automatically, so honouring it on
    state-changing routes would make them forgeable from another site.
    Message text matches what js/api.js used — the views toast it verbatim. */
function requireSession(req, res, next) {
  accept(req, bearer(req), next, next);
}

/** Images only. <img src> cannot set an Authorization header, so this one
    route also honours the httpOnly cookie — it is a read of a single photo
    by id, scoped to Path=/api/images and SameSite=Strict. */
function requireImageSession(req, res, next) {
  accept(req, bearer(req) || readCookie(req, IMG_COOKIE), next, next);
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : next(httpError(403, 'Your role cannot perform this action.'));

module.exports = {
  issue, requireSession, requireImageSession, requireRole,
  imageCookie, clearImageCookie, TTL_SECONDS
};
