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
     GET  /farmers?search=&region=&seed_type_id=&sort=
     GET  /farmers/:id
     POST /farmers/:id/submissions
     DELETE /submissions  { ids }

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
      if (params.farmerId) rows = rows.filter(function (s) { return s.farmerId === params.farmerId; });
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

  /** GET /export/manifest?split=&label=&seed_type_id=&variety_id=&company_id=
      One row per labelled image, in the shape a training script reads. */
  API.getManifest = function (params) {
    requireSession();
    params = params || {};
    var rows = DB.submissions.filter(function (s) { return s.status === 'approved' && s.finalLabel; });
    if (params.seedTypeId) rows = rows.filter(function (s) { return s.seedTypeId === params.seedTypeId; });
    if (params.varietyId) rows = rows.filter(function (s) { return s.varietyId === params.varietyId; });
    if (params.companyId) rows = rows.filter(function (s) { return s.companyId === params.companyId; });
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
        company: s.companyName,
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

  /* ============ farmers ============
     Who sends the photos in. Every figure is rolled up from their
     submissions, so a farmer's page and the image list always agree. */

  var WEEK = 7 * 86400000;

  function farmerProfile(f) {
    var subs = DB.submissions.filter(function (s) { return s.farmerId === f.id; })
      .sort(function (a, b) { return b.uploadedAt - a.uploadedAt; });
    var p = {
      id: f.id, name: f.name, region: f.region,
      uploaded: subs.length, approved: 0, pending: 0, rejected: 0,
      thisWeek: 0, lastUploadAt: subs.length ? subs[0].uploadedAt : null
    };
    var labelled = 0, agreed = 0, crops = {};
    subs.forEach(function (s) {
      if (s.status === 'approved') p.approved++;
      else if (s.status === 'rejected') p.rejected++;
      else p.pending++;
      if (s.finalLabel) { labelled++; if (s.finalLabel === s.labelByUser) agreed++; }
      if (s.uploadedAt > DB.now - WEEK) p.thisWeek++;
      var c = crops[s.seedTypeId] ||
        (crops[s.seedTypeId] = { seedTypeId: s.seedTypeId, name: s.seedTypeName, glyph: s.glyph, count: 0 });
      c.count++;
    });
    var reviewed = p.approved + p.rejected;
    p.acceptance = reviewed ? p.approved / reviewed * 100 : null;
    p.agreement = labelled ? agreed / labelled * 100 : null;
    p.crops = Object.keys(crops).map(function (k) { return crops[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
    p.recent = subs.slice(0, 4).map(function (s) {
      return { id: s.id, seq: s.seq, seedTypeName: s.seedTypeName, imageUrl: s.imageUrl || null };
    });
    return p;
  }

  var FARMER_SORTS = {
    uploads: function (a, b) { return b.uploaded - a.uploaded; },
    recent: function (a, b) { return (b.lastUploadAt || 0) - (a.lastUploadAt || 0); },
    acceptance: function (a, b) {
      return (b.acceptance == null ? -1 : b.acceptance) - (a.acceptance == null ? -1 : a.acceptance);
    },
    name: function (a, b) { return a.name.localeCompare(b.name); }
  };

  /** GET /farmers?search=&region=&seed_type_id=&sort= */
  API.getFarmers = function (params) {
    requireSession();
    params = params || {};
    var all = DB.farmers.map(farmerProfile);
    var rows = all;
    if (params.region) rows = rows.filter(function (f) { return f.region === params.region; });
    if (params.seedTypeId) rows = rows.filter(function (f) {
      return f.crops.some(function (c) { return c.seedTypeId === params.seedTypeId; });
    });
    if (params.search) {
      var q = norm(params.search);
      rows = rows.filter(function (f) {
        return norm(f.name).indexOf(q) > -1 || norm(f.region).indexOf(q) > -1 ||
          f.crops.some(function (c) { return norm(c.name).indexOf(q) > -1; });
      });
    }
    rows = rows.slice().sort(FARMER_SORTS[params.sort] || FARMER_SORTS.uploads);

    var approved = 0, reviewed = 0, uploaded = 0, regions = {};
    all.forEach(function (f) {
      approved += f.approved;
      reviewed += f.approved + f.rejected;
      uploaded += f.uploaded;
      regions[f.region] = true;
    });
    var top = all.slice().sort(FARMER_SORTS.uploads)[0];

    var page = paginate(rows, params.page, params.limit || 12);
    page.summary = {
      farmers: all.length,
      uploaded: uploaded,
      activeThisWeek: all.filter(function (f) { return f.thisWeek > 0; }).length,
      acceptance: reviewed ? approved / reviewed * 100 : 0,
      regions: Object.keys(regions).sort(),
      topUploaderId: top ? top.id : null
    };
    return ok(page);
  };

  /** GET /farmers/:id — one farmer, with where their photos go wrong. */
  API.getFarmer = function (id) {
    requireSession();
    var f = DB.farmers.filter(function (x) { return x.id === id; })[0];
    if (!f) return fail(404, 'Farmer not found.');
    var p = farmerProfile(f);

    /* Uploads per week over the last 12 weeks, oldest first. */
    var activity = [];
    for (var w = 0; w < 12; w++) activity.push(0);
    var reasons = {}, companies = {};
    DB.submissions.forEach(function (s) {
      if (s.farmerId !== id) return;
      /* Photos added from the dashboard are stamped with the real clock,
         which runs ahead of the sample's; they count as this week. */
      var ago = Math.floor(Math.max(0, DB.now - s.uploadedAt) / WEEK);
      if (ago >= 0 && ago < 12) activity[11 - ago]++;
      if (s.status === 'rejected' && s.rejectReason) reasons[s.rejectReason] = (reasons[s.rejectReason] || 0) + 1;
      companies[s.companyName] = (companies[s.companyName] || 0) + 1;
    });
    var tally = function (counts, key) {
      return Object.keys(counts).map(function (k) {
        var row = { count: counts[k] }; row[key] = k; return row;
      }).sort(function (a, b) { return b.count - a.count; });
    };

    var ranked = DB.farmers.map(farmerProfile).sort(FARMER_SORTS.uploads);
    p.activity = activity;
    p.reasons = tally(reasons, 'reason');
    p.companies = tally(companies, 'name');
    p.rank = ranked.map(function (x) { return x.id; }).indexOf(id) + 1;
    p.farmerCount = ranked.length;
    return ok(p);
  };

  /** POST /farmers/:id/submissions  { varietyId, companyId, label, images: [{ dataUrl, width, height }] }
      Photos added from the dashboard on a farmer's behalf. They enter the
      labelling queue exactly as field-app uploads do. */
  API.addSubmissions = function (farmerId, body) {
    var s = requireRole(['admin', 'verifier']);
    body = body || {};
    var farmer = DB.farmers.filter(function (f) { return f.id === farmerId; })[0];
    if (!farmer) return fail(404, 'Farmer not found.');
    var variety = DB.varieties.filter(function (v) { return v.id === body.varietyId; })[0];
    if (!variety) return fail(422, 'Choose the crop and variety these photos show.');
    var company = DB.companies.filter(function (c) { return c.id === body.companyId; })[0];
    if (!company) return fail(422, 'Choose the seed company.');
    if (DB.labels.indexOf(body.label) === -1) return fail(422, 'Choose the farmer\'s quality call.');
    var images = (body.images || []).filter(function (im) { return im && /^data:image\//.test(im.dataUrl || ''); });
    if (!images.length) return fail(422, 'Add at least one photo.');
    if (images.length > 100) return fail(422, 'Add at most 100 photos at a time.');

    var at = Date.now();
    var rows = images.map(function (im, i) {
      var seq = DB.nextSeq();
      var uploadedAt = at - i;          // the first photo picked lists first
      variety.pending++;
      return {
        id: 'CF-2026-' + seq,
        seq: seq,
        status: 'pending_verification',
        varietyId: variety.id,
        varietyName: variety.name,
        seedTypeId: variety.seedTypeId,
        seedTypeName: variety.seedTypeName,
        glyph: variety.glyph,
        companyId: company.id,
        companyName: company.name,
        farmerId: farmer.id,
        farmerName: farmer.name,
        labelByUser: body.label,
        finalLabel: null,
        verifierId: null,
        reviewedAt: null,
        rejectReason: null,
        width: Math.round(im.width) || 0,
        height: Math.round(im.height) || 0,
        uploadedAt: uploadedAt,
        adjudicated: false,
        imageUrl: im.dataUrl,
        trail: [
          { at: uploadedAt, kind: 'upload', title: 'Added by ' + s.user.name + ' for ' + farmer.name,
            note: (im.from ? 'Frame from ' + String(im.from).slice(0, 160) : 'Uploaded from the dashboard') +
              ' · labelled "' + body.label + '" on the farmer\'s behalf' },
          { at: uploadedAt, kind: 'queue', title: 'Awaiting verification', note: 'Queued as pending_verification' }
        ]
      };
    });
    Array.prototype.unshift.apply(DB.submissions, rows);
    return ok({ rows: rows });
  };

  /** DELETE /submissions  { ids } — removes photos for good: from the
      farmer's uploads, the labelling queue and every export. Admins only. */
  API.deleteSubmissions = function (ids) {
    requireRole(['admin']);
    var gone = {};
    (ids || []).forEach(function (id) { gone[id] = true; });
    var removed = DB.submissions.filter(function (s) { return gone[s.id]; });
    if (!removed.length) return fail(404, 'Those photos no longer exist.');

    /* Keep the per-variety counters the dataset screens read in step. */
    removed.forEach(function (s) {
      var v = DB.varieties.filter(function (x) { return x.id === s.varietyId; })[0];
      if (!v) return;
      if (s.status === 'pending_verification') v.pending = Math.max(0, v.pending - 1);
      else if (s.status === 'rejected') v.rejected = Math.max(0, v.rejected - 1);
      else {
        v.approved = Math.max(0, v.approved - 1);
        var key = (s.finalLabel || '').toLowerCase();
        if (v.labels[key] > 0) v.labels[key]--;
      }
    });
    for (var i = DB.submissions.length - 1; i >= 0; i--) {
      if (gone[DB.submissions[i].id]) DB.submissions.splice(i, 1);
    }
    return ok({ deleted: removed.length });
  };

  API.splitOf = splitOf;

  global.API = API;
})(window);
