/* ============================================================
   In-memory dataset standing in for Aurora Postgres + S3.
   Nothing here is read directly by the views — every read and
   write goes through js/api.js, mirroring the rule that the
   dashboard talks only to the shared API layer.
   ============================================================ */
(function (global) {
  'use strict';

  function rng(seed) {
    var t = (seed >>> 0) + 0x6D2B79F5;
    return function () {
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var r = rng(20260903);
  function pick(a) { return a[Math.floor(r() * a.length)]; }
  function between(lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }

  var DAY = 86400000;
  var NOW = new Date('2026-09-03T18:40:00').getTime();

  /* ---------------------------------------------- Seed types */
  var SEED_TYPE_SPEC = [
    ['Wheat', '🌾', 'Cereal', 18], ['Rice', '🌾', 'Cereal', 22], ['Maize', '🌽', 'Cereal', 19],
    ['Soybean', '🫘', 'Oilseed', 16], ['Cotton', '🌱', 'Fibre', 10], ['Barley', '🌾', 'Cereal', 12],
    ['Mustard', '🌻', 'Oilseed', 14], ['Groundnut', '🥜', 'Oilseed', 11], ['Sugarcane', '🎋', 'Cash crop', 9],
    ['Sorghum', '🌾', 'Millet', 13], ['Chickpea', '🫛', 'Pulse', 15], ['Millet', '🌾', 'Millet', 10],
    ['Lentil', '🫘', 'Pulse', 12], ['Pigeon Pea', '🫛', 'Pulse', 9], ['Sunflower', '🌻', 'Oilseed', 8],
    ['Sesame', '🌱', 'Oilseed', 7], ['Potato', '🥔', 'Vegetable', 17], ['Onion', '🧅', 'Vegetable', 14],
    ['Tomato', '🍅', 'Vegetable', 21], ['Chilli', '🌶️', 'Spice', 16], ['Brinjal', '🍆', 'Vegetable', 13],
    ['Okra', '🫑', 'Vegetable', 11], ['Cabbage', '🥬', 'Vegetable', 8], ['Cauliflower', '🥦', 'Vegetable', 9],
    ['Peas', '🫛', 'Vegetable', 10], ['Cucumber', '🥒', 'Vegetable', 12], ['Watermelon', '🍉', 'Fruit', 7],
    ['Bitter Gourd', '🥒', 'Vegetable', 6], ['Green Gram', '🫘', 'Pulse', 11], ['Black Gram', '🫘', 'Pulse', 9],
    ['Castor', '🌱', 'Oilseed', 5], ['Safflower', '🌻', 'Oilseed', 4]
  ];

  var seedTypes = SEED_TYPE_SPEC.map(function (s, i) {
    return {
      id: 'st_' + (i + 1),
      name: s[0],
      glyph: s[1],
      category: s[2],
      varietyCount: s[3],
      active: !(s[0] === 'Cotton' || s[0] === 'Safflower' || s[0] === 'Castor'),
      createdAt: NOW - between(120, 900) * DAY
    };
  });
  var byName = {};
  seedTypes.forEach(function (s) { byName[s.name] = s; });

  /* ---------------------------------------------- Varieties
     One row per variety — the Dataset Overview progress table is
     keyed on varieties, not crop categories. The first five carry
     the reference figures from the spec; the rest are derived. */
  var VARIETY_SPEC = [
    ['Wheat', 'HD-2967', 135420, 12450, 2130, 90, 125000, 8200, 2220],
    ['Rice', 'IR-64', 120340, 25100, 4560, 80, 110000, 7800, 2540],
    ['Maize', 'Pioneer 3396', 142800, 6200, 1000, 95, 135000, 5500, 2300],
    ['Soybean', 'JS-335', 98500, 48200, 3300, 66, 90300, 6100, 2100],
    ['Cotton', 'MCU-5', 75200, 70500, 4300, 50, 68000, 4400, 2800],
    ['Barley', 'DWRB-123'], ['Mustard', 'Pusa Bold'], ['Groundnut', 'TAG-24'],
    ['Sugarcane', 'Co-0238'], ['Sorghum', 'CSH-16'], ['Chickpea', 'JG-11'],
    ['Millet', 'HHB-67'], ['Lentil', 'IPL-316'], ['Pigeon Pea', 'BSMR-736'],
    ['Sunflower', 'KBSH-44'], ['Sesame', 'GT-10'], ['Potato', 'Kufri Jyoti'],
    ['Onion', 'Bhima Super'], ['Tomato', 'Arka Rakshak'], ['Chilli', 'LCA-334'],
    ['Brinjal', 'Pusa Purple Long'], ['Okra', 'Arka Anamika'], ['Cabbage', 'Golden Acre'],
    ['Cauliflower', 'Pusa Snowball'], ['Peas', 'Arkel'], ['Cucumber', 'Poinsette'],
    ['Watermelon', 'Sugar Baby'], ['Bitter Gourd', 'Pusa Do Mausami'], ['Green Gram', 'IPM-02-3'],
    ['Black Gram', 'T-9'], ['Castor', 'GCH-7'], ['Safflower', 'A-1']
  ];

  var TARGET = 150000;
  var varieties = VARIETY_SPEC.map(function (v, i) {
    var st = byName[v[0]];
    var approved, pending, rejected, progress, good, normal, bad;
    if (v.length > 2) {
      approved = v[2]; pending = v[3]; rejected = v[4]; progress = v[5];
      good = v[6]; normal = v[7]; bad = v[8];
    } else {
      progress = between(28, 97);
      approved = Math.round(TARGET * progress / 100 * (0.94 + r() * 0.06));
      pending = Math.round(approved * (0.05 + r() * 0.38));
      rejected = Math.round(approved * (0.006 + r() * 0.035));
      good = Math.round(approved * (0.78 + r() * 0.1));
      normal = Math.round((approved - good) * (0.6 + r() * 0.25));
      bad = Math.max(0, approved - good - normal);
    }
    return {
      id: 'var_' + (i + 1),
      name: v[1],
      seedTypeId: st.id,
      seedTypeName: st.name,
      glyph: st.glyph,
      target: TARGET,
      approved: approved, pending: pending, rejected: rejected, progress: progress,
      labels: { good: good, normal: normal, bad: bad },
      active: st.active,
      createdAt: NOW - between(90, 800) * DAY
    };
  });

  /* ---------------------------------------------- Companies */
  var COMPANY_SPEC = [
    ['Greenfield Seeds Pvt. Ltd.', 'Pune, MH'], ['Nucleus Agro Genetics', 'Hyderabad, TS'],
    ['Harvest Prime Seeds', 'Ludhiana, PB'], ['Sunrise Agritech', 'Ahmedabad, GJ'],
    ['Vantage Crop Sciences', 'Bengaluru, KA'], ['Terra Nova Seeds', 'Indore, MP'],
    ['AgriCore Hybrids', 'Nashik, MH'], ['Bluestem Seed Co.', 'Jaipur, RJ'],
    ['Kisan Vikas Seeds', 'Lucknow, UP'], ['Deccan Seed Works', 'Guntur, AP'],
    ['Indus Valley Agro', 'Karnal, HR'], ['Meridian Farm Science', 'Coimbatore, TN']
  ];
  var companies = COMPANY_SPEC.map(function (c, i) {
    return {
      id: 'co_' + (i + 1), name: c[0], location: c[1],
      varietyCount: between(3, 14), active: i !== 9,
      createdAt: NOW - between(200, 1100) * DAY
    };
  });

  /* ---------------------------------------------- People */
  var users = [
    { id: 'u_1', name: 'Alex Rivera', role: 'admin', email: 'alex.rivera@cafe.ag', region: 'HQ' },
    { id: 'u_2', name: 'Priya Nair', role: 'verifier', email: 'priya.nair@cafe.ag', region: 'South' },
    { id: 'u_3', name: 'Daniel Osei', role: 'verifier', email: 'daniel.osei@cafe.ag', region: 'West' },
    { id: 'u_4', name: 'Mei Ling Chen', role: 'verifier', email: 'meiling.chen@cafe.ag', region: 'East' },
    { id: 'u_5', name: 'Rafael Duarte', role: 'verifier', email: 'rafael.duarte@cafe.ag', region: 'North' },
    { id: 'u_6', name: 'Sofia Marchetti', role: 'verifier', email: 'sofia.marchetti@cafe.ag', region: 'Central' }
  ];
  var FARMERS = [
    'Marcus Aurelius', 'Elena Rostova', 'Takahiro Sato', 'Amara Okafor', 'Ravi Deshmukh',
    'Lucia Fernandez', 'Ibrahim Al-Sayed', 'Nadia Kovac', 'Hugo Lindqvist', 'Grace Wanjiru',
    'Tomas Novak', 'Ana Beatriz Souza', 'Kwame Mensah', 'Yuki Tanaka', 'Sanjay Patel',
    'Fatima Zahra', 'Oliver Bennett', 'Zara Hussain', 'Diego Morales', 'Anika Sharma'
  ];
  var farmers = FARMERS.map(function (n, i) {
    return {
      id: 'f_' + (i + 1), name: n, role: 'farmer',
      region: pick(['North', 'South', 'East', 'West', 'Central']),
      uploads: between(120, 2400)
    };
  });

  var DIMENSIONS = [[1920, 1280], [2048, 1536], [3024, 4032], [1600, 1200], [4000, 3000], [2560, 1440]];
  var LABELS = ['Good', 'Normal', 'Bad'];
  var REJECT_REASONS = [
    'Out of focus — leaf detail unreadable',
    'Duplicate of an earlier submission',
    'Seed type does not match the declared variety',
    'Heavy glare washes out the canopy',
    'Frame does not contain the seedling'
  ];

  /* ---------------------------------------------- Submissions */
  var submissions = [];
  var idCounter = 10000;
  var activeVarieties = varieties.filter(function (v) { return v.active; });

  var START_OF_TODAY = (function () {
    var d = new Date(NOW); d.setHours(0, 0, 0, 0); return d.getTime();
  })();

  /* `historic` keeps a reviewed item out of today's counters, so the
     "approved today / rejected today" tiles report exactly what the
     spec quotes rather than drifting as generated dates spill over. */
  function newSubmission(status, ageDays, historic) {
    idCounter++;
    var variety = pick(activeVarieties);
    var farmer = pick(farmers);
    var dim = pick(DIMENSIONS);
    var uploadedAt = NOW - Math.round(ageDays * DAY) - between(0, 20) * 3600000;
    var labelByUser = r() < 0.79 ? 'Good' : (r() < 0.68 ? 'Normal' : 'Bad');
    var s = {
      id: 'CF-2026-' + idCounter,
      seq: idCounter,
      status: status,
      varietyId: variety.id,
      varietyName: variety.name,
      seedTypeId: variety.seedTypeId,
      seedTypeName: variety.seedTypeName,
      glyph: variety.glyph,
      companyId: pick(companies).id,
      farmerId: farmer.id,
      farmerName: farmer.name,
      labelByUser: labelByUser,
      finalLabel: null,
      verifierId: null,
      reviewedAt: null,
      rejectReason: null,
      width: dim[0],
      height: dim[1],
      uploadedAt: uploadedAt,
      adjudicated: false,
      trail: []
    };
    s.companyName = companies.filter(function (c) { return c.id === s.companyId; })[0].name;
    s.trail.push({ at: uploadedAt, kind: 'upload', title: 'Submitted by ' + farmer.name, note: 'Captured on the field app · labelled "' + labelByUser + '" by the uploader' });

    if (status !== 'pending_verification') {
      var verifier = pick(users.slice(1));
      var reviewedAt = uploadedAt + between(2, 70) * 3600000;
      s.verifierId = verifier.id;
      if (historic) {
        s.reviewedAt = Math.min(reviewedAt, START_OF_TODAY - 3600000);
        if (s.reviewedAt < s.uploadedAt) s.reviewedAt = s.uploadedAt + 3600000;
      } else {
        /* Landed today: place the decision inside today's window and
           back-date the upload behind it. */
        s.reviewedAt = START_OF_TODAY + Math.round(r() * (NOW - 3600000 - START_OF_TODAY));
        s.uploadedAt = s.reviewedAt - between(1, 6) * 3600000;
        s.trail[0].at = s.uploadedAt;
      }
      s.trail.push({ at: s.uploadedAt + 1800000, kind: 'queue', title: 'Entered verification queue', note: 'Routed to the ' + verifier.region + ' review pool' });
      if (status === 'approved') {
        s.finalLabel = r() < 0.8 ? 'Good' : (r() < 0.7 ? 'Normal' : 'Bad');
        s.trail.push({ at: s.reviewedAt, kind: 'approve', title: 'Approved by ' + verifier.name, note: 'Final label recorded as "' + s.finalLabel + '"' });
      } else {
        s.rejectReason = pick(REJECT_REASONS);
        s.trail.push({ at: s.reviewedAt, kind: 'reject', title: 'Rejected by ' + verifier.name, note: s.rejectReason });
      }
      /* A slice of the corpus goes through a second, adjudicating review. */
      if (r() < 0.08) {
        var adj = pick(users.slice(1));
        if (adj.id !== verifier.id) {
          s.adjudicated = true;
          var adjAt = Math.min(s.reviewedAt + between(4, 40) * 3600000, NOW - 600000);
          s.trail.push({ at: adjAt, kind: 'adjudicate', title: 'Adjudicated by ' + adj.name, note: 'Second review requested — outcome upheld' });
        }
      }
    } else {
      s.trail.push({ at: s.uploadedAt + 1800000, kind: 'queue', title: 'Awaiting verification', note: 'Queued as pending_verification' });
    }
    return s;
  }

  /* 324 open items — the number the queue and dashboard both report. */
  for (var i = 0; i < 324; i++) submissions.push(newSubmission('pending_verification', r() * 9));
  /* Reviewed corpus for the audit trail. 89 approved / 12 rejected fall today. */
  for (var a = 0; a < 89; a++) submissions.push(newSubmission('approved', r() * 0.55));
  for (var b = 0; b < 12; b++) submissions.push(newSubmission('rejected', r() * 0.55));
  for (var c = 0; c < 560; c++) submissions.push(newSubmission(r() < 0.9 ? 'approved' : 'rejected', 1 + r() * 88, true));

  submissions.sort(function (x, y) { return y.uploadedAt - x.uploadedAt; });

  /* ---------------------------------------------- Warehouse aggregates
     Dataset-wide counters as reported by the analytics endpoint;
     far larger than the working sample held above. */
  var totals = {
    totalImages: 4582391,
    approved: 4120450,
    pending: 420341,
    rejected: 41600,
    weekDelta: 12450,
    labels: { good: 3300480, normal: 585104, bad: 234866 },   /* sums to `approved`: only labelled images have a class */
    dashboard: { totalPhotos: 12847, photosWeekDelta: 142, approvedToday: 89, approvedRate: 14, rejectedToday: 12, rejectedRate: -3, pendingDelta: -12 }
  };

  global.DB = {
    seedTypes: seedTypes,
    varieties: varieties,
    companies: companies,
    users: users,
    farmers: farmers,
    submissions: submissions,
    totals: totals,
    labels: LABELS,
    now: NOW,
    nextSeq: function () { return ++idCounter; }
  };
})(window);
