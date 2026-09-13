/* ============================================================
   Shared API layer.

   The dashboard never touches the database or the image store
   directly — every screen calls one of the methods below, and each
   one is a single `fetch` against the server in ../server.

     POST   /api/auth/login
     POST   /api/auth/logout
     GET    /api/stats/dashboard
     GET    /api/stats/review-queue
     GET    /api/stats/dataset-health?seedTypeId=
     GET    /api/export/manifest?split=&label=&seedTypeId=
     GET    /api/seed-types?active=true
     POST   /api/seed-types
     PATCH  /api/seed-types/:id
     GET    /api/varieties
     GET    /api/varieties/progress
     POST   /api/varieties
     GET    /api/companies
     POST   /api/companies
     GET    /api/submissions/queue?seedTypeId=&farmerId=
     GET    /api/submissions?search=&label=&seedTypeId=&dateFrom=&dateTo=
     GET    /api/submissions/:id
     POST   /api/submissions/:id/review
     POST   /api/submissions/:id/skip
     DELETE /api/submissions          { ids }
     GET    /api/farmers?search=&region=&seedTypeId=&sort=
     GET    /api/farmers/:id
     POST   /api/farmers/:id/submissions
     GET    /api/users, /api/uploaders

   Auth is a JWT held in localStorage and attached as a bearer
   token; role (verifier / admin) gates the write routes.

   The previous in-browser mock is kept at js/api.mock.js for
   reference. It is not loaded.
   ============================================================ */
