/* ============================================================
   Shared API layer.

   The dashboard never touches Postgres or S3 directly — every
   screen calls one of the methods below. Each method is named
   after the HTTP route it stands in for, so replacing the mock
   body with a real `fetch` is a one-line change per method.

     POST /auth/login
     GET  /stats/dashboard
     GET  /stats/dataset-health
     GET  /export/manifest?split=&label=&seed_type_id=
     GET  /seed-types?active=true
     GET  /varieties
     GET  /companies
     GET  /submissions?status=pending_verification&seed_type_id=&user_id=
     GET  /submissions/:id
     POST /submissions/:id/review
     GET  /submissions?search=&label=&seed_type_id=&date_from=&date_to=

   Auth is a JWT held in localStorage and attached as a bearer
   token; role (verifier / admin) gates the write routes.
   ============================================================ */
(function (global) {
  'use strict';

  var BASE = 'https://api.cafe.ag/v1';   // documented origin of the shared API layer
  var TOKEN_KEY = 'cafe.token';
  var LATENCY = [90, 260];

  function wait() {
    var ms = LATENCY[0] + Math.random() * (LATENCY[1] - LATENCY[0]);
    return new Promise(function (res) { setTimeout(res, ms); });
  }
  function ok(payload) { return wait().then(function () { return payload; }); }
  function fail(status, message) {
    return wait().then(function () {
      var e = new Error(message); e.status = status; throw e;
    });
  }

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
  /* Unsigned stand-in for the JWT the auth service issues. */
  function mintToken(user) {
    var claims = { sub: user.id, name: user.name, role: user.role, iat: Date.now(), exp: Date.now() + 8 * 3600000 };
    return { token: 'jwt.' + btoa(JSON.stringify(claims)).replace(/=+$/, ''), user: user, exp: claims.exp };
  }

  var session = readToken();
  if (session && session.exp && session.exp < Date.now()) { session = null; writeToken(null); }

  function requireSession() {
    if (!session) { var e = new Error('Session expired. Sign in again.'); e.status = 401; throw e; }
    return session;
  }
  function requireRole(roles) {
    var s = requireSession();
    if (roles.indexOf(s.user.role) === -1) { var e = new Error('Your role cannot perform this action.'); e.status = 403; throw e; }
    return s;
  }

  /* ---------------------------------------------------- helpers */
  function norm(s) { return (s || '').toString().trim().toLowerCase(); }
  function paginate(rows, page, limit) {
    page = Math.max(1, page || 1); limit = limit || 5;
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / limit));
    page = Math.min(page, pages);
    return { rows: rows.slice((page - 1) * limit, page * limit), total: total, page: page, pages: pages, limit: limit };
  }
  function startOfToday() {
    var d = new Date(DB.now); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  var API = {
    baseUrl: BASE,

    /* ============ auth ============ */
    session: function () { return session; },

    /** POST /auth/login */
    login: function (identifier, password) {
      var id = norm(identifier);
      var user = DB.users.filter(function (u) {
        return norm(u.email) === id || norm(u.name) === id || norm(u.email.split('@')[0]) === id;
      })[0];
      if (!user) return fail(401, 'No account matches that email or username.');
      if (!password || password.length < 4) return fail(401, 'Incorrect password.');
      session = mintToken(user);
      writeToken(session);
      return ok(session);
    },

    logout: function () { session = null; writeToken(null); },

    /* ============ dashboard ============ */
    /** GET /stats/dashboard */
    getDashboardStats: function () {
      requireSession();
      var d = DB.totals.dashboard;
      return ok({
        totalPhotos: d.totalPhotos,
        photosWeekDelta: d.photosWeekDelta,
        totalSeedTypes: DB.seedTypes.filter(function (s) { return s.active; }).length,
        allSeedTypes: DB.seedTypes.length,
        pendingReview: DB.submissions.filter(function (s) { return s.status === 'pending_verification'; }).length,
        approvedToday: DB.submissions.filter(function (s) { return s.status === 'approved' && s.reviewedAt >= startOfToday(); }).length,
        rejectedToday: DB.submissions.filter(function (s) { return s.status === 'rejected' && s.reviewedAt >= startOfToday(); }).length
      });
    },

    /* ============ reference data ============ */
    /** GET /seed-types?active=true — the field app reads this at runtime. */
    getSeedTypes: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.seedTypes.slice();
      if (params.active === true) rows = rows.filter(function (s) { return s.active; });
      if (params.search) {
        var q = norm(params.search);
        rows = rows.filter(function (s) { return norm(s.name).indexOf(q) > -1 || norm(s.category).indexOf(q) > -1; });
      }
      return ok(paginate(rows, params.page, params.limit || 5));
    },

    /** POST /seed-types */
    createSeedType: function (name, category) {
      requireRole(['admin']);
      name = (name || '').trim();
      if (!name) return fail(422, 'Enter a crop category name.');
      if (DB.seedTypes.some(function (s) { return norm(s.name) === norm(name); })) {
        return fail(409, '"' + name + '" already exists.');
      }
      var row = {
        id: 'st_' + (DB.seedTypes.length + 1), name: name, glyph: '🌱',
        category: (category || 'Uncategorised').trim(), varietyCount: 0, active: true, createdAt: Date.now()
      };
      DB.seedTypes.unshift(row);
      return ok(row);
    },

    /** PATCH /seed-types/:id */
    setSeedTypeActive: function (id, active) {
      requireRole(['admin']);
      var row = DB.seedTypes.filter(function (s) { return s.id === id; })[0];
      if (!row) return fail(404, 'Seed type not found.');
      row.active = !!active;
      DB.varieties.forEach(function (v) { if (v.seedTypeId === id) v.active = row.active; });
      return ok(row);
    },

    /** GET /varieties */
    getVarieties: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.varieties.slice();
      if (params.seedTypeId) rows = rows.filter(function (v) { return v.seedTypeId === params.seedTypeId; });
      if (params.search) {
        var q = norm(params.search);
        rows = rows.filter(function (v) { return norm(v.name).indexOf(q) > -1 || norm(v.seedTypeName).indexOf(q) > -1; });
      }
      return ok(paginate(rows, params.page, params.limit || 5));
    },

    /** POST /varieties */
    createVariety: function (name, seedTypeId) {
      requireRole(['admin']);
      name = (name || '').trim();
      if (!name) return fail(422, 'Enter a variety name.');
      var st = DB.seedTypes.filter(function (s) { return s.id === seedTypeId; })[0];
      if (!st) return fail(422, 'Pick the seed type this variety belongs to.');
      if (DB.varieties.some(function (v) { return norm(v.name) === norm(name) && v.seedTypeId === seedTypeId; })) {
        return fail(409, '"' + name + '" already exists under ' + st.name + '.');
      }
      var row = {
        id: 'var_' + (DB.varieties.length + 1), name: name, seedTypeId: st.id, seedTypeName: st.name,
        glyph: st.glyph, target: 150000, approved: 0, pending: 0, rejected: 0, progress: 0,
        labels: { good: 0, normal: 0, bad: 0 }, active: st.active, createdAt: Date.now()
      };
      DB.varieties.unshift(row);
      st.varietyCount++;
      return ok(row);
    },

    /** GET /companies */
    getCompanies: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.companies.slice();
      if (params.search) {
        var q = norm(params.search);
        rows = rows.filter(function (c) { return norm(c.name).indexOf(q) > -1 || norm(c.location).indexOf(q) > -1; });
      }
      return ok(paginate(rows, params.page, params.limit || 5));
    },

    /** POST /companies */
    createCompany: function (name, location) {
      requireRole(['admin']);
      name = (name || '').trim();
      if (!name) return fail(422, 'Enter a company name.');
      if (DB.companies.some(function (c) { return norm(c.name) === norm(name); })) {
        return fail(409, '"' + name + '" is already registered.');
      }
      var row = {
        id: 'co_' + (DB.companies.length + 1), name: name,
        location: (location || '—').trim(), varietyCount: 0, active: true, createdAt: Date.now()
      };
      DB.companies.unshift(row);
      return ok(row);
    },

    /* ============ review queue ============ */
    /** GET /submissions?status=pending_verification&seed_type_id=&user_id=
        Always resolved fresh so opening the queue pulls current work. */
    getQueue: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.submissions.filter(function (s) { return s.status === 'pending_verification'; });
      if (params.seedTypeId) rows = rows.filter(function (s) { return s.seedTypeId === params.seedTypeId; });
      if (params.farmerId) rows = rows.filter(function (s) { return s.farmerId === params.farmerId; });
      rows.sort(function (a, b) { return a.uploadedAt - b.uploadedAt; });   // oldest first
      return ok({ rows: rows, total: rows.length, fetchedAt: Date.now() });
    },

    /** GET /submissions/:id */
    getSubmission: function (id) {
      requireSession();
      var row = DB.submissions.filter(function (s) { return s.id === id; })[0];
      if (!row) return fail(404, 'Submission not found.');
      return ok(row);
    },

    /** POST /submissions/:id/review  { action, label } */
    reviewSubmission: function (id, action, label) {
      var s = requireRole(['verifier', 'admin']);
      var row = DB.submissions.filter(function (x) { return x.id === id; })[0];
      if (!row) return fail(404, 'Submission not found.');
      if (row.status !== 'pending_verification') return fail(409, 'This submission has already been reviewed.');
      if (action === 'approve' && ['Good', 'Normal', 'Bad'].indexOf(label) === -1) {
        return fail(422, 'Choose a quality label before approving.');
      }
      var at = Date.now();
      if (action === 'approve') {
        row.status = 'approved'; row.finalLabel = label;
        row.trail.push({ at: at, kind: 'approve', title: 'Approved by ' + s.user.name, note: 'Final label recorded as "' + label + '"' });
      } else if (action === 'reject') {
        row.status = 'rejected'; row.rejectReason = 'Rejected during verification';
        row.trail.push({ at: at, kind: 'reject', title: 'Rejected by ' + s.user.name, note: row.rejectReason });
      } else {
        return fail(422, 'Unknown review action.');
      }
      row.verifierId = s.user.id;
      row.reviewedAt = at;
      return ok(row);
    },

    /** POST /submissions/:id/skip — leaves the item pending, moves it down the queue. */
    skipSubmission: function (id) {
      requireRole(['verifier', 'admin']);
      var row = DB.submissions.filter(function (x) { return x.id === id; })[0];
      if (!row) return fail(404, 'Submission not found.');
      row.uploadedAt = Date.now();   // re-queues behind everything else
      return ok(row);
    },

    /** GET /stats/review-queue */
    getQueueStats: function () {
      requireSession();
      var today = startOfToday();
      return ok({
        pending: DB.submissions.filter(function (s) { return s.status === 'pending_verification'; }).length,
        approvedToday: DB.submissions.filter(function (s) { return s.status === 'approved' && s.reviewedAt >= today; }).length,
        rejectedToday: DB.submissions.filter(function (s) { return s.status === 'rejected' && s.reviewedAt >= today; }).length
      });
    },

    /* ============ dataset ============ */
    /** GET /varieties/progress — one row per variety, paginated. */
    getVarietyProgress: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.varieties.slice();
      if (params.seedTypeId) rows = rows.filter(function (v) { return v.seedTypeId === params.seedTypeId; });
      if (params.status === 'approved') rows.sort(function (a, b) { return b.approved - a.approved; });
      else if (params.status === 'pending_verification') rows.sort(function (a, b) { return b.pending - a.pending; });
      else if (params.status === 'rejected') rows.sort(function (a, b) { return b.rejected - a.rejected; });
      return ok(paginate(rows, params.page, params.limit || 5));
    },

    /* ============ users / audit ============ */
    /** GET /submissions?search=&seed_type_id=&date_from=&date_to= */
    searchSubmissions: function (params) {
      requireSession();
      params = params || {};
      var rows = DB.submissions.slice();
      if (params.status) rows = rows.filter(function (s) { return s.status === params.status; });
      if (params.seedTypeId) rows = rows.filter(function (s) { return s.seedTypeId === params.seedTypeId; });
      if (params.label) rows = rows.filter(function (s) { return s.finalLabel === params.label; });
      if (params.verifierId) rows = rows.filter(function (s) { return s.verifierId === params.verifierId; });
      if (params.dateFrom) rows = rows.filter(function (s) { return s.uploadedAt >= params.dateFrom; });
      if (params.dateTo) rows = rows.filter(function (s) { return s.uploadedAt <= params.dateTo; });
      if (params.search) {
        var q = norm(params.search);
        rows = rows.filter(function (s) {
          return norm(s.id).indexOf(q) > -1 || norm(s.farmerName).indexOf(q) > -1 ||
            norm(s.seedTypeName).indexOf(q) > -1 || norm(s.varietyName).indexOf(q) > -1 ||
            norm(s.companyName).indexOf(q) > -1;
        });
      }
      rows.sort(function (a, b) { return (b.reviewedAt || b.uploadedAt) - (a.reviewedAt || a.uploadedAt); });
      return ok(paginate(rows, params.page, params.limit || 10));
    },

    /** GET /users */
    getPeople: function (params) {
      requireSession();
      params = params || {};
      var staff = DB.users.map(function (u) { return u; });
      var rows = staff.concat(DB.farmers);
      if (params.role) rows = rows.filter(function (u) { return u.role === params.role; });
      if (params.search) {
        var q = norm(params.search);
        rows = rows.filter(function (u) { return norm(u.name).indexOf(q) > -1 || norm(u.email || '').indexOf(q) > -1; });
      }
      rows = rows.map(function (u) {
        var reviewed = DB.submissions.filter(function (s) { return s.verifierId === u.id; }).length;
        var uploaded = DB.submissions.filter(function (s) { return s.farmerId === u.id; }).length;
        return {
          id: u.id, name: u.name, role: u.role, email: u.email || null,
          region: u.region, reviewed: reviewed, uploaded: uploaded
        };
      });
      return ok(paginate(rows, params.page, params.limit || 8));
    },

    /** Uploaders that actually appear in the queue — powers the User filter. */
    getUploaders: function () {
      requireSession();
      var seen = {};
      DB.submissions.forEach(function (s) { seen[s.farmerId] = true; });
      return ok(DB.farmers.filter(function (f) { return seen[f.id]; }));
    }
  };


  /* ============ dataset health & export ============
     Everything below exists for one reason: the photos are being
     collected to train a quality classifier, so the questions that
     matter are "is each class big enough", "do the labels agree"
     and "can I get the labelled set out as a file". */

  function fmt(n) { return (n == null ? 0 : Math.round(n)).toLocaleString('en-US'); }

  /* Deterministic train / validation / test assignment. An image keeps
     the same split forever, so a model is never tested on an image it
     was trained on, and re-exporting does not reshuffle the set. */
  var SPLIT_CYCLE = ['train', 'train', 'train', 'train', 'train', 'val', 'test'];
  function splitOf(seq) { return SPLIT_CYCLE[seq % SPLIT_CYCLE.length]; }

  /** Class counts for the current scope, largest first is not assumed. */
  function classCounts(seedTypeId) {
    if (!seedTypeId) return { good: DB.totals.labels.good, normal: DB.totals.labels.normal, bad: DB.totals.labels.bad };
    var agg = { good: 0, normal: 0, bad: 0 };
    DB.varieties.filter(function (v) { return v.seedTypeId === seedTypeId; })
      .forEach(function (v) { agg.good += v.labels.good; agg.normal += v.labels.normal; agg.bad += v.labels.bad; });
    return agg;
  }

  /** GET /stats/dataset-health — the training-readiness summary. */
  API.getDatasetHealth = function (params) {
    requireSession();
    params = params || {};
    var counts = classCounts(params.seedTypeId);
    var labelled = counts.good + counts.normal + counts.bad;

    var classes = [
      { key: 'good', label: 'Good', count: counts.good, color: 'var(--green)' },
      { key: 'normal', label: 'Normal', count: counts.normal, color: 'var(--amber)' },
      { key: 'bad', label: 'Bad', count: counts.bad, color: 'var(--red)' }
    ].map(function (c) { c.pct = labelled ? c.count / labelled * 100 : 0; return c; });

    var sorted = classes.slice().sort(function (a, b) { return a.count - b.count; });
    var smallest = sorted[0], largest = sorted[sorted.length - 1];
    var ratio = smallest.count ? largest.count / smallest.count : 0;

    /* Label agreement: how often the uploader's own call survived review.
       Measured on the reviewed sample the dashboard holds, not the
       warehouse total. A low figure means the capture instructions are
       being read differently by different people. */
    var reviewed = DB.submissions.filter(function (s) { return s.finalLabel; });
    if (params.seedTypeId) reviewed = reviewed.filter(function (s) { return s.seedTypeId === params.seedTypeId; });
    var matched = reviewed.filter(function (s) { return s.finalLabel === s.labelByUser; }).length;

    var vs = DB.varieties.filter(function (v) { return v.active; });
    if (params.seedTypeId) vs = vs.filter(function (v) { return v.seedTypeId === params.seedTypeId; });
    var atTarget = vs.filter(function (v) { return v.progress >= 100; }).length;
    var thin = vs.filter(function (v) { return v.progress < 60; }).length;

    var pending = params.seedTypeId
      ? vs.reduce(function (n, v) { return n + v.pending; }, 0)
      : DB.totals.pending;

    /* Split sizes follow the same 5 / 1 / 1 cycle the manifest uses. */
    var splits = {
      train: Math.round(labelled * 5 / 7),
      val: Math.round(labelled * 1 / 7),
      test: labelled - Math.round(labelled * 5 / 7) - Math.round(labelled * 1 / 7)
    };

    var checks = [
      {
        ok: labelled >= 10000,
        title: 'Enough labelled images',
        detail: fmt(labelled) + ' labelled. A first model wants at least 10,000.'
      },
      {
        ok: ratio > 0 && ratio <= 4,
        title: 'Classes are balanced',
        detail: ratio
          ? '"' + largest.label + '" has ' + ratio.toFixed(1) + '× more images than "' + smallest.label + '".' +
            (ratio > 4 ? ' Collect more "' + smallest.label + '" or weight the loss.' : '')
          : 'One class has no images yet.'
      },
      {
        ok: reviewed.length ? matched / reviewed.length >= 0.8 : false,
        title: 'Labels agree',
        detail: reviewed.length
          ? Math.round(matched / reviewed.length * 100) + '% of uploads kept the label the uploader gave them.'
          : 'Nothing reviewed yet.'
      },
      {
        ok: thin === 0,
        title: 'Every variety is covered',
        detail: thin
          ? thin + ' ' + (thin === 1 ? 'variety is' : 'varieties are') + ' under 60% of target — the model will be weak on ' + (thin === 1 ? 'it' : 'them') + '.'
          : 'All ' + vs.length + ' varieties are past 60% of target.'
      },
      {
        ok: pending < labelled * 0.15,
        title: 'The queue is under control',
        detail: fmt(pending) + ' images are still waiting to be labelled.'
      }
    ];

    return ok({
      labelled: labelled,
      pending: pending,
      discarded: params.seedTypeId ? vs.reduce(function (n, v) { return n + v.rejected; }, 0) : DB.totals.rejected,
      classes: classes,
      smallest: smallest,
      largest: largest,
      balanceRatio: ratio,
      agreement: { matched: matched, total: reviewed.length, pct: reviewed.length ? matched / reviewed.length * 100 : 0 },
      varieties: { total: vs.length, atTarget: atTarget, thin: thin },
      splits: splits,
      checks: checks,
      passing: checks.filter(function (c) { return c.ok; }).length
    });
  };

  /** GET /export/manifest?split=&label=&seed_type_id=
      One row per labelled image, in the shape a training script reads. */
  API.getManifest = function (params) {
    requireSession();
    params = params || {};
    var rows = DB.submissions.filter(function (s) { return s.status === 'approved' && s.finalLabel; });
    if (params.seedTypeId) rows = rows.filter(function (s) { return s.seedTypeId === params.seedTypeId; });
    if (params.label) rows = rows.filter(function (s) { return s.finalLabel === params.label; });
    if (params.split) rows = rows.filter(function (s) { return splitOf(s.seq) === params.split; });
    rows = rows.map(function (s) {
      return {
        image_id: s.id,
        file_name: 'images/' + s.id + '.jpg',
        label: s.finalLabel.toLowerCase(),
        split: splitOf(s.seq),
        seed_type: s.seedTypeName,
        variety: s.varietyName,
        width: s.width,
        height: s.height,
        uploaded_by: s.farmerName,
        uploaded_at: new Date(s.uploadedAt).toISOString(),
        labelled_by: (DB.users.filter(function (u) { return u.id === s.verifierId; })[0] || {}).name || '',
        labelled_at: s.reviewedAt ? new Date(s.reviewedAt).toISOString() : '',
        uploader_label: s.labelByUser.toLowerCase()
      };
    });
    rows.sort(function (a, b) { return a.image_id < b.image_id ? -1 : 1; });
    return ok({ rows: rows, total: rows.length, generatedAt: Date.now() });
  };

  API.splitOf = splitOf;

  global.API = API;
})(window);
