/* ============================================================
   Farmers directory — who sends the photos in, and of what.

   The list answers "who uploads which crops, and how much of it
   survives review". Opening a farmer shows every photo they have
   sent, crop by crop, and why their photos get thrown out — the
   conversation worth having with them next.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, pct = UI.pct, icon = Icons.icon;

  var state = null;
  /* The list's search and filters survive a trip into one farmer and back. */
  var remembered = null;

  var LAYOUT_KEY = 'cafe.farmers.layout';
  var LIST_SIZE = 12;
  var GALLERY_SIZE = 12;
  var TONES = ['brand', 'green', 'blue', 'amber'];

  var SORTS = [
    { id: 'uploads', name: 'Most uploads', said: 'Most uploads first' },
    { id: 'recent', name: 'Most recent upload', said: 'Most recent upload first' },
    { id: 'acceptance', name: 'Most kept after review', said: 'Most photos kept first' },
    { id: 'name', name: 'Name, A–Z', said: 'In alphabetical order' }
  ];

  var STATUSES = [
    { id: '', name: 'Everything' },
    { id: 'approved', name: 'In dataset' },
    { id: 'pending_verification', name: 'Waiting' },
    { id: 'rejected', name: 'Thrown out' }
  ];

  var LAYOUTS = [
    { id: 'cards', name: 'Cards', icon: 'grid' },
    { id: 'table', name: 'Table', icon: 'menu' }
  ];

  /* ---------------------------------------------------- helpers */
  function readLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) === 'table' ? 'table' : 'cards'; }
    catch (e) { return 'cards'; }
  }
  function writeLayout(v) {
    try { localStorage.setItem(LAYOUT_KEY, v); } catch (e) { /* non-fatal */ }
  }

  /* Other screens leave `.pager button[data-page]` handlers behind on the
     shared view element, so this screen's pagers answer to their own
     attribute. */
  function pager(page, pages) {
    return UI.pager(page, pages).replace(/data-page=/g, 'data-fpage=');
  }

  function plural(n, one, many) { return num(n) + ' ' + (n === 1 ? one : many); }

  function tone(id) {
    var n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
    return TONES[n % TONES.length];
  }

  function avatar(f, size) {
    return '<span class="avatar f-avatar tone-' + tone(f.id) + (size ? ' ' + size : '') + '" aria-hidden="true">' +
      esc(UI.initials(f.name)) + '</span>';
  }

  /** Share of reviewed photos kept. Blank until something is reviewed. */
  function kept(f) { return f.acceptance == null ? '—' : pct(f.acceptance, 0); }
  function keptTone(f) {
    return f.acceptance == null || f.acceptance >= 85 ? '' : f.acceptance >= 70 ? 'amber' : 'red';
  }

  function lastSeen(f) {
    return f.lastUploadAt ? 'last upload ' + UI.ago(f.lastUploadAt) : 'nothing uploaded yet';
  }

  function focusOn(view, sel) {
    return function () {
      var el = view.querySelector(sel);
      if (el) el.focus();
    };
  }

  /** Anything about a farmer worth a second look, in a few words. */
  function flags(f, topId) {
    var out = [];
    if (f.id === topId) out.push('<span class="badge badge-blue">' + icon('trend-up') + 'Top uploader</span>');
    if (f.acceptance != null && f.acceptance < 85) {
      out.push('<span class="badge badge-amber">' + icon('alert') + 'Many photos thrown out</span>');
    }
    if (f.uploaded && !f.thisWeek) out.push('<span class="badge badge-gray">Quiet this week</span>');
    return '<div class="fc-flags">' + out.join('') + '</div>';
  }

  /** In dataset / waiting / thrown out as one bar. The bar is colour and
      nothing else, so the same split is spelled out alongside it. */
  function statusBar(f) {
    var total = f.uploaded || 1;
    var seg = function (v, color) {
      return '<i style="width:' + (v / total * 100) + '%;background:' + color + '"></i>';
    };
    var spoken = num(f.approved) + ' in the dataset, ' + num(f.pending) + ' waiting, ' + num(f.rejected) + ' thrown out';
    return '<div class="split-bar" title="' + esc(spoken) + '" aria-hidden="true">' +
      seg(f.approved, 'var(--green)') + seg(f.pending, 'var(--amber)') + seg(f.rejected, 'var(--red)') +
      '</div><span class="sr-only">' + esc(spoken) + '</span>';
  }

  /** The crops a farmer sends most, with the one being filtered on first. */
  function cropChips(f, max) {
    var pick = state.filters.seedTypeId;
    var crops = f.crops.slice().sort(function (a, b) {
      return (b.seedTypeId === pick) - (a.seedTypeId === pick);
    });
    var shown = crops.slice(0, max);
    var more = crops.length - shown.length;
    return '<div class="crop-chips">' + shown.map(function (c) {
      return '<span class="crop-chip' + (c.seedTypeId === pick ? ' on' : '') + '">' +
        '<span aria-hidden="true">' + esc(c.glyph) + '</span>' + esc(c.name) + '<b>' + num(c.count) + '</b></span>';
    }).join('') +
    (more > 0 ? '<span class="crop-chip more">+' + more + ' more</span>' : '') + '</div>';
  }

  function thumbs(f) {
    var cells = f.recent.map(function (s) {
      return '<img src="' + Photos.of(s) + '" alt="" loading="lazy">';
    });
    while (cells.length < 4) cells.push('<span></span>');
    return '<div class="fc-thumbs" aria-hidden="true">' + cells.join('') + '</div>';
  }

  /* ---------------------------------------------------- directory */
  function listSkeleton() {
    var c = '', t = '';
    for (var i = 0; i < 4; i++) c += '<div class="stat"><div class="skeleton" style="height:96px"></div></div>';
    for (var j = 0; j < 6; j++) t += '<div class="skeleton" style="height:300px;border-radius:14px"></div>';
    return '<div class="skeleton" style="height:60px;border-radius:14px;margin-bottom:20px"></div>' +
      '<div class="stat-grid c4">' + c + '</div>' +
      '<div class="card"><div class="farmer-grid">' + t + '</div></div>';
  }

  function listStats() {
    var s = state.list.summary;
    return '<div class="stat-grid c4">' +
      UI.statCard({ label: 'Farmers', value: num(s.farmers), icon: 'users', tone: 'brand',
        sub: 'Across ' + plural(s.regions.length, 'region', 'regions') }) +
      UI.statCard({ label: 'Photos sent in', value: num(s.uploaded), icon: 'image', tone: 'blue',
        sub: 'About ' + num(s.farmers ? s.uploaded / s.farmers : 0) + ' per farmer' }) +
      UI.statCard({ label: 'Uploaded this week', value: num(s.activeThisWeek), icon: 'clock', tone: 'amber',
        sub: pct(s.farmers ? s.activeThisWeek / s.farmers * 100 : 0, 0) + ' of farmers sent something' }) +
      UI.statCard({ label: 'Kept after review', value: pct(s.acceptance, 0), icon: 'shield', tone: 'green',
        sub: 'Of every photo reviewed so far', bar: { pct: s.acceptance } }) +
    '</div>';
  }

  function listBar() {
    var f = state.filters;
    var regions = state.list.summary.regions.map(function (r) { return { id: r, name: r }; });
    var layouts = LAYOUTS.map(function (l) {
      return '<button type="button" data-layout="' + l.id + '" aria-pressed="' + (state.layout === l.id) + '">' +
        icon(l.icon) + esc(l.name) + '</button>';
    }).join('');

    return '<div class="filter-bar">' +
      '<div class="search-field" style="flex:1;min-width:220px;max-width:340px">' +
        '<span class="search-ico">' + icon('search') + '</span>' +
        '<input class="input" id="f-q" placeholder="Search by name, region or crop…" aria-label="Search farmers"' +
          ' value="' + esc(state.search) + '"></div>' +
      '<div class="filter-group"><label for="f-crop">Uploads</label>' +
        '<select class="select" id="f-crop">' +
          UI.selectOptions(state.seedTypes, 'id', 'name', f.seedTypeId, 'Any crop') + '</select></div>' +
      '<div class="filter-group"><label for="f-region">Region</label>' +
        '<select class="select" id="f-region">' +
          UI.selectOptions(regions, 'id', 'name', f.region, 'All regions') + '</select></div>' +
      '<div class="filter-group"><label for="f-sort">Sort</label>' +
        '<select class="select" id="f-sort">' + UI.selectOptions(SORTS, 'id', 'name', f.sort) + '</select></div>' +
      '<div class="filter-spacer"></div>' +
      '<div class="seg" role="group" aria-label="Layout">' + layouts + '</div>' +
    '</div>';
  }

  function farmerCard(f, topId) {
    var said = f.name + ', ' + plural(f.uploaded, 'upload', 'uploads') + ', ' + kept(f) + ' kept';
    var t = keptTone(f);
    return '<button class="farmer-card" type="button" data-farmer="' + esc(f.id) + '" aria-label="' + esc(said) + '">' +
      '<div class="fc-head">' + avatar(f, 'avatar-lg') +
        '<div class="fc-name"><strong>' + esc(f.name) + '</strong>' +
          '<small>' + esc(f.region) + ' · ' + esc(lastSeen(f)) + '</small></div>' +
      '</div>' +
      thumbs(f) +
      '<div class="fc-stats">' +
        '<div><b>' + num(f.uploaded) + '</b><small>uploads</small></div>' +
        '<div><b' + (t ? ' class="t-' + t + '"' : '') + '>' + kept(f) + '</b><small>kept</small></div>' +
        '<div><b>' + num(f.crops.length) + '</b><small>' + (f.crops.length === 1 ? 'crop' : 'crops') + '</small></div>' +
      '</div>' +
      statusBar(f) + cropChips(f, 3) + flags(f, topId) +
    '</button>';
  }

  function farmerTable(rows) {
    var body = rows.map(function (f) {
      var t = keptTone(f);
      return '<tr class="clickable" data-farmer="' + esc(f.id) + '">' +
        '<td><div class="farmer-cell">' + avatar(f, 'avatar-sm') +
          '<span>' + esc(f.name) + '<span class="cell-sub t-muted">' + esc(f.region) + '</span></span></div></td>' +
        '<td class="num">' + num(f.uploaded) + '</td>' +
        '<td>' + cropChips(f, 3) + '</td>' +
        '<td style="min-width:150px">' + statusBar(f) + '</td>' +
        '<td class="num' + (t ? ' t-' + t : '') + '">' + kept(f) + '</td>' +
        '<td class="t-muted nowrap">' + (f.lastUploadAt ? UI.ago(f.lastUploadAt) : '—') + '</td>' +
        '<td><button class="icon-btn row-open" type="button" data-farmer="' + esc(f.id) + '"' +
          ' aria-label="Open ' + esc(f.name) + '">' + icon('chevron-right') + '</button></td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Farmer</th><th>Uploads</th><th>Crops they send</th><th>In dataset / waiting / out</th>' +
      '<th>Kept</th><th>Last upload</th><th></th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function listPanel() {
    var p = state.list, f = state.filters;
    var crop = state.seedTypes.filter(function (s) { return s.id === f.seedTypeId; })[0];
    var sort = SORTS.filter(function (s) { return s.id === f.sort; })[0] || SORTS[0];
    var heading = plural(p.total, 'farmer', 'farmers') +
      (crop ? ' uploading ' + crop.name : '') + (f.region ? ' in ' + f.region : '');

    var body = !p.rows.length
      ? UI.empty('Nobody matches', 'Try a different name, crop or region.', 'users')
      : state.layout === 'table'
        ? farmerTable(p.rows)
        : '<div class="farmer-grid">' + p.rows.map(function (r) {
            return farmerCard(r, p.summary.topUploaderId);
          }).join('') + '</div>';

    var from = p.total ? (p.page - 1) * p.limit + 1 : 0;
    var to = Math.min(p.page * p.limit, p.total);

    return '<div class="card" id="f-results">' +
      '<div class="card-head"><div class="card-head-text"><h2>' + esc(heading) + '</h2>' +
        '<p>' + esc(sort.said) + '. Open anyone to see every photo they have sent.</p></div></div>' +
      body +
      (p.total ? '<div class="card-foot"><span>Showing ' + from + '–' + to + ' of ' + num(p.total) + '</span>' +
        pager(p.page, p.pages) + '</div>' : '') +
    '</div>';
  }

  /* ---------------------------------------------------- one farmer */
  function profileSkeleton() {
    var c = '';
    for (var i = 0; i < 4; i++) c += '<div class="stat"><div class="skeleton" style="height:96px"></div></div>';
    return '<div class="skeleton" style="height:36px;width:140px;border-radius:10px;margin-bottom:16px"></div>' +
      '<div class="skeleton" style="height:120px;border-radius:14px;margin-bottom:20px"></div>' +
      '<div class="stat-grid c4">' + c + '</div>' +
      '<div class="do-layout"><div class="skeleton" style="height:620px;border-radius:14px"></div>' +
      '<div class="skeleton" style="height:420px;border-radius:14px"></div></div>';
  }

  function backButton() {
    return '<button class="btn btn-ghost f-back" type="button" id="f-back">' + icon('arrow-left') + 'All farmers</button>';
  }

  function profileHero() {
    var f = state.farmer;
    return '<div class="card farmer-hero">' + avatar(f, 'avatar-xl') +
      '<div class="farmer-hero-text">' +
        '<h1>' + esc(f.name) + '</h1>' +
        '<p>Farmer · ' + esc(f.region) + ' region · ' + esc(lastSeen(f)) + '</p>' +
        flags(f, f.rank === 1 ? f.id : null) +
      '</div>' +
      '<div class="farmer-rank"><b>#' + f.rank + '</b><small>of ' + num(f.farmerCount) + ' farmers by uploads</small></div>' +
    '</div>';
  }

  function profileStats() {
    var f = state.farmer;
    return '<div class="stat-grid c4">' +
      UI.statCard({ label: 'Photos sent in', value: num(f.uploaded), icon: 'image', tone: 'blue',
        sub: num(f.thisWeek) + ' in the last 7 days' }) +
      UI.statCard({ label: 'In the dataset', value: num(f.approved), icon: 'database', tone: 'green',
        sub: num(f.pending) + ' still waiting to be labelled' }) +
      UI.statCard({ label: 'Kept after review', value: kept(f), icon: 'shield', tone: keptTone(f) || 'green',
        sub: plural(f.rejected, 'photo', 'photos') + ' thrown out',
        bar: f.acceptance == null ? null : { pct: f.acceptance, tone: keptTone(f) } }) +
      UI.statCard({ label: 'Their labels agree', value: f.agreement == null ? '—' : pct(f.agreement, 0),
        icon: 'check-circle', tone: 'brand', sub: 'Their own quality call matched the reviewer' }) +
    '</div>';
  }

  function galleryPanel() {
    var g = state.gallery, f = state.farmer;
    var crop = f.crops.filter(function (c) { return c.seedTypeId === g.seedTypeId; })[0];
    var status = STATUSES.filter(function (s) { return s.id === g.status; })[0] || STATUSES[0];

    var cropOptions = f.crops.map(function (c) {
      return { id: c.seedTypeId, name: c.name + ' (' + num(c.count) + ')' };
    });
    var seg = STATUSES.map(function (s) {
      return '<button type="button" data-status="' + s.id + '" aria-pressed="' + (s.id === g.status) + '">' +
        esc(s.name) + '</button>';
    }).join('');

    var tiles = g.rows.map(function (s, i) {
      var on = !!state.selected[s.id];
      var said = s.seedTypeName + ' ' + s.varietyName + ', ' +
        ((UI.statusMap[s.status] || {}).label || s.status) + (s.finalLabel ? ', ' + s.finalLabel : '');
      var corner = state.fresh[s.id]
        ? '<span class="badge badge-blue">Just added</span>'
        : s.finalLabel ? UI.labelBadge(s.finalLabel) : '';
      return '<button class="photo-card' + (state.selecting ? ' selectable' + (on ? ' picked' : '') : '') + '"' +
        ' type="button" data-photo="' + i + '" aria-label="' + esc(said) + '"' +
        (state.selecting ? ' aria-pressed="' + on + '"' : '') + '>' +
        '<div class="photo-thumb">' +
          '<img src="' + Photos.of(s) + '" alt="" loading="lazy">' + corner +
          (state.selecting
            ? '<span class="pick-box" aria-hidden="true">' + icon('check') + '</span>'
            : '<span class="photo-open">' + icon('eye') + '</span>') +
        '</div>' +
        '<div class="photo-meta">' +
          '<strong>' + esc(s.glyph) + ' ' + esc(s.seedTypeName) + '</strong>' +
          '<small>' + esc(s.varietyName) + ' · ' + UI.date(s.uploadedAt) + '</small>' +
          '<div class="gallery-foot"><span>' + esc(s.companyName) + '</span>' + UI.statusBadge(s.status) + '</div>' +
        '</div>' +
      '</button>';
    }).join('');

    var from = g.total ? (g.page - 1) * g.limit + 1 : 0;
    var to = Math.min(g.page * g.limit, g.total);

    return '<div class="card" id="f-gallery">' +
      '<div class="card-head"><div class="card-head-text">' +
        '<h2>' + (crop ? esc(crop.glyph + ' ' + crop.name) + ' photos' : 'Every photo they have sent') + '</h2>' +
        '<p>' + plural(g.total, 'photo', 'photos') + (status.id ? ' · ' + esc(status.name) : '') +
          ', latest first. ' +
          (state.selecting
            ? 'Tick the photos to delete.'
            : 'Open one for its full history, then use ← → to move through them.') + '</p></div>' +
        '<div class="f-gallery-actions">' +
          (canDelete() && (g.total || state.selecting)
            ? '<button class="btn" type="button" data-act="select">' +
                icon(state.selecting ? 'x' : 'check') + (state.selecting ? 'Done' : 'Select') + '</button>'
            : '') +
          (canAdd()
            ? '<button class="btn btn-primary" type="button" data-act="add">' + icon('upload') + 'Add photos</button>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="rq-toolbar">' +
        '<div class="filter-group"><label for="g-crop">Crop</label>' +
          '<select class="select" id="g-crop">' +
            UI.selectOptions(cropOptions, 'id', 'name', g.seedTypeId, 'Every crop (' + num(f.uploaded) + ')') +
          '</select></div>' +
        '<div class="seg" role="group" aria-label="Which photos">' + seg + '</div>' +
      '</div>' +
      (state.selecting ? selectBar() : '') +
      (g.rows.length
        ? '<div class="gallery-grid">' + tiles + '</div>'
        : UI.empty('Nothing here', 'No photos match. Try another crop or status.', 'image')) +
      (g.total ? '<div class="card-foot"><span>Showing ' + from + '–' + to + ' of ' + num(g.total) + '</span>' +
        pager(g.page, g.pages) + '</div>' : '') +
    '</div>';
  }

  function cropsCard() {
    var f = state.farmer, pick = state.gallery.seedTypeId;
    var max = f.crops.length ? f.crops[0].count : 1;
    var rows = f.crops.map(function (c) {
      return '<button class="crop-row" type="button" data-crop="' + esc(c.seedTypeId) + '"' +
        ' aria-pressed="' + (c.seedTypeId === pick) + '">' +
        '<span class="seed-glyph" aria-hidden="true">' + esc(c.glyph) + '</span>' +
        '<span class="crop-row-text"><strong>' + esc(c.name) + '</strong>' +
          '<span class="bar brand"><i style="width:' + Math.max(4, c.count / max * 100) + '%"></i></span></span>' +
        '<span class="crop-row-count">' + num(c.count) +
          '<small>' + pct(c.count / (f.uploaded || 1) * 100, 0) + '</small></span>' +
      '</button>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>What they upload</h2>' +
        '<p>' + plural(f.crops.length, 'crop', 'crops') + '. Pick one to show only those photos.</p></div></div>' +
      (rows ? '<div class="crop-list">' + rows + '</div>' : UI.empty('No uploads yet', '', 'image')) +
    '</div>';
  }

  function activityCard() {
    var weeks = state.farmer.activity;
    var total = weeks.reduce(function (a, b) { return a + b; }, 0);
    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Activity</h2>' +
        '<p>Photos sent in each week, last 12 weeks.</p></div></div>' +
      '<div class="card-body">' +
        '<div class="activity-figs">' +
          '<div><b>' + num(total) + '</b><small>in 12 weeks</small></div>' +
          '<div><b>' + num(Math.max.apply(null, weeks)) + '</b><small>busiest week</small></div>' +
          '<div><b>' + num(weeks[weeks.length - 1]) + '</b><small>this week</small></div>' +
        '</div>' +
        '<div class="activity-spark">' + UI.sparkline(weeks, 'var(--brand)', 'farmer-activity') + '</div>' +
        '<div class="activity-axis" aria-hidden="true"><span>12 weeks ago</span><span>This week</span></div>' +
        '<span class="sr-only">Photos per week, oldest first: ' + weeks.join(', ') + '</span>' +
      '</div>' +
    '</div>';
  }

  function tallyCard(title, blurb, rows, key, emptyText) {
    var body = rows.length
      ? rows.map(function (r) {
          return '<div class="info-row"><span class="k">' + esc(r[key]) + '</span><span class="v">' + num(r.count) + '</span></div>';
        }).join('')
      : '<p class="t-muted" style="margin:0;padding:8px 0;font-size:13px">' + esc(emptyText) + '</p>';
    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>' + esc(title) + '</h2><p>' + esc(blurb) + '</p></div></div>' +
      '<div class="card-body" style="padding-top:4px;padding-bottom:4px">' + body + '</div>' +
    '</div>';
  }

  function reasonsCard() {
    var f = state.farmer;
    return tallyCard('Why photos were thrown out',
      f.reasons.length ? 'The top reason is the one to raise with them.' : 'Nothing to raise with them.',
      f.reasons, 'reason', 'None of their photos has been thrown out.');
  }

  function companiesCard() {
    return tallyCard('Seed companies', 'Whose seed shows up in their photos.',
      state.farmer.companies, 'name', 'No photos yet.');
  }

  /* ---------------------------------------------------- add & delete */
  var MAX_PHOTOS = 100;            // photos and video frames added in one go
  var MAX_MB = 15;
  var MAX_EDGE = 1600;             // long side kept for an uploaded photo or frame
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var MAX_CLIPS = 10;
  var FPS_MIN = 0.1;
  var FPS_MAX = 10;
  var FPS_PRESETS = [0.5, 1, 2, 5];
  var SEEK_TIMEOUT = 10000;
  var fileKey = 0;
  var confirmKeys = null;

  function role() {
    var s = API.session();
    return s ? s.user.role : null;
  }
  /* Labellers can add photos for a farmer; only admins can delete them. */
  function canAdd() { return role() === 'admin' || role() === 'verifier'; }
  function canDelete() { return role() === 'admin'; }
  function selectedIds() { return Object.keys(state.selected); }

  /** Keeps Tab inside an open panel or dialog. */
  function trapFocus(e, box) {
    var items = Array.prototype.filter.call(box.querySelectorAll('button, input, select, textarea'), function (x) {
      return !x.disabled;
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Both reloaded together after a change, so the counts and the gallery agree. */
  function reloadProfile(view, ctx) {
    var g = state.gallery;
    return Promise.all([
      API.getFarmer(state.farmerId),
      API.searchSubmissions({
        farmerId: state.farmerId, seedTypeId: g.seedTypeId, status: g.status, page: g.page, limit: GALLERY_SIZE
      })
    ]).then(function (res) {
      if (!state) return;
      state.farmer = res[0];
      state.gallery = Object.assign({}, g, res[1]);
      if (!state.gallery.total && !selectedIds().length) state.selecting = false;
      paint(view, ctx);
    }).catch(ctx.handleError);
  }

  /* ---- selecting and deleting */
  function selectBar() {
    var n = selectedIds().length;
    var rows = state.gallery.rows;
    var allOnPage = rows.length > 0 && rows.every(function (r) { return state.selected[r.id]; });
    return '<div class="select-bar">' +
      '<span class="select-count"><b>' + num(n) + '</b> selected</span>' +
      (rows.length
        ? '<button class="btn btn-sm btn-ghost" type="button" data-sel="page">' +
            (allOnPage ? 'Unselect this page' : 'Select this page') + '</button>'
        : '') +
      (n ? '<button class="btn btn-sm btn-ghost" type="button" data-sel="clear">Clear</button>' : '') +
      '<div class="filter-spacer"></div>' +
      '<button class="btn btn-sm btn-danger" type="button" data-sel="delete"' + (n ? '' : ' disabled') + '>' +
        icon('trash') + 'Delete' + (n ? ' ' + plural(n, 'photo', 'photos') : '') + '</button>' +
    '</div>';
  }

  /** Ticks change in place — no refetch, and focus stays where it was. */
  function refreshSelection(view, focusSel) {
    view.querySelectorAll('[data-photo]').forEach(function (el) {
      var row = state.gallery.rows[parseInt(el.getAttribute('data-photo'), 10)];
      var on = !!(row && state.selected[row.id]);
      el.classList.toggle('picked', on);
      el.setAttribute('aria-pressed', String(on));
    });
    var bar = view.querySelector('.select-bar');
    if (bar) bar.outerHTML = selectBar();
    if (focusSel && !view.contains(document.activeElement)) {
      var el = view.querySelector(focusSel) || view.querySelector('[data-sel="page"]');
      if (el) el.focus();
    }
    UI.announce(plural(selectedIds().length, 'photo', 'photos') + ' selected');
  }

  function openConfirm(o, onConfirm) {
    closeConfirm();
    var back = document.activeElement;

    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = 'confirm-scrim';
    var m = document.createElement('div');
    m.className = 'modal';
    m.id = 'confirm-modal';
    m.setAttribute('role', 'alertdialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'confirm-title');
    m.setAttribute('aria-describedby', 'confirm-body');
    m.innerHTML =
      '<div class="modal-ico">' + icon('trash') + '</div>' +
      '<h2 id="confirm-title">' + esc(o.title) + '</h2>' +
      '<p id="confirm-body">' + esc(o.body) + '</p>' +
      '<div class="modal-actions">' +
        '<button class="btn" type="button" data-modal="cancel">Cancel</button>' +
        '<button class="btn btn-danger" type="button" data-modal="ok">' + icon('trash') + esc(o.confirm) + '</button>' +
      '</div>';
    document.body.appendChild(scrim);
    document.body.appendChild(m);

    var busy = false;
    var cancel = function () {
      if (busy) return;
      closeConfirm();
      if (back && document.contains(back)) back.focus();
    };
    scrim.addEventListener('click', cancel);
    m.querySelector('[data-modal="cancel"]').addEventListener('click', cancel);
    m.querySelector('[data-modal="ok"]').addEventListener('click', function () {
      if (busy) return;
      var btn = this;
      busy = true;
      btn.disabled = true;
      Promise.resolve().then(onConfirm).then(closeConfirm, function (err) {
        busy = false;
        btn.disabled = false;
        UI.toast((err && err.message) || 'Something went wrong.', 'err');
      });
    });
    confirmKeys = function (e) {
      if (e.key === 'Escape') cancel();
      else if (e.key === 'Tab') trapFocus(e, m);
    };
    document.addEventListener('keydown', confirmKeys);
    /* Cancel takes focus first: Enter on a delete dialog should not delete. */
    m.querySelector('[data-modal="cancel"]').focus();
  }

  function closeConfirm() {
    if (confirmKeys) document.removeEventListener('keydown', confirmKeys);
    confirmKeys = null;
    ['confirm-modal', 'confirm-scrim'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function confirmDelete(view, ctx) {
    var ids = selectedIds();
    if (!ids.length || !canDelete()) return;
    var what = plural(ids.length, 'photo', 'photos');
    openConfirm({
      title: 'Delete ' + what + '?',
      body: 'This removes ' + (ids.length === 1 ? 'it' : 'them') + ' from ' + state.farmer.name +
        '\'s uploads, the labelling queue and the dataset export. It cannot be undone.',
      confirm: 'Delete ' + what
    }, function () {
      return API.deleteSubmissions(ids).then(function (res) {
        if (!state) return;
        UI.toast(plural(res.deleted, 'photo', 'photos') + ' deleted', 'ok');
        state.selected = {};
        state.selecting = false;
        ctx.refreshBadges();
        return reloadProfile(view, ctx).then(function () {
          var el = view.querySelector('[data-act="select"]') || view.querySelector('[data-act="add"]') ||
            view.querySelector('#g-crop');
          if (el) el.focus();
        });
      });
    });
  }

  /* ---- adding */
  function openUpload(view, ctx) {
    if (!canAdd() || state.mode !== 'profile') return;
    var back = document.activeElement;
    var ready = state.catalogue
      ? Promise.resolve(state.catalogue)
      : Promise.resolve().then(function () {
          return Promise.all([
            API.getSeedTypes({ active: true, limit: 999 }),
            API.getVarieties({ limit: 999 }),
            API.getCompanies({ limit: 999 })
          ]);
        }).then(function (res) {
          return {
            seedTypes: res[0].rows,
            varieties: res[1].rows.filter(function (v) { return v.active; }),
            companies: res[2].rows.filter(function (c) { return c.active; })
          };
        });

    ready.then(function (cat) {
      if (!state || state.mode !== 'profile') return;
      state.catalogue = cat;
      var f = state.farmer;
      /* Start from what this farmer usually sends: the crop on screen, or
         their most-uploaded one, and the company that shows up most. */
      var seed = state.gallery.seedTypeId || (f.crops[0] ? f.crops[0].seedTypeId : null);
      if (!cat.seedTypes.some(function (s) { return s.id === seed; })) seed = null;
      var usual = f.companies[0] && cat.companies.filter(function (c) { return c.name === f.companies[0].name; })[0];

      closeUpload(false);
      state.upload = {
        files: [], seedTypeId: seed, varietyId: seed ? onlyVariety(seed) : null,
        companyId: usual ? usual.id : null, label: 'Good', busy: false, returnFocus: back,
        source: 'photos', clips: [], fps: 1, extracting: false, stop: false
      };
      mountUpload(view, ctx);
    }).catch(ctx.handleError);
  }

  /** Most crops have a single variety; pick it rather than make people choose. */
  function onlyVariety(seedTypeId) {
    var vs = state.catalogue.varieties.filter(function (v) { return v.seedTypeId === seedTypeId; });
    return vs.length === 1 ? vs[0].id : null;
  }

  /* ---- small helpers for the panel */
  function alive(u) { return !!state && state.upload === u; }

  /** Photos that still fit in this add, counting ones being read. */
  function roomLeft(u) {
    return Math.max(0, MAX_PHOTOS - u.files.filter(function (x) { return !x.error; }).length);
  }

  /** One frame from the middle of each 1/fps slice, and always at least one. */
  function framesFor(duration, fps) { return Math.max(1, Math.floor(duration * fps)); }

  function clampFps(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) n = 1;
    return Math.round(Math.min(FPS_MAX, Math.max(FPS_MIN, n)) * 10) / 10;
  }

  function fpsHint(fps) {
    return fps >= 1
      ? 'Takes ' + fps + (fps === 1 ? ' frame' : ' frames') + ' from every second of video.'
      : 'Takes one frame every ' + Math.round(10 / fps) / 10 + ' seconds.';
  }

  function clock(t, precise) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + (precise ? s.toFixed(1) : String(Math.floor(s)));
  }

  function readyText() {
    var n = state.upload.files.filter(function (x) { return x.dataUrl; }).length;
    return 'Ready to add · ' + plural(n, 'photo', 'photos');
  }

  /* ---- panel parts */
  function uploadSource() {
    var u = state.upload;
    var tabs = [['photos', 'image', 'Photos'], ['videos', 'video', 'Video clips']].map(function (s) {
      return '<button type="button" id="u-src-' + s[0] + '" data-u-src="' + s[0] + '"' +
        ' aria-pressed="' + (u.source === s[0]) + '"' + (u.busy ? ' disabled' : '') + '>' + icon(s[1]) + s[2] + '</button>';
    }).join('');
    return '<div data-part="source">' +
      '<div class="seg u-src" role="group" aria-label="Add from">' + tabs + '</div>' +
      (u.source === 'videos' ? videoSource() : photoSource()) +
    '</div>';
  }

  function photoSource() {
    var u = state.upload;
    return '<label class="dropzone" for="u-files">' + icon('upload') +
      '<strong>Drop photos here or <span class="dz-link">browse</span></strong>' +
      '<small>JPG, PNG or WebP · up to ' + MAX_PHOTOS + ' at a time · ' + MAX_MB + ' MB each</small>' +
      '<input class="sr-only" type="file" id="u-files" accept="' + TYPES.join(',') + '" multiple' +
        (u.busy ? ' disabled' : '') + '>' +
    '</label>';
  }

  function videoSource() {
    var u = state.upload;
    var dis = u.busy ? ' disabled' : '';
    var ready = u.clips.filter(function (c) { return c.status === 'ready'; });
    var planned = ready.reduce(function (n, c) { return n + framesFor(c.duration, u.fps); }, 0);
    var room = roomLeft(u);

    var presets = FPS_PRESETS.map(function (p) {
      return '<button type="button" id="u-fps-' + String(p).replace('.', '-') + '" data-u-fps="' + p + '"' +
        ' aria-pressed="' + (u.fps === p) + '"' + dis + '>' + p + '</button>';
    }).join('');

    var summary = u.extracting ? 'Taking frames. You can fill in the crop and company meanwhile.'
      : ready.length
        ? plural(ready.length, 'clip', 'clips') + ' · about ' + plural(planned, 'frame', 'frames') +
          (planned > room ? '. Only ' + num(room) + ' more fit in one add.' : '.')
      : u.clips.some(function (c) { return c.status === 'reading'; }) ? 'Reading clips…'
      : u.clips.some(function (c) { return c.status === 'done'; }) ? 'Frames are in the list below.'
      : 'None of these clips can be read.';

    var button = u.extracting
      ? '<button class="btn" type="button" id="u-extract" data-u="stop"' + (u.stop ? ' disabled' : '') + '>' +
          icon('x') + (u.stop ? 'Stopping…' : 'Stop') + '</button>'
      : '<button class="btn btn-primary" type="button" id="u-extract" data-u="extract"' +
          (ready.length && room > 0 && !u.busy ? '' : ' disabled') + '>' + icon('image') +
          'Extract ' + (ready.length ? plural(Math.min(planned, room), 'frame', 'frames') : 'frames') + '</button>';

    return '<label class="dropzone" for="u-clips">' + icon('video') +
        '<strong>Drop video clips here or <span class="dz-link">browse</span></strong>' +
        '<small>MP4, WebM or MOV · pick several at once · frames are taken in your browser</small>' +
        '<input class="sr-only" type="file" id="u-clips" accept="video/mp4,video/webm,video/quicktime,video/*" multiple' + dis + '>' +
      '</label>' +
      (u.clips.length ? '<ul class="u-clips">' + u.clips.map(clipRow).join('') + '</ul>' : '') +
      '<div class="u-fps">' +
        '<div class="u-fps-row">' +
          '<label for="u-fps">Frames per second</label>' +
          '<div class="seg" role="group" aria-label="Common rates">' + presets + '</div>' +
          '<input class="input u-fps-input" type="number" id="u-fps" min="' + FPS_MIN + '" max="' + FPS_MAX + '"' +
            ' step="0.1" value="' + u.fps + '"' + dis + '>' +
        '</div>' +
        '<small class="t-muted">' + esc(fpsHint(u.fps)) + '</small>' +
      '</div>' +
      (u.clips.length ? '<div class="u-extract"><span>' + esc(summary) + '</span>' + button + '</div>' : '');
  }

  function clipRow(c) {
    var u = state.upload;
    var info = c.duration ? clock(c.duration) + ' · ' + num(c.width) + '×' + num(c.height) : '';
    var meta = c.status === 'reading' ? 'Reading clip…'
      : c.status === 'error' ? c.error
      : info + (c.note ? ' · ' + c.note : '');
    var side = '', bar = '';
    if (c.status === 'ready') {
      side = '<span class="u-clip-side">≈ ' + plural(framesFor(c.duration, u.fps), 'frame', 'frames') + '</span>';
    } else if (c.status === 'queued') {
      side = '<span class="u-clip-side t-muted">Waiting</span>';
    } else if (c.status === 'extracting') {
      var total = c.total || framesFor(c.duration, c.fps);
      var share = Math.round(c.done / total * 100);
      side = '<span class="u-clip-side">' + num(c.done) + ' / ' + num(total) + '</span>';
      bar = '<span class="bar brand" role="progressbar" aria-label="' + esc(c.name) + '" aria-valuemin="0"' +
        ' aria-valuemax="100" aria-valuenow="' + share + '"><i style="width:' + share + '%"></i></span>';
    } else if (c.status === 'done') {
      side = '<span class="u-clip-side ok">' + icon('check-circle') + plural(c.done, 'frame', 'frames') + '</span>';
    }
    return '<li class="u-clip' + (c.status === 'error' ? ' bad' : '') + '" id="u-clip-' + c.key + '">' +
      (c.poster
        ? '<img src="' + c.poster + '" alt="">'
        : '<span class="u-file-ph">' + icon(c.status === 'error' ? 'alert' : 'video') + '</span>') +
      '<span class="u-file-text"><strong>' + esc(c.name) + '</strong><small>' + esc(meta) + '</small>' + bar + '</span>' +
      side +
      '<button class="icon-btn" type="button" id="u-clip-rm-' + c.key + '" data-u-clip-remove="' + c.key + '"' +
        ' aria-label="' + esc(c.status === 'done' ? 'Remove ' + c.name + ' and its frames' : 'Remove ' + c.name) + '"' +
        (c.status === 'extracting' || u.busy ? ' disabled' : '') + '>' + icon('x') + '</button>' +
    '</li>';
  }

  function fileTile(x) {
    var u = state.upload;
    var caption = x.error ? x.error
      : !x.dataUrl ? 'Reading…'
      : x.clipKey ? x.name.slice(x.name.lastIndexOf(' · ') + 3)
      : num(x.width) + '×' + num(x.height);
    return '<li class="u-tile' + (x.error ? ' bad' : '') + '" id="u-tile-' + x.key + '"' +
      ' title="' + esc(x.name + (x.error ? ' — ' + x.error : '')) + '">' +
      (x.dataUrl
        ? '<img src="' + x.dataUrl + '" alt="">'
        : '<span class="u-tile-ph">' + icon(x.error ? 'alert' : 'image') + '</span>') +
      (x.clipKey ? '<span class="u-tile-tag" aria-hidden="true">' + icon('video') + '</span>' : '') +
      '<button class="u-tile-rm" type="button" id="u-rm-' + x.key + '" data-u-remove="' + x.key + '"' +
        ' aria-label="Remove ' + esc(x.name) + '"' + (u.busy ? ' disabled' : '') + '>' + icon('x') + '</button>' +
      '<small>' + esc(caption) + '</small>' +
    '</li>';
  }

  function uploadList() {
    var u = state.upload;
    if (!u.files.length) return '<div data-part="list"></div>';
    return '<div data-part="list">' +
      '<div class="u-list-head"><span class="sec-title" id="u-ready-count">' + esc(readyText()) + '</span>' +
        '<button class="btn-link" type="button" id="u-clear" data-u="clear"' +
          (u.busy || u.extracting ? ' disabled' : '') + '>Remove all</button></div>' +
      '<ul class="u-tiles">' + u.files.map(fileTile).join('') + '</ul>' +
    '</div>';
  }

  /* In-place updates while frames stream in, so the grid is not rebuilt
     for every frame. */
  function updateClip(clip) {
    var el = document.getElementById('u-clip-' + clip.key);
    if (el && state && state.upload) el.outerHTML = clipRow(clip);
  }

  function updateTile(entry) {
    var el = document.getElementById('u-tile-' + entry.key);
    if (el) el.outerHTML = fileTile(entry);
    var count = document.getElementById('u-ready-count');
    if (count) count.textContent = readyText();
  }

  function appendTile(entry) {
    var d = document.getElementById('upload-drawer');
    var ul = d && d.querySelector('[data-part="list"] .u-tiles');
    if (!ul) { repaintUpload(['list']); return; }
    ul.insertAdjacentHTML('beforeend', fileTile(entry));
    var count = document.getElementById('u-ready-count');
    if (count) count.textContent = readyText();
  }

  function uploadMeta() {
    var u = state.upload, f = state.farmer, cat = state.catalogue;
    var theirs = f.crops.map(function (c) { return c.seedTypeId; });
    var mine = cat.seedTypes.filter(function (s) { return theirs.indexOf(s.id) > -1; });
    var others = cat.seedTypes.filter(function (s) { return theirs.indexOf(s.id) === -1; });
    var opt = function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === u.seedTypeId ? ' selected' : '') + '>' +
        esc(s.glyph + '  ' + s.name) + '</option>';
    };
    var varieties = cat.varieties.filter(function (v) { return v.seedTypeId === u.seedTypeId; });
    var labels = [['Good', 'var(--green)'], ['Normal', 'var(--amber)'], ['Bad', 'var(--red)']].map(function (l) {
      return '<button type="button" id="u-label-' + l[0] + '" data-u-label="' + l[0] + '"' +
        ' aria-pressed="' + (u.label === l[0]) + '"' + (u.busy ? ' disabled' : '') + '>' +
        '<i class="badge-dot" style="background:' + l[1] + ';width:8px;height:8px"></i>' + l[0] + '</button>';
    }).join('');
    var off = u.busy ? ' disabled' : '';

    return '<div data-part="meta">' +
      '<div class="sec-title">About these photos</div>' +
      '<div class="field"><label for="u-crop">Crop</label>' +
        '<select class="select" id="u-crop"' + off + '><option value="">Choose a crop</option>' +
          (mine.length ? '<optgroup label="Crops they already send">' + mine.map(opt).join('') + '</optgroup>' : '') +
          '<optgroup label="' + (mine.length ? 'Other crops' : 'All crops') + '">' + others.map(opt).join('') + '</optgroup>' +
        '</select></div>' +
      '<div class="field"><label for="u-variety">Variety</label>' +
        '<select class="select" id="u-variety"' + (u.seedTypeId && !u.busy ? '' : ' disabled') + '>' +
          UI.selectOptions(varieties, 'id', 'name', u.varietyId, u.seedTypeId ? 'Choose a variety' : 'Pick a crop first') +
        '</select></div>' +
      '<div class="field"><label for="u-company">Seed company</label>' +
        '<select class="select" id="u-company"' + off + '>' +
          UI.selectOptions(cat.companies, 'id', 'name', u.companyId, 'Choose a company') + '</select></div>' +
      '<div class="field"><span class="field-label" id="u-label-name">Farmer\'s quality call</span>' +
        '<div class="seg" role="group" aria-labelledby="u-label-name">' + labels + '</div>' +
        '<small class="t-muted">A reviewer still makes the final call when labelling.</small></div>' +
      '<div class="note">' + icon('info') + '<span>Photos are credited to ' + esc(f.name) +
        ' and join the labelling queue as <b>Waiting</b>.</span></div>' +
    '</div>';
  }

  function uploadFoot() {
    var u = state.upload;
    var ready = u.files.filter(function (x) { return x.dataUrl; });
    var reading = u.files.some(function (x) { return !x.dataUrl && !x.error; });
    var hint = u.extracting ? 'Taking frames from your clips…'
      : !u.files.length
        ? (u.clips.some(function (c) { return c.status === 'ready'; })
            ? 'Extract frames from your clips first.' : 'Add photos or video clips.')
      : reading ? 'Reading photos…'
      : !ready.length ? 'None of these can be added.'
      : !u.varietyId ? 'Choose the crop and variety.'
      : !u.companyId ? 'Choose the seed company.'
      : plural(ready.length, 'photo', 'photos') + ' ready' +
        (ready.length < u.files.length ? ', ' + num(u.files.length - ready.length) + ' skipped' : '') + '.';
    var blocked = u.extracting || reading || !ready.length || !u.varietyId || !u.companyId || u.busy;

    return '<div class="drawer-foot" data-part="foot">' +
      '<span class="drawer-foot-hint">' + esc(hint) + '</span>' +
      '<button class="btn" type="button" id="u-cancel" data-u="cancel"' + (u.busy ? ' disabled' : '') + '>Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="u-submit" data-u="submit"' + (blocked ? ' disabled' : '') + '>' +
        icon('plus') + (u.busy ? 'Adding…' : 'Add ' + (ready.length ? plural(ready.length, 'photo', 'photos') : 'photos')) +
      '</button>' +
    '</div>';
  }

  var UPLOAD_PARTS = { source: uploadSource, list: uploadList, meta: uploadMeta, foot: uploadFoot };

  /** Repaints only the parts that changed, so a photo finishing loading
      does not close a dropdown someone has open. */
  function repaintUpload(parts) {
    var d = document.getElementById('upload-drawer');
    if (!d || !state || !state.upload) return;
    var active = document.activeElement;
    var id = active && d.contains(active) ? active.id : null;
    parts.forEach(function (p) {
      var el = d.querySelector('[data-part="' + p + '"]');
      if (el) el.outerHTML = UPLOAD_PARTS[p]();
    });
    if (id && !d.contains(active)) {
      var again = document.getElementById(id);
      var fallback = again && !again.disabled ? again
        : d.querySelector('#u-files') || d.querySelector('#u-clips') || d.querySelector('#u-close');
      if (fallback) fallback.focus();
    }
  }

  function mountUpload(view, ctx) {
    var f = state.farmer;
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = 'upload-scrim';
    var d = document.createElement('aside');
    d.className = 'drawer upload-drawer';
    d.id = 'upload-drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'upload-title');
    d.innerHTML =
      '<div class="drawer-head">' + avatar(f, 'avatar-sm') +
        '<div style="flex:1;min-width:0"><h2 id="upload-title">Add photos</h2>' +
          '<p>For ' + esc(f.name) + ' · ' + esc(f.region) + '</p></div>' +
        '<button class="icon-btn" type="button" id="u-close" data-u="cancel" aria-label="Close">' + icon('x') + '</button>' +
      '</div>' +
      '<div class="drawer-body">' + uploadSource() + uploadList() + uploadMeta() + '</div>' +
      uploadFoot();
    document.body.appendChild(scrim);
    document.body.appendChild(d);

    var cancel = requestClose;
    scrim.addEventListener('click', cancel);

    /* A photo dropped anywhere on the panel counts. One dropped beside it
       must not make the browser navigate away to the file. */
    [scrim, d].forEach(function (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        var z = d.querySelector('.dropzone');
        if (z) z.classList.toggle('over', zone === d);
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        var z = d.querySelector('.dropzone');
        if (z) z.classList.remove('over');
        if (zone === d && e.dataTransfer && e.dataTransfer.files.length) addDropped(e.dataTransfer.files);
      });
    });
    d.addEventListener('dragleave', function (e) {
      if (d.contains(e.relatedTarget)) return;
      var z = d.querySelector('.dropzone');
      if (z) z.classList.remove('over');
    });

    d.addEventListener('click', function (e) {
      var u = state && state.upload;
      var t = e.target.closest('[data-u], [data-u-label], [data-u-remove], [data-u-src], [data-u-fps], [data-u-clip-remove]');
      if (!u || !t || t.disabled) return;
      if (t.hasAttribute('data-u-label')) {
        u.label = t.getAttribute('data-u-label');
        repaintUpload(['meta']);
      } else if (t.hasAttribute('data-u-src')) {
        u.source = t.getAttribute('data-u-src');
        repaintUpload(['source']);
      } else if (t.hasAttribute('data-u-fps')) {
        u.fps = clampFps(t.getAttribute('data-u-fps'));
        repaintUpload(['source']);
      } else if (t.hasAttribute('data-u-remove')) {
        var key = t.getAttribute('data-u-remove');
        u.files = u.files.filter(function (x) { return x.key !== key; });
        repaintUpload(['source', 'list', 'foot']);
      } else if (t.hasAttribute('data-u-clip-remove')) {
        removeClip(t.getAttribute('data-u-clip-remove'));
      } else {
        var act = t.getAttribute('data-u');
        if (act === 'cancel') cancel();
        else if (act === 'extract') extractAll();
        else if (act === 'stop') { u.stop = true; repaintUpload(['source']); }
        else if (act === 'clear') {
          /* Clips that gave frames can give them again after a clear. */
          u.files = [];
          u.clips.forEach(function (c) {
            if (c.status === 'done') { c.status = 'ready'; c.done = 0; c.note = null; }
          });
          repaintUpload(['source', 'list', 'foot']);
        } else if (act === 'submit') submitUpload(view, ctx);
      }
    });

    d.addEventListener('change', function (e) {
      var u = state && state.upload, t = e.target;
      if (!u) return;
      if (t.id === 'u-files' || t.id === 'u-clips') {
        (t.id === 'u-files' ? addFiles : addClips)(t.files);
        t.value = '';            // picking the same file again still fires
      } else if (t.id === 'u-fps') {
        u.fps = clampFps(t.value);
        repaintUpload(['source']);
      } else if (t.id === 'u-crop') {
        u.seedTypeId = t.value || null;
        u.varietyId = u.seedTypeId ? onlyVariety(u.seedTypeId) : null;
        repaintUpload(['meta', 'foot']);
      } else if (t.id === 'u-variety' || t.id === 'u-company') {
        u[t.id === 'u-variety' ? 'varietyId' : 'companyId'] = t.value || null;
        repaintUpload(['foot']);
      }
    });

    document.addEventListener('keydown', uploadKeys);
    d.querySelector('#u-files').focus();
  }

  function uploadKeys(e) {
    var d = document.getElementById('upload-drawer');
    if (!d || !state || !state.upload) return;
    if (e.key === 'Escape') requestClose();
    else if (e.key === 'Tab') trapFocus(e, d);
  }

  function closeUpload(restoreFocus) {
    document.removeEventListener('keydown', uploadKeys);
    ['upload-drawer', 'upload-scrim'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    var back = state && state.upload && state.upload.returnFocus;
    if (state) state.upload = null;
    if (restoreFocus && back && document.contains(back)) back.focus();
  }

  /** Closing throws away what was picked, so ask first when there is something to lose. */
  function requestClose() {
    var u = state && state.upload;
    if (!u || u.busy) return;
    var n = u.files.filter(function (x) { return x.dataUrl; }).length;
    if ((n || u.extracting) && !window.confirm('Close without adding? ' +
        (n ? plural(n, 'photo', 'photos') + ' you picked will be discarded.' : 'Taking frames will stop.'))) return;
    closeUpload(true);
  }

  function isVideo(file) {
    return /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name || '');
  }

  /** A drop can hold photos and clips together; each goes where it belongs. */
  function addDropped(list) {
    var files = Array.prototype.slice.call(list || []);
    var clips = files.filter(isVideo);
    var photos = files.filter(function (f) { return !isVideo(f); });
    if (clips.length) {
      state.upload.source = 'videos';
      addClips(clips);
    }
    if (photos.length) addFiles(photos);
  }

  function addFiles(list) {
    var u = state && state.upload;
    if (!u || u.busy) return;
    var picked = Array.prototype.slice.call(list || []);
    var room = roomLeft(u);
    if (picked.length > room) {
      UI.toast('Up to ' + MAX_PHOTOS + ' photos at a time. ' +
        plural(picked.length - room, 'file was', 'files were') + ' left out.', 'err');
    }
    picked.slice(0, room).forEach(function (file) {
      var entry = { key: 'f' + (++fileKey), name: file.name || 'photo', dataUrl: null, width: 0, height: 0, error: null };
      u.files.push(entry);
      if (TYPES.indexOf(file.type) === -1) { entry.error = 'Not a JPG, PNG or WebP image'; return; }
      if (file.size > MAX_MB * 1048576) { entry.error = 'Bigger than ' + MAX_MB + ' MB'; return; }
      readImage(file).then(function (img) {
        entry.dataUrl = img.dataUrl;
        entry.width = img.width;
        entry.height = img.height;
      }, function () {
        entry.error = 'Could not be read as an image';
      }).then(function () {
        if (!alive(u)) return;
        updateTile(entry);
        repaintUpload(entry.error ? ['source', 'foot'] : ['foot']);
      });
    });
    repaintUpload(['source', 'list', 'foot']);
  }

  /** Draws a photo or a video frame into a JPEG no larger than `edge` on its long side. */
  function toJpeg(source, w, h, edge) {
    var scale = Math.min(1, edge / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var g = c.getContext('2d');
    g.fillStyle = '#fff';            // transparent PNGs would otherwise turn black
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  /** Reads a photo and keeps a scaled-down JPEG copy. The original size is what gets recorded. */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var src = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        URL.revokeObjectURL(src);
        resolve({ dataUrl: toJpeg(img, w, h, MAX_EDGE), width: w, height: h });
      };
      img.onerror = function () {
        URL.revokeObjectURL(src);
        reject(new Error('unreadable'));
      };
      img.src = src;
    });
  }

  /* ---- video clips */
  function addClips(list) {
    var u = state && state.upload;
    if (!u || u.busy) return;
    var picked = Array.prototype.slice.call(list || []);
    var room = Math.max(0, MAX_CLIPS - u.clips.length);
    if (picked.length > room) {
      UI.toast('Up to ' + MAX_CLIPS + ' clips at a time. ' +
        plural(picked.length - room, 'clip was', 'clips were') + ' left out.', 'err');
    }
    picked.slice(0, room).forEach(function (file) {
      var clip = {
        key: 'c' + (++fileKey), file: file, name: file.name || 'clip', status: 'reading',
        duration: 0, width: 0, height: 0, poster: null, fps: u.fps, done: 0, total: 0, error: null, note: null
      };
      u.clips.push(clip);
      if (!isVideo(file)) { clip.status = 'error'; clip.error = 'Not a video file'; return; }
      loadClip(file).then(function (info) {
        clip.duration = info.duration;
        clip.width = info.width;
        clip.height = info.height;
        clip.poster = info.poster;
        clip.status = 'ready';
      }, function (err) {
        clip.status = 'error';
        clip.error = err.message;
      }).then(function () {
        if (alive(u)) repaintUpload(['source', 'foot']);
      });
    });
    repaintUpload(['source', 'foot']);
  }

  /** A clip that already gave frames takes them with it. */
  function removeClip(key) {
    var u = state.upload;
    var clip = u.clips.filter(function (c) { return c.key === key; })[0];
    if (!clip || clip.status === 'extracting') return;
    u.clips = u.clips.filter(function (c) { return c !== clip; });
    u.files = u.files.filter(function (x) { return x.clipKey !== key; });
    repaintUpload(['source', 'list', 'foot']);
  }

  function seek(v, t) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { done(); reject(new Error('The video stopped responding')); }, SEEK_TIMEOUT);
      function done() {
        clearTimeout(timer);
        v.removeEventListener('seeked', onSeeked);
        v.removeEventListener('error', onError);
      }
      function onSeeked() { done(); resolve(); }
      function onError() { done(); reject(new Error('Could not read this clip')); }
      v.addEventListener('seeked', onSeeked);
      v.addEventListener('error', onError);
      v.currentTime = t;
    });
  }

  function closeVideo(o) {
    o.video.removeAttribute('src');
    o.video.load();
    URL.revokeObjectURL(o.src);
  }

  /** Opens a clip off-screen, ready to seek, once its length is known. */
  function openVideo(file) {
    return new Promise(function (resolve, reject) {
      var src = URL.createObjectURL(file);
      var v = document.createElement('video');
      var o = { video: v, src: src };
      var timer = setTimeout(function () { fail(new Error('This clip took too long to open')); }, SEEK_TIMEOUT);
      function settle() {
        clearTimeout(timer);
        v.onloadeddata = v.onerror = null;
      }
      function fail(err) {
        settle();
        closeVideo(o);
        reject(err);
      }
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onerror = function () {
        fail(new Error(v.error && v.error.code === 4
          ? 'This browser cannot play this video format' : 'Could not read this clip'));
      };
      v.onloadeddata = function () {
        settle();
        if (!v.videoWidth) { fail(new Error('This clip has no picture')); return; }
        if (isFinite(v.duration) && v.duration > 0) { resolve(o); return; }
        /* Clips recorded in a browser often report no length until the end is sought. */
        seek(v, 1e7).then(function () {
          if (isFinite(v.duration) && v.duration > 0) resolve(o);
          else fail(new Error('Could not tell how long this clip is'));
        }, fail);
      };
      v.src = src;
    });
  }

  /** Length, size and a small poster frame, read as soon as a clip is picked. */
  function loadClip(file) {
    return openVideo(file).then(function (o) {
      var v = o.video;
      return seek(v, Math.min(1, v.duration / 10)).then(function () {
        var info = {
          duration: v.duration, width: v.videoWidth, height: v.videoHeight,
          poster: toJpeg(v, v.videoWidth, v.videoHeight, 160)
        };
        closeVideo(o);
        return info;
      }, function (err) {
        closeVideo(o);
        throw err;
      });
    });
  }

  /** Takes one clip's frames, one seek at a time, straight into the list.
      Resolves with why it ended: 'done', 'stopped' or 'full'. */
  function extractClip(u, clip) {
    var live = function () { return alive(u) && !u.stop && u.clips.indexOf(clip) > -1; };
    return openVideo(clip.file).then(function (o) {
      var v = o.video;
      var count = framesFor(v.duration, clip.fps);
      var i = 0;
      clip.total = count;
      clip.done = 0;
      updateClip(clip);

      function next() {
        if (!live()) return 'stopped';
        if (i >= count) return 'done';
        if (roomLeft(u) <= 0) return 'full';
        var t = Math.min((i + 0.5) / clip.fps, Math.max(0, v.duration - 0.05));
        return seek(v, t).then(function () {
          if (!live()) return 'stopped';
          var at = clock(t, true);
          var entry = {
            key: 'f' + (++fileKey), name: clip.name + ' · ' + at,
            dataUrl: toJpeg(v, v.videoWidth, v.videoHeight, MAX_EDGE),
            width: v.videoWidth, height: v.videoHeight, error: null,
            clipKey: clip.key, from: clip.name + ' at ' + at
          };
          u.files.push(entry);
          i++;
          clip.done++;
          appendTile(entry);
          updateClip(clip);
          repaintUpload(['foot']);
          return next();
        });
      }

      return Promise.resolve(next()).then(function (how) {
        closeVideo(o);
        return how;
      }, function (err) {
        closeVideo(o);
        throw err;
      });
    });
  }

  /** Works through every clip still waiting, one after another. */
  function extractAll() {
    var u = state.upload;
    var queue = u.clips.filter(function (c) { return c.status === 'ready'; });
    if (u.extracting || u.busy || !queue.length) return;
    u.extracting = true;
    u.stop = false;
    queue.forEach(function (c) { c.status = 'queued'; c.fps = u.fps; c.note = null; });
    repaintUpload(['source', 'list', 'foot']);

    var full = false;
    queue.reduce(function (chain, clip) {
      return chain.then(function () {
        if (!alive(u) || u.stop || full || u.clips.indexOf(clip) === -1) return;
        clip.status = 'extracting';
        updateClip(clip);
        return extractClip(u, clip).then(function (how) {
          if (how === 'full') { full = true; clip.note = 'stopped at the ' + MAX_PHOTOS + '-photo limit'; }
          else if (how === 'stopped' && clip.done < clip.total) clip.note = 'stopped early';
          clip.status = clip.done ? 'done' : 'ready';
        }, function (err) {
          if (clip.done) { clip.status = 'done'; clip.note = err.message; }
          else { clip.status = 'error'; clip.error = err.message; }
        }).then(function () {
          if (alive(u)) updateClip(clip);
        });
      });
    }, Promise.resolve()).then(function () {
      if (!alive(u)) return;
      var taken = queue.reduce(function (n, c) { return n + c.done; }, 0);
      u.extracting = false;
      u.stop = false;
      u.clips.forEach(function (c) { if (c.status === 'queued') c.status = 'ready'; });
      if (full) UI.toast('Stopped at ' + MAX_PHOTOS + ' photos. Add these first, then take frames from the rest.', 'err');
      else if (taken) UI.toast(plural(taken, 'frame', 'frames') + ' taken from your clips', 'ok');
      repaintUpload(['source', 'list', 'foot']);
    });
  }

  function submitUpload(view, ctx) {
    var u = state.upload;
    var ready = u.files.filter(function (x) { return x.dataUrl; });
    if (u.busy || u.extracting || !ready.length || !u.varietyId || !u.companyId) return;
    u.busy = true;
    repaintUpload(['source', 'list', 'meta', 'foot']);

    Promise.resolve().then(function () {
      return API.addSubmissions(state.farmerId, {
        varietyId: u.varietyId, companyId: u.companyId, label: u.label,
        images: ready.map(function (x) {
          return { dataUrl: x.dataUrl, width: x.width, height: x.height, from: x.from || null };
        })
      });
    }).then(function (res) {
      if (!state) return;
      closeUpload(false);
      res.rows.forEach(function (r) { state.fresh[r.id] = true; });
      UI.toast(plural(res.rows.length, 'photo', 'photos') + ' added for ' + state.farmer.name, 'ok');
      ctx.refreshBadges();
      /* Show what was just added: newest first, whatever the filters were. */
      if (state.gallery.seedTypeId && state.gallery.seedTypeId !== u.seedTypeId) state.gallery.seedTypeId = null;
      if (state.gallery.status && state.gallery.status !== 'pending_verification') state.gallery.status = '';
      state.gallery.page = 1;
      return reloadProfile(view, ctx).then(focusOn(view, '#f-gallery [data-photo="0"]'));
    }).catch(function (err) {
      if (state && state.upload === u) {
        u.busy = false;
        repaintUpload(['source', 'list', 'meta', 'foot']);
      }
      ctx.handleError(err);
    });
  }

  /* ---------------------------------------------------- paint */
  function paint(view, ctx) {
    if (state.mode === 'profile') {
      view.innerHTML = backButton() + profileHero() + profileStats() +
        '<div class="do-layout">' +
          '<div class="f-stack">' + galleryPanel() + '</div>' +
          '<div class="f-stack">' + cropsCard() + activityCard() + reasonsCard() + companiesCard() + '</div>' +
        '</div>';
    } else {
      view.innerHTML =
        '<div class="page-head"><div class="page-head-text">' +
          '<h1>Farmers directory</h1>' +
          '<p>Everyone sending photos in — what they upload, and how much of it makes it into the dataset.</p>' +
        '</div></div>' +
        listStats() + listBar() + listPanel();
    }
    wire(view, ctx);
  }

  /** Element listeners, bound again after every paint. */
  function wire(view, ctx) {
    var $ = function (id) { return view.querySelector('#' + id); };

    var back = $('f-back');
    if (back) back.addEventListener('click', function () { ctx.navigate('#/farmers'); });

    var q = $('f-q');
    if (q) q.addEventListener('input', function () {
      clearTimeout(state.timer);
      var v = q.value;
      state.timer = setTimeout(function () {
        state.search = v;
        state.list.page = 1;
        loadList(view, ctx).then(function () {
          var again = view.querySelector('#f-q');
          if (again) { again.focus(); again.setSelectionRange(v.length, v.length); }
        });
      }, 280);
    });

    var FIELDS = { 'f-crop': 'seedTypeId', 'f-region': 'region', 'f-sort': 'sort' };
    Object.keys(FIELDS).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        state.filters[FIELDS[id]] = this.value || null;
        state.list.page = 1;
        loadList(view, ctx).then(focusOn(view, '#' + id));
      });
    });

    var crop = $('g-crop');
    if (crop) crop.addEventListener('change', function () {
      filterGallery(view, ctx, { seedTypeId: this.value || null }, '#g-crop');
    });
  }

  /* Delegated handlers sit on `view`, which outlives every paint and
     every visit, so they are bound once per visit and go quiet when
     it ends. */
  function delegate(view, ctx) {
    var visit = state;
    var live = function (fn) {
      return function (e, el) { if (state && state === visit) fn(e, el); };
    };

    UI.on(view, 'click', '[data-farmer]', live(function (e, el) {
      ctx.navigate('#/farmers?id=' + encodeURIComponent(el.getAttribute('data-farmer')));
    }));

    UI.on(view, 'click', '[data-layout]', live(function (e, el) {
      state.layout = el.getAttribute('data-layout');
      writeLayout(state.layout);
      paint(view, ctx);
      focusOn(view, '[data-layout="' + state.layout + '"]')();
    }));

    UI.on(view, 'click', '.pager button[data-fpage]', live(function (e, el) {
      var p = parseInt(el.getAttribute('data-fpage'), 10);
      if (isNaN(p)) return;
      var profile = state.mode === 'profile';
      if (profile) state.gallery.page = p; else state.list.page = p;
      (profile ? loadGallery : loadList)(view, ctx).then(function () {
        /* Start the new page from its top rather than at the pager. */
        var top = view.querySelector(profile ? '#f-gallery' : '#f-results');
        if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
      });
    }));

    UI.on(view, 'click', '[data-status]', live(function (e, el) {
      var v = el.getAttribute('data-status');
      filterGallery(view, ctx, { status: v }, '[data-status="' + v + '"]');
    }));

    UI.on(view, 'click', '[data-crop]', live(function (e, el) {
      var id = el.getAttribute('data-crop');
      /* Picking the crop already shown goes back to every crop. */
      filterGallery(view, ctx, { seedTypeId: state.gallery.seedTypeId === id ? null : id }, '[data-crop="' + id + '"]');
    }));

    UI.on(view, 'click', '[data-photo]', live(function (e, el) {
      var i = parseInt(el.getAttribute('data-photo'), 10);
      var row = state.gallery.rows[i];
      if (!row) return;
      if (!state.selecting) {
        DatasetView.openImage(row.id, galleryNav(view, ctx, i));
        return;
      }
      if (state.selected[row.id]) delete state.selected[row.id];
      else state.selected[row.id] = true;
      refreshSelection(view, '[data-photo="' + i + '"]');
    }));

    UI.on(view, 'click', '[data-act]', live(function (e, el) {
      if (el.getAttribute('data-act') === 'add') { openUpload(view, ctx); return; }
      state.selecting = !state.selecting;
      state.selected = {};
      paint(view, ctx);
      focusOn(view, '[data-act="select"]')();
      UI.announce(state.selecting ? 'Selecting photos. Tick the ones to delete.' : 'Stopped selecting photos.');
    }));

    UI.on(view, 'click', '[data-sel]', live(function (e, el) {
      var act = el.getAttribute('data-sel');
      if (act === 'delete') { confirmDelete(view, ctx); return; }
      if (act === 'clear') state.selected = {};
      if (act === 'page') {
        var rows = state.gallery.rows;
        var all = rows.every(function (r) { return state.selected[r.id]; });
        rows.forEach(function (r) {
          if (all) delete state.selected[r.id];
          else state.selected[r.id] = true;
        });
      }
      refreshSelection(view, '[data-sel="' + act + '"]');
    }));
  }

  function filterGallery(view, ctx, change, focusSel) {
    Object.keys(change).forEach(function (k) { state.gallery[k] = change[k]; });
    state.gallery.page = 1;
    loadGallery(view, ctx).then(focusOn(view, focusSel));
  }

  /** Lets the image drawer walk through this farmer's photos, loading the
      next or previous page when it runs off the end of this one. */
  function galleryNav(view, ctx, index) {
    var g = state.gallery;
    var position = (g.page - 1) * g.limit + index + 1;
    return {
      position: position,
      total: g.total,
      go: function (step) {
        if (!state || state.mode !== 'profile') return;
        if (position + step < 1 || position + step > g.total) return;
        var i = index + step;
        if (i >= 0 && i < g.rows.length) {
          DatasetView.openImage(g.rows[i].id, galleryNav(view, ctx, i), step);
          return;
        }
        state.gallery.page = g.page + step;
        loadGallery(view, ctx).then(function () {
          var rows = state && state.gallery.rows;
          if (!rows || !rows.length) return;
          var j = step > 0 ? 0 : rows.length - 1;
          DatasetView.openImage(rows[j].id, galleryNav(view, ctx, j), step);
        });
      }
    };
  }

  /* ---------------------------------------------------- data */
  function loadList(view, ctx) {
    var f = state.filters;
    return API.getFarmers({
      search: state.search, region: f.region, seedTypeId: f.seedTypeId, sort: f.sort,
      page: state.list.page, limit: LIST_SIZE
    }).then(function (data) {
      if (!state) return;            // the view was left while this was in flight
      state.list = data;
      paint(view, ctx);
    }).catch(ctx.handleError);
  }

  function loadGallery(view, ctx) {
    var g = state.gallery;
    return API.searchSubmissions({
      farmerId: state.farmerId, seedTypeId: g.seedTypeId, status: g.status,
      page: g.page, limit: GALLERY_SIZE
    }).then(function (data) {
      if (!state) return;
      state.gallery = Object.assign({}, g, data);
      paint(view, ctx);
    }).catch(ctx.handleError);
  }

  function render(view, ctx, params) {
    var profile = !!params.id;
    /* A link that names its own filters wins over the remembered ones. */
    var saved = !profile && !params.seed && !params.q ? remembered : null;

    view.innerHTML = profile ? profileSkeleton() : listSkeleton();
    state = {
      mode: profile ? 'profile' : 'list',
      layout: readLayout(),
      timer: null,
      search: saved ? saved.search : (params.q || ''),
      filters: saved
        ? Object.assign({}, saved.filters)
        : { seedTypeId: profile ? null : (params.seed || null), region: null, sort: 'uploads' },
      list: { page: saved ? saved.page : 1, rows: [], total: 0, pages: 1, limit: LIST_SIZE, summary: null },
      seedTypes: [],
      farmerId: params.id || null,
      farmer: null,
      selecting: false,        // gallery tiles tick instead of opening
      selected: {},            // photo id → true, kept across pages
      fresh: {},               // photos added this visit, marked "Just added"
      upload: null,            // the Add photos panel while it is open
      catalogue: null,         // crops, varieties and companies, fetched when first needed
      gallery: {
        seedTypeId: profile ? (params.seed || null) : null, status: '',
        page: 1, rows: [], total: 0, pages: 1, limit: GALLERY_SIZE
      }
    };
    ctx.onLeave(function () {
      clearTimeout(state.timer);
      DatasetView.closeImage();
      closeUpload(false);
      closeConfirm();
      if (state.mode === 'list') {
        remembered = { search: state.search, filters: state.filters, page: state.list.page };
      }
      state = null;
    });
    delegate(view, ctx);

    if (profile) {
      Promise.all([
        API.getFarmer(params.id),
        API.searchSubmissions({ farmerId: params.id, seedTypeId: state.gallery.seedTypeId, page: 1, limit: GALLERY_SIZE })
      ]).then(function (res) {
        if (!state) return;
        state.farmer = res[0];
        state.gallery = Object.assign({}, state.gallery, res[1]);
        paint(view, ctx);
      }).catch(function (err) {
        if (!state) return;
        if (err && err.status === 404) {
          view.innerHTML = backButton() +
            '<div class="card">' + UI.empty('Farmer not found', 'They may have been removed from the directory.', 'users') + '</div>';
          wire(view, ctx);
          return;
        }
        ctx.handleError(err);
      });
      return;
    }

    API.getSeedTypes({ limit: 999 }).then(function (res) {
      if (!state) return;
      state.seedTypes = res.rows;
      return loadList(view, ctx);
    }).catch(ctx.handleError);
  }

  global.FarmersView = { render: render, title: 'Farmers directory' };
})(window);