(function (global) {
  'use strict';

  var BASE = '/api';                 // same origin — the server hosts this page too
  var TOKEN_KEY = 'cafe.token';

  /* ---------------------------------------------------- token */
  function readToken() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage unavailable — session stays in memory */ }
  }

  var session = readToken();
  if (session && session.exp && session.exp < Date.now()) { session = null; writeToken(null); }

  /* ---------------------------------------------------- transport */

  /** Turns a params object into a query string, dropping anything the
      caller left empty so `?status=` never reaches the server. */
  function qs(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function request(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (session && session.token) opts.headers.Authorization = 'Bearer ' + session.token;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    return fetch(BASE + path, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data;
        try { data = text ? JSON.parse(text) : {}; }
        catch (e) { data = {}; }

        if (res.ok) return data;

        /* A rejected token means the session is over wherever it was
           stored — drop it so the app falls back to the login shell. */
        if (res.status === 401) { session = null; writeToken(null); }

        var err = new Error(data.message || 'Something went wrong.');
        err.status = res.status;     // the views branch on 401 / 403 / 409
        throw err;
      });
    }, function () {
      var err = new Error('Cannot reach the server. Check your connection.');
      err.status = 0;
      throw err;
    });
  }

  var API = {
    baseUrl: BASE,

    /* ============ auth ============ */
    /** Synchronous on purpose — the views call this inline while rendering. */
    session: function () { return session; },

    /** POST /auth/login */
    login: function (identifier, password) {
      return request('POST', '/auth/login', { identifier: identifier, password: password })
        .then(function (s) { session = s; writeToken(s); return s; });
    },

    logout: function () {
      session = null;
      writeToken(null);
      /* Clears the image cookie. Fire and forget: signing out must not
         wait on, or be blocked by, the network. */
      request('POST', '/auth/logout').catch(function () {});
    },

    /* ============ dashboard ============ */
    /** GET /stats/dashboard */
    getDashboardStats: function () { return request('GET', '/stats/dashboard'); },

    /* ============ reference data ============ */
    /** GET /seed-types?active=true — the field app reads this at runtime. */
    getSeedTypes: function (params) { return request('GET', '/seed-types' + qs(params)); },

    /** POST /seed-types */
    createSeedType: function (name, category) {
      return request('POST', '/seed-types', { name: name, category: category });
    },

    /** PATCH /seed-types/:id */
    setSeedTypeActive: function (id, active) {
      return request('PATCH', '/seed-types/' + encodeURIComponent(id), { active: !!active });
    },

    /** GET /varieties */
    getVarieties: function (params) { return request('GET', '/varieties' + qs(params)); },

    /** POST /varieties */
    createVariety: function (name, seedTypeId) {
      return request('POST', '/varieties', { name: name, seedTypeId: seedTypeId });
    },

    /** GET /companies */
    getCompanies: function (params) { return request('GET', '/companies' + qs(params)); },

    /** POST /companies */
    createCompany: function (name, location) {
      return request('POST', '/companies', { name: name, location: location });
    },

    /* ============ review queue ============ */
    /** GET /submissions/queue — the whole pending set, oldest first, so one
        keypress can advance to the next image without another round trip. */
    getQueue: function (params) { return request('GET', '/submissions/queue' + qs(params)); },

    /** GET /submissions/:id */
    getSubmission: function (id) { return request('GET', '/submissions/' + encodeURIComponent(id)); },

    /** POST /submissions/:id/review  { action, label } */
    reviewSubmission: function (id, action, label) {
      return request('POST', '/submissions/' + encodeURIComponent(id) + '/review',
        { action: action, label: label });
    },

    /** POST /submissions/:id/skip — leaves the item pending, moves it down the queue. */
    skipSubmission: function (id) {
      return request('POST', '/submissions/' + encodeURIComponent(id) + '/skip');
    },

    /** GET /stats/review-queue */
    getQueueStats: function () { return request('GET', '/stats/review-queue'); },

    /* ============ dataset ============ */
    /** GET /varieties/progress — one row per variety, paginated. */
    getVarietyProgress: function (params) { return request('GET', '/varieties/progress' + qs(params)); },

    /** GET /stats/dataset-health — the training-readiness summary. */
    getDatasetHealth: function (params) { return request('GET', '/stats/dataset-health' + qs(params)); },

    /** GET /export/manifest — one row per labelled image, in the shape a
        training script reads. */
    getManifest: function (params) { return request('GET', '/export/manifest' + qs(params)); },

    /* ============ images ============ */
    /** GET /submissions?search=&seedTypeId=&dateFrom=&dateTo= */
    searchSubmissions: function (params) { return request('GET', '/submissions' + qs(params)); },

    /** DELETE /submissions { ids } — removes photos for good: from the
        farmer's uploads, the labelling queue and every export. Admins only. */
    deleteSubmissions: function (ids) { return request('DELETE', '/submissions', { ids: ids }); },

    /* ============ people ============ */
    /** GET /users */
    getPeople: function (params) { return request('GET', '/users' + qs(params)); },

    /** Uploaders that actually appear in the queue — powers the User filter. */
    getUploaders: function () { return request('GET', '/uploaders'); },

    /* ============ farmers ============ */
    /** GET /farmers?search=&region=&seedTypeId=&sort= */
    getFarmers: function (params) { return request('GET', '/farmers' + qs(params)); },

    /** GET /farmers/:id — one farmer, with where their photos go wrong. */
    getFarmer: function (id) { return request('GET', '/farmers/' + encodeURIComponent(id)); },

    /** POST /farmers/:id/submissions  { varietyId, companyId, label, images }
        Photos added from the dashboard on a farmer's behalf. They enter the
        labelling queue exactly as field-app uploads do. */
    addSubmissions: function (farmerId, body) {
      return request('POST', '/farmers/' + encodeURIComponent(farmerId) + '/submissions', body);
    }
  };

  /* Deterministic train / validation / test assignment. Pure arithmetic on
     the image's own id, so it stays client-side — but the server computes
     the identical cycle for exports. Changing one without the other would
     move images between splits and leak training data into the test set. */
  var SPLIT_CYCLE = ['train', 'train', 'train', 'train', 'train', 'val', 'test'];
  API.splitOf = function (seq) { return SPLIT_CYCLE[seq % SPLIT_CYCLE.length]; };

  global.API = API;
})(window);
