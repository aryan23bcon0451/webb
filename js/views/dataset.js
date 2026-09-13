/* ============================================================
   Dataset — the collection being built to train the quality
   classifier.

   Two tabs. "Overview" answers the only question that matters
   before training: is there enough of each class, and do the
   labels agree. "Images" is the searchable record of every
   image, with its split and its history; picking a crop there
   lays out every image of it as a gallery.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, pct = UI.pct, icon = Icons.icon;

  var state = null;

  var TABS = [
    { id: 'overview', label: 'Overview', icon: 'pie' },
    { id: 'images', label: 'Images', icon: 'image' }
  ];

  var LABELS = [
    { id: '', name: 'Any quality' },
    { id: 'Good', name: 'Good' },
    { id: 'Normal', name: 'Normal' },
    { id: 'Bad', name: 'Bad' }
  ];

  var SPLITS = [
    { id: '', name: 'Everything labelled' },
    { id: 'train', name: 'Training split only' },
    { id: 'val', name: 'Validation split only' },
    { id: 'test', name: 'Test split only' }
  ];

  /* ---------------------------------------------------- chrome */
  function skeleton() {
    var c = '';
    for (var i = 0; i < 4; i++) c += '<div class="stat"><div class="skeleton" style="height:120px"></div></div>';
    return '<div class="skeleton" style="height:60px;border-radius:14px;margin-bottom:20px"></div>' +
      '<div class="stat-grid c4">' + c + '</div>' +
      '<div class="do-layout"><div class="skeleton" style="height:520px;border-radius:14px"></div>' +
      '<div class="skeleton" style="height:420px;border-radius:14px"></div></div>';
  }

  function tabBar() {
    return '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="tab ' + (state.tab === t.id ? 'on' : '') + '" type="button" data-tab="' + t.id + '">' +
        icon(t.icon) + t.label + '</button>';
    }).join('') + '</div>';
  }

  function seedFilter(id) {
    return '<div class="filter-group"><label for="' + id + '">Seed type</label>' +
      '<select class="select" id="' + id + '">' +
        UI.selectOptions(state.seedTypes, 'id', 'name', state.filters.seedTypeId, 'All seed types') + '</select></div>';
  }

  /* ---------------------------------------------------- overview */
  function statsRow() {
    var h = state.health;
    var total = h.labelled + h.pending + h.discarded || 1;
    return '<div class="stat-grid c4">' +
      UI.statCard({ label: 'Labelled images', value: num(h.labelled), icon: 'database', tone: 'green',
        sub: pct(h.labelled / total * 100) + ' of everything collected' }) +
      UI.statCard({ label: 'Waiting to be labelled', value: num(h.pending), icon: 'clock', tone: 'amber',
        sub: 'Open the labelling screen', route: '#/label' }) +
      UI.statCard({ label: 'Thrown out', value: num(h.discarded), icon: 'x-circle', tone: 'red',
        sub: 'Unusable photos, kept out of training' }) +
      UI.statCard({ label: 'Labels agree', value: pct(h.agreement.pct, 0), icon: 'shield', tone: 'blue',
        sub: 'Uploader and reviewer picked the same quality' }) +
      '</div>';
  }

  /** The five things that decide whether this set can be trained on. */
  function readyCard() {
    var h = state.health;
    var items = h.checks.map(function (c) {
      return '<div class="check ' + (c.ok ? 'ok' : 'no') + '">' +
        '<span class="check-ico">' + icon(c.ok ? 'check-circle' : 'alert') + '</span>' +
        '<span class="check-text"><strong>' + esc(c.title) + '</strong>' +
          '<small>' + esc(c.detail) + '</small></span></div>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Ready to train?</h2>' +
        '<p>' + h.passing + ' of ' + h.checks.length + ' checks pass.</p></div>' +
        '<span class="badge ' + (h.passing === h.checks.length ? 'badge-green' : 'badge-amber') + '">' +
          (h.passing === h.checks.length ? 'Ready' : 'Not yet') + '</span>' +
      '</div>' +
      '<div class="card-body checks">' + items + '</div>' +
    '</div>';
  }

  /** Class balance — the number that decides how the model behaves. */
  function balanceCard() {
    var h = state.health;
    var items = h.classes.map(function (c) {
      return '<div class="dist-item">' +
        '<div class="dist-head">' +
          '<span class="lbl"><i class="badge-dot" style="background:' + c.color + ';width:9px;height:9px"></i>' + esc(c.label) + '</span>' +
          '<span class="val">' + pct(c.pct) + '</span>' +
        '</div>' +
        '<div class="dist-bar"><i style="width:' + Math.max(1, c.pct) + '%;background:' + c.color + '"></i></div>' +
        '<div class="dist-count">' + num(c.count) + ' images</div>' +
      '</div>';
    }).join('');

    var warn = h.balanceRatio > 4
      ? '<div class="note warn">As it stands this would teach the model to answer "' +
          esc(h.largest.label) + '" almost every time. Collect more "' + esc(h.smallest.label) +
          '" images, or weight the classes when you train.</div>'
      : '<div class="note">No class is more than 4x another, so these can be trained on as they are.</div>';

    var s = h.splits;
    var splitRow = '<div class="split-row">' +
      '<div><b>' + num(s.train) + '</b><small>train</small></div>' +
      '<div><b>' + num(s.val) + '</b><small>validation</small></div>' +
      '<div><b>' + num(s.test) + '</b><small>test</small></div>' +
    '</div>';

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>The three classes</h2>' +
        '<p>' + esc(state.seedTypeName()) + '</p></div></div>' +
      '<div class="card-body">' + items + warn +
        '<div class="sec-title">How they are split</div>' + splitRow +
        '<p class="t-muted" style="margin:10px 0 0;font-size:12.5px">Each image keeps its split for good, so a model is never tested on an image it was trained on.</p>' +
      '</div>' +
    '</div>';
  }

  /** Varieties belong to a seed type, so the list narrows once one is
      picked. Choosing a variety on its own is still allowed — it names
      a seed type by itself. */
  function exportVarieties() {
    var x = state.exportFilters;
    return state.varieties.filter(function (v) {
      return !x.seedTypeId || v.seedTypeId === x.seedTypeId;
    }).map(function (v) {
      return { id: v.id, name: x.seedTypeId ? v.name : v.seedTypeName + ' · ' + v.name };
    });
  }

  function exportScope() {
    var x = state.exportFilters;
    var name = function (rows, id) {
      var m = rows.filter(function (r) { return r.id === id; })[0];
      return m ? m.name : null;
    };
    var parts = [
      x.label ? x.label : null,
      name(state.varieties, x.varietyId) || name(state.seedTypes, x.seedTypeId),
      name(state.companies, x.companyId),
      x.split ? SPLITS.filter(function (s) { return s.id === x.split; })[0].name : null
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Everything labelled';
  }

  function exportCard() {
    var x = state.exportFilters;
    return '<div class="card" id="export-card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Take the dataset out</h2>' +
        '<p>One row per labelled image: file name, quality, split, seed type, variety, company. ' +
        'Feed it straight to a training script.</p></div></div>' +
      '<div class="card-body">' +
        '<div class="export-row">' +
          '<div class="filter-group"><label for="x-seed">Seed type</label>' +
            '<select class="select" id="x-seed">' +
              UI.selectOptions(state.seedTypes, 'id', 'name', x.seedTypeId, 'All seed types') + '</select></div>' +
          '<div class="filter-group"><label for="x-variety">Variety</label>' +
            '<select class="select" id="x-variety">' +
              UI.selectOptions(exportVarieties(), 'id', 'name', x.varietyId, 'All varieties') + '</select></div>' +
          '<div class="filter-group"><label for="x-company">Company</label>' +
            '<select class="select" id="x-company">' +
              UI.selectOptions(state.companies, 'id', 'name', x.companyId, 'All companies') + '</select></div>' +
          '<div class="filter-group"><label for="x-split">Which images</label>' +
            '<select class="select" id="x-split">' +
              SPLITS.map(function (s) {
                return '<option value="' + s.id + '"' + (s.id === x.split ? ' selected' : '') + '>' + esc(s.name) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="filter-group"><label for="x-label">Quality</label>' +
            '<select class="select" id="x-label">' + UI.selectOptions(LABELS, 'id', 'name', x.label) + '</select></div>' +
        '</div>' +
        '<div class="export-foot">' +
          '<p class="export-scope">Exporting <b>' + esc(exportScope()) + '</b></p>' +
          '<div class="export-actions">' +
            '<button class="btn btn-primary" type="button" id="x-csv">' + icon('download') + 'Download CSV</button>' +
            '<button class="btn" type="button" id="x-json">' + icon('download') + 'Download JSON</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /** Good / Normal / Bad as one bar rather than three competing numbers.
      The bar is three colours and nothing else, so the same split is
      spelled out for anyone who cannot use the colours. */
  function labelBar(labels) {
    var total = labels.good + labels.normal + labels.bad || 1;
    var seg = function (v, color) {
      return '<i style="width:' + (v / total * 100) + '%;background:' + color + '"></i>';
    };
    var spoken = 'Good ' + num(labels.good) + ', Normal ' + num(labels.normal) + ', Bad ' + num(labels.bad);
    return '<div class="split-bar" title="' + esc(spoken) + '" aria-hidden="true">' +
      seg(labels.good, 'var(--green)') + seg(labels.normal, 'var(--amber)') + seg(labels.bad, 'var(--red)') +
      '</div><span class="sr-only">' + esc(spoken) + '</span>';
  }

  function progressTable() {
    var p = state.progress;
    if (!p.rows.length) {
      return '<div class="card">' + UI.empty('Nothing to show', 'Try a different seed type.', 'layers') + '</div>';
    }
    var body = p.rows.map(function (v) {
      var tone = v.progress >= 85 ? '' : v.progress >= 60 ? 'amber' : 'red';
      return '<tr class="clickable" data-seed="' + esc(v.seedTypeId) + '"' +
        UI.rowButton('Show only ' + v.seedTypeName) + '>' +
        '<td><div class="seed-cell"><span class="seed-glyph" aria-hidden="true">' + esc(v.glyph) + '</span>' +
          '<span>' + esc(v.seedTypeName) + '<span class="cell-sub t-muted">' + esc(v.name) + '</span></span></div></td>' +
        '<td class="num">' + num(v.approved) + '</td>' +
        '<td class="num t-amber">' + num(v.pending) + '</td>' +
        '<td><div class="progress-cell"><span>' + v.progress + '% of ' + num(v.target) + '</span>' +
          '<div class="bar ' + tone + '"><i style="width:' + v.progress + '%"></i></div></div></td>' +
        '<td style="min-width:130px">' + labelBar(v.labels) + '</td>' +
      '</tr>';
    }).join('');

    var from = (p.page - 1) * p.limit + 1;
    var to = Math.min(p.page * p.limit, p.total);

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Coverage by variety</h2>' +
        '<p>A model only learns a variety it has seen. Each row works toward its own target.</p></div></div>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr>' +
          '<th>Seed type &amp; variety</th><th>Labelled</th><th>Waiting</th>' +
          '<th>Toward target</th><th>Good / Normal / Bad</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="card-foot">' +
        '<span>Showing ' + from + '–' + to + ' of ' + num(p.total) + ' varieties</span>' +
        UI.pager(p.page, p.pages) +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------- images tab */
  function imagesPanel() {
    var p = state.images;
    var body = p.rows.map(function (s) {
      /* The row holds two controls — the crop opens its gallery, the
         arrow opens this image — so the row itself is not a button. */
      return '<tr class="clickable" data-open="' + esc(s.id) + '">' +
        '<td><button class="seed-cell crop-link" type="button" data-crop="' + esc(s.seedTypeId) + '"' +
          ' title="See every ' + esc(s.seedTypeName) + ' image">' +
          '<span class="seed-glyph" aria-hidden="true">' + esc(s.glyph) + '</span>' +
          '<span><span class="crop-name">' + esc(s.seedTypeName) + '</span>' +
          '<span class="cell-sub t-muted">' + esc(s.varietyName) + '</span></span></button></td>' +
        '<td>' + UI.labelBadge(s.finalLabel) + '</td>' +
        '<td>' + (s.status === 'approved'
          ? '<span class="badge badge-gray mono">' + esc(API.splitOf(s.seq)) + '</span>'
          : '<span class="t-muted">—</span>') + '</td>' +
        '<td>' + UI.statusBadge(s.status) + '</td>' +
        '<td class="nowrap"><button class="btn-link" type="button" data-route="#/farmers?id=' + esc(encodeURIComponent(s.farmerId)) + '"' +
          ' title="See everything ' + esc(s.farmerName) + ' has uploaded">' + esc(s.farmerName) + '</button></td>' +
        '<td class="t-muted nowrap">' + UI.date(s.uploadedAt) + '</td>' +
        '<td><button class="icon-btn row-open" type="button" data-open="' + esc(s.id) + '"' +
          ' aria-label="Open ' + esc(s.seedTypeName) + ' image ' + esc(s.id) + '">' + icon('chevron-right') + '</button></td>' +
      '</tr>';
    }).join('');

    var from = p.total ? (p.page - 1) * p.limit + 1 : 0;
    var to = Math.min(p.page * p.limit, p.total);

    return '<div class="card">' +
      (p.rows.length
        ? '<div class="table-wrap"><table><thead><tr>' +
            '<th>Image</th><th>Quality</th><th>Split</th><th>In dataset</th>' +
            '<th>Uploaded by</th><th>Date</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : UI.empty('Nothing found', 'Try a different search.', 'search')) +
      (p.total ? '<div class="card-foot"><span>Showing ' + from + '–' + to + ' of ' + num(p.total) + ' images</span>' +
        UI.pager(p.page, p.pages) + '</div>' : '') +
    '</div>';
  }

  function imagesBar() {
    return '<div class="filter-bar">' +
      '<div class="search-field" style="flex:1;min-width:220px;max-width:400px">' +
        '<span class="search-ico">' + icon('search') + '</span>' +
        '<input class="input" id="i-q" placeholder="Search by seed type, person or image ID…" value="' + esc(state.search) + '"></div>' +
      seedFilter('i-seed') +
      '<div class="filter-group"><label for="i-label">Quality</label>' +
        '<select class="select" id="i-label">' +
          UI.selectOptions(LABELS, 'id', 'name', state.filters.label) + '</select></div>' +
      '</div>';
  }

  /* ---------------------------------------------------- crop gallery */
  var GALLERY_SIZE = 24;     // fills rows of 2, 3, 4 or 6 alike

  function galleryCrop() {
    var m = state.seedTypes.filter(function (s) { return s.id === state.gallery; })[0] || {};
    var first = state.images.rows[0] || {};
    return { name: m.name || first.seedTypeName || 'This crop', glyph: m.glyph || first.glyph || '🌱' };
  }

  function galleryBar() {
    return '<div class="filter-bar">' +
      '<button class="btn btn-ghost" type="button" id="g-back">' + icon('arrow-left') + 'All images</button>' +
      '<div class="filter-spacer"></div>' +
      '<div class="filter-group"><label for="i-label">Quality</label>' +
        '<select class="select" id="i-label">' +
          UI.selectOptions(LABELS, 'id', 'name', state.filters.label) + '</select></div>' +
    '</div>';
  }

  function galleryPanel() {
    var p = state.images;
    var crop = galleryCrop();
    var label = state.filters.label;

    var tiles = p.rows.map(function (s, i) {
      return '<button class="photo-card" type="button" data-photo="' + i + '"' +
        ' aria-label="' + esc(s.varietyName + ' from ' + s.farmerName + ', ' + (s.finalLabel || 'not labelled yet')) + '">' +
        '<div class="photo-thumb">' +
          '<img src="' + Photos.of(s) + '" alt="" loading="lazy">' +
          (s.finalLabel ? UI.labelBadge(s.finalLabel) : '') +
          '<span class="photo-open">' + icon('eye') + '</span>' +
        '</div>' +
        '<div class="photo-meta">' +
          '<strong>' + esc(s.varietyName) + '</strong>' +
          '<small>' + esc(s.farmerName) + ' · ' + UI.date(s.uploadedAt) + '</small>' +
          '<div class="gallery-foot"><span>' +
            (s.status === 'approved' ? esc(API.splitOf(s.seq)) + ' split' : '') + '</span>' +
            UI.statusBadge(s.status) + '</div>' +
        '</div>' +
      '</button>';
    }).join('');

    var from = p.total ? (p.page - 1) * p.limit + 1 : 0;
    var to = Math.min(p.page * p.limit, p.total);

    return '<div class="card">' +
      '<div class="card-head gallery-head">' +
        '<span class="seed-glyph" aria-hidden="true">' + esc(crop.glyph) + '</span>' +
        '<div class="card-head-text"><h2>' + esc(crop.name) + '</h2>' +
          '<p>' + num(p.total) + ' ' + (label ? '"' + esc(label) + '" ' : '') +
            (p.total === 1 ? 'image' : 'images') + ', newest first. Open one to see its history.</p></div>' +
      '</div>' +
      (p.rows.length
        ? '<div class="gallery-grid">' + tiles + '</div>'
        : UI.empty('Nothing found', label
            ? 'No ' + crop.name + ' image is labelled "' + label + '".'
            : 'No ' + crop.name + ' images yet.', 'image')) +
      (p.total ? '<div class="card-foot"><span>Showing ' + from + '–' + to + ' of ' + num(p.total) + ' images</span>' +
        UI.pager(p.page, p.pages) + '</div>' : '') +
    '</div>';
  }

  /** Lets the drawer walk through the gallery, loading the next or
      previous page when it runs off the end of this one. */
  function galleryNav(view, ctx, index) {
    var p = state.images;
    var position = (p.page - 1) * p.limit + index + 1;
    return {
      position: position,
      total: p.total,
      go: function (step) {
        if (!state || !state.gallery) return;
        if (position + step < 1 || position + step > p.total) return;
        var i = index + step;
        if (i >= 0 && i < p.rows.length) {
          openDrawer(p.rows[i].id, galleryNav(view, ctx, i), step);
          return;
        }
        state.images.page = p.page + step;
        reload(view, ctx).then(function () {
          if (!state || !state.gallery || !state.images.rows.length) return;
          var j = step > 0 ? 0 : state.images.rows.length - 1;
          openDrawer(state.images.rows[j].id, galleryNav(view, ctx, j), step);
        });
      }
    };
  }

  /* ---------------------------------------------------- drawer */
  var TRAIL_KIND = { approve: 'ok', reject: 'no' };
  var drawerNav = null;

  /** `nav` is given when the drawer is opened from the gallery, so it
      can step to the images either side; `step` says it just did. */
  function openDrawer(id, nav, step) {
    API.getSubmission(id).then(function (s) {
      closeDrawer();
      drawerNav = nav || null;
      var trail = s.trail.slice().sort(function (a, b) { return a.at - b.at; }).map(function (t) {
        return '<div class="trail-item ' + (TRAIL_KIND[t.kind] || '') + '">' +
          '<strong>' + esc(t.title) + '</strong>' +
          '<small>' + UI.dateTime(t.at) + '</small>' +
          (t.note ? '<div class="trail-note">' + esc(t.note) + '</div>' : '') +
        '</div>';
      }).join('');

      var meta = [
        ['Seed type', s.glyph + '  ' + s.seedTypeName],
        ['Variety', s.varietyName],
        ['Company', s.companyName],
        ['Uploaded by', s.farmerName, '#/farmers?id=' + encodeURIComponent(s.farmerId)],
        ['Image size', num(s.width) + ' × ' + num(s.height) + ' px'],
        ['Uploader said', s.labelByUser],
        ['Final label', s.finalLabel || 'Not labelled yet'],
        ['Split', s.status === 'approved' ? API.splitOf(s.seq) : 'Not in the dataset']
      ].map(function (r) {
        var v = r[2]
          ? '<button class="btn-link" type="button" data-route="' + esc(r[2]) + '">' + esc(r[1]) + '</button>'
          : esc(r[1]);
        return '<div class="info-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + v + '</span></div>';
      }).join('');

      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.id = 'drawer-scrim';
      document.body.appendChild(scrim);

      var d = document.createElement('aside');
      d.className = 'drawer' + (step ? ' no-anim' : '');
      d.id = 'image-drawer';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-label', 'History for this image');
      d.innerHTML =
        '<div class="drawer-head">' +
          '<div style="flex:1;min-width:0"><h2>' + esc(s.seedTypeName) + ' · ' + esc(s.varietyName) + '</h2>' +
            '<p>From ' + esc(s.farmerName) + ' · ' + esc(s.id) + '</p></div>' +
          (nav ? stepper(nav) : '') +
          '<button class="icon-btn" type="button" id="drawer-close" aria-label="Close">' + icon('x') + '</button>' +
        '</div>' +
        '<div class="drawer-body">' +
          '<div class="drawer-photo"><img src="' + Photos.of(s) + '" alt="' + esc(s.seedTypeName) + ' seedling"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">' +
            UI.statusBadge(s.status) + UI.labelBadge(s.finalLabel) +
            (s.adjudicated ? '<span class="badge badge-blue">Checked twice</span>' : '') +
          '</div>' +
          '<div class="sec-title">Details</div>' + meta +
          '<div class="sec-title">What happened</div>' +
          '<div class="trail">' + trail + '</div>' +
        '</div>';
      document.body.appendChild(d);

      d.querySelector('#drawer-close').addEventListener('click', closeDrawer);
      scrim.addEventListener('click', closeDrawer);
      UI.on(d, 'click', '[data-step]', function (e, el) { nav.go(parseInt(el.getAttribute('data-step'), 10)); });
      document.addEventListener('keydown', drawerKeys);
      /* After a step, focus stays on the arrow used so it can be pressed again. */
      var arrow = step && d.querySelector('[data-step="' + step + '"]:not(:disabled)');
      (arrow || d.querySelector('#drawer-close')).focus();
    }).catch(function (e) { UI.toast(e.message, 'err'); });
  }

  function stepper(nav) {
    return '<div class="drawer-nav">' +
      '<button class="icon-btn" type="button" data-step="-1" aria-label="Previous image"' +
        (nav.position <= 1 ? ' disabled' : '') + '>' + icon('chevron-left') + '</button>' +
      '<span>' + num(nav.position) + ' of ' + num(nav.total) + '</span>' +
      '<button class="icon-btn" type="button" data-step="1" aria-label="Next image"' +
        (nav.position >= nav.total ? ' disabled' : '') + '>' + icon('chevron-right') + '</button>' +
    '</div>';
  }

  function drawerKeys(e) {
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (!drawerNav || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    drawerNav.go(e.key === 'ArrowLeft' ? -1 : 1);
  }

  function closeDrawer() {
    document.removeEventListener('keydown', drawerKeys);
    drawerNav = null;
    var d = document.getElementById('image-drawer');
    var s = document.getElementById('drawer-scrim');
    if (d) d.remove();
    if (s) s.remove();
  }

  /* ---------------------------------------------------- export */
  function csv(rows) {
    if (!rows.length) return '';
    var cols = Object.keys(rows[0]);
    var cell = function (v) {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return cols.join(',') + '\n' +
      rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(','); }).join('\n');
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /** Whatever narrows the export goes into the file name too, so two
      exports taken the same day are still told apart. */
  function exportName(format) {
    var x = state.exportFilters;
    var slug = function (id, rows) {
      var m = rows.filter(function (r) { return r.id === id; })[0];
      return m ? m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
    };
    var parts = ['seed-quality'];
    var scope = slug(x.varietyId, state.varieties) || slug(x.seedTypeId, state.seedTypes);
    if (scope) parts.push(scope);
    var co = slug(x.companyId, state.companies);
    if (co) parts.push(co);
    if (x.label) parts.push(x.label.toLowerCase());
    parts.push(x.split || 'all');
    parts.push(new Date().toISOString().slice(0, 10));
    return parts.join('-') + '.' + format;
  }

  function exportManifest(view, format) {
    var x = state.exportFilters;
    API.getManifest({
      seedTypeId: x.seedTypeId, varietyId: x.varietyId, companyId: x.companyId,
      split: x.split, label: x.label
    })
      .then(function (res) {
        if (!res.total) { UI.toast('Nothing matches those choices.', 'err'); return; }
        var name = exportName(format);
        if (format === 'csv') {
          download(name, csv(res.rows), 'text/csv');
        } else {
          download(name, JSON.stringify({
            generated_at: new Date(res.generatedAt).toISOString(),
            count: res.total,
            classes: ['good', 'normal', 'bad'],
            scope: exportScope(),
            images: res.rows
          }, null, 2), 'application/json');
        }
        UI.toast(num(res.total) + ' images exported', 'ok');
      })
      .catch(function (e) { UI.toast(e.message, 'err'); });
  }

  /* The export selects change only what leaves the building — no data
     has to be refetched — so the card repaints itself and hands focus
     back to the select that was just used. */
  var EXPORT_FIELDS = {
    'x-split': 'split', 'x-label': 'label',
    'x-seed': 'seedTypeId', 'x-variety': 'varietyId', 'x-company': 'companyId'
  };

  function wireExport(view) {
    var card = view.querySelector('#export-card');
    if (!card) return;

    Object.keys(EXPORT_FIELDS).forEach(function (id) {
      var el = card.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('change', function () {
        var key = EXPORT_FIELDS[id];
        var value = this.value;
        state.exportFilters[key] = value || (key === 'split' || key === 'label' ? '' : null);
        /* A variety belongs to one seed type, so changing the type drops it… */
        if (key === 'seedTypeId') state.exportFilters.varietyId = null;
        /* …and picking a variety names its seed type. */
        if (key === 'varietyId' && value) {
          var v = state.varieties.filter(function (r) { return r.id === value; })[0];
          if (v) state.exportFilters.seedTypeId = v.seedTypeId;
        }
        repaintExport(view, id);
      });
    });

    var csvBtn = card.querySelector('#x-csv'), jsonBtn = card.querySelector('#x-json');
    if (csvBtn) csvBtn.addEventListener('click', function () { exportManifest(view, 'csv'); });
    if (jsonBtn) jsonBtn.addEventListener('click', function () { exportManifest(view, 'json'); });
  }

  function repaintExport(view, focusId) {
    var card = view.querySelector('#export-card');
    if (!card) return;
    card.outerHTML = exportCard();
    wireExport(view);
    var again = view.querySelector('#' + focusId);
    if (again) again.focus();
  }

  /* ---------------------------------------------------- paint */
  function paint(view, ctx) {
    var head =
      '<div class="page-head"><div class="page-head-text">' +
        '<h1>Dataset</h1>' +
        '<p>Every labelled image, and whether the set is ready to train a model on.</p>' +
      '</div></div>' + tabBar();

    if (state.tab === 'images') {
      view.innerHTML = head + (state.gallery ? galleryBar() + galleryPanel() : imagesBar() + imagesPanel());
    } else {
      view.innerHTML = head +
        '<div class="filter-bar">' +
          '<span class="filter-ico">' + icon('filter') + '</span>' + seedFilter('d-seed') +
          '<div class="filter-spacer"></div>' +
          '<button class="btn" type="button" id="d-refresh">' + icon('refresh') + 'Refresh</button>' +
        '</div>' +
        statsRow() +
        '<div class="do-layout"><div>' + readyCard() + exportCard() + progressTable() + '</div>' +
        balanceCard() + '</div>';
    }
    wire(view, ctx);
  }

  function wire(view, ctx) {
    var $ = function (id) { return view.querySelector('#' + id); };

    ['d-seed', 'i-seed'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        state.filters.seedTypeId = this.value || null;
        /* The export follows the screen it sits on, until it is
           narrowed on its own. */
        state.exportFilters.seedTypeId = state.filters.seedTypeId;
        state.exportFilters.varietyId = null;
        state.progress.page = 1;
        state.images.page = 1;
        reload(view, ctx);
      });
    });

    var refresh = $('d-refresh');
    if (refresh) refresh.addEventListener('click', function () {
      this.classList.add('spinning');
      reload(view, ctx, true);
    });

    wireExport(view);

    var q = $('i-q');
    if (q) q.addEventListener('input', function () {
      clearTimeout(state.timer);
      var v = q.value;
      state.timer = setTimeout(function () {
        state.search = v;
        state.images.page = 1;
        reload(view, ctx).then(function () {
          var again = view.querySelector('#i-q');
          if (again) { again.focus(); again.setSelectionRange(v.length, v.length); }
        });
      }, 280);
    });

    var lbl = $('i-label');
    if (lbl) lbl.addEventListener('change', function () {
      state.filters.label = this.value;
      state.images.page = 1;
      reload(view, ctx);
    });

    var back = $('g-back');
    if (back) back.addEventListener('click', function () {
      var crop = state.gallery;
      state.gallery = null;
      state.images.page = state.listPage;
      reload(view, ctx).then(function () {
        var again = view.querySelector('[data-crop="' + crop + '"]');
        if (again) again.focus();
      });
    });
  }

  /* Delegated handlers sit on `view`, which outlives every paint and
     every visit. Bound in `wire` they would pile up one set per paint,
     so they are bound once per visit and go quiet when it ends. */
  function delegate(view, ctx) {
    var visit = state;
    var live = function (fn) {
      return function (e, el) { if (state && state === visit) fn(e, el); };
    };

    UI.on(view, 'click', '[data-tab]', live(function (e, el) {
      state.tab = el.getAttribute('data-tab');
      state.search = '';
      state.gallery = null;
      state.images.page = 1;
      reload(view, ctx);
    }));

    UI.on(view, 'click', '.pager button[data-page]', live(function (e, el) {
      var p = parseInt(el.getAttribute('data-page'), 10);
      if (isNaN(p)) return;
      if (state.tab === 'images') state.images.page = p; else state.progress.page = p;
      reload(view, ctx).then(function () {
        /* A gallery page is tall — start the new one from its top. */
        var top = state && state.gallery && view.querySelector('.gallery-head');
        if (top) top.scrollIntoView({ block: 'nearest' });
      });
    }));

    UI.onActivate(view, 'tr[data-seed]', live(function (e, el) {
      state.filters.seedTypeId = el.getAttribute('data-seed');
      state.exportFilters.seedTypeId = state.filters.seedTypeId;
      state.exportFilters.varietyId = null;
      state.progress.page = 1;
      reload(view, ctx);
    }));

    UI.on(view, 'click', '[data-open]', live(function (e, el) {
      if (e.target.closest('[data-crop], [data-route]')) return;   // crop and farmer links do their own thing
      openDrawer(el.getAttribute('data-open'));
    }));

    UI.on(view, 'click', '[data-crop]', live(function (e, el) {
      state.gallery = el.getAttribute('data-crop');
      state.listPage = state.images.page;
      state.images.page = 1;
      reload(view, ctx).then(function () {
        var back = view.querySelector('#g-back');
        if (back) back.focus();
      });
    }));

    UI.on(view, 'click', '[data-photo]', live(function (e, el) {
      var i = parseInt(el.getAttribute('data-photo'), 10);
      if (state.images.rows[i]) openDrawer(state.images.rows[i].id, galleryNav(view, ctx, i));
    }));
  }

  function reload(view, ctx, announce) {
    var f = state.filters;
    var size = parseInt(SettingsView.readPrefs().pageSize, 10) || 5;

    if (state.tab === 'images') {
      /* The gallery is the one crop, whatever the list was narrowed to. */
      var query = state.gallery
        ? { seedTypeId: state.gallery, label: f.label, page: state.images.page, limit: GALLERY_SIZE }
        : { search: state.search, seedTypeId: f.seedTypeId, label: f.label, page: state.images.page, limit: size * 2 };
      return API.searchSubmissions(query).then(function (data) {
        if (!state) return;
        state.images = data;
        paint(view, ctx);
      }).catch(ctx.handleError);
    }

    return Promise.all([
      API.getDatasetHealth({ seedTypeId: f.seedTypeId }),
      API.getVarietyProgress({ seedTypeId: f.seedTypeId, page: state.progress.page, limit: size })
    ]).then(function (res) {
      if (!state) return;            // the view was left while this was in flight
      state.health = res[0];
      state.progress = res[1];
      paint(view, ctx);
      if (announce) UI.toast('Updated', 'ok');
    }).catch(ctx.handleError);
  }

  function render(view, ctx, params) {
    view.innerHTML = skeleton();
    state = {
      tab: params.tab === 'images' ? 'images' : 'overview',
      search: params.q || '',
      timer: null,
      gallery: null,          // seed type whose images are laid out as a gallery
      listPage: 1,            // the list's page, to return to from the gallery
      filters: { seedTypeId: params.seed || null, label: params.label || '' },
      /* The export has its own scope. It starts from whatever the screen
         is filtered to and can then be narrowed further without moving
         the rest of the page. */
      exportFilters: {
        split: '', label: '',
        seedTypeId: params.seed || null, varietyId: null, companyId: null
      },
      progress: { page: 1, rows: [], total: 0, pages: 1, limit: 5 },
      images: { page: 1, rows: [], total: 0, pages: 1, limit: 10 },
      health: null,
      seedTypes: [],
      varieties: [],
      companies: [],
      seedTypeName: function () {
        var m = state.seedTypes.filter(function (s) { return s.id === state.filters.seedTypeId; })[0];
        return m ? m.name : 'Across every seed type';
      }
    };
    ctx.onLeave(function () { clearTimeout(state.timer); closeDrawer(); state = null; });
    delegate(view, ctx);

    /* The three catalogue lists feed the export's scope selects. They
       change rarely, so they are fetched once per visit, not per paint. */
    Promise.all([
      API.getSeedTypes({ limit: 999 }),
      API.getVarieties({ limit: 999 }),
      API.getCompanies({ limit: 999 })
    ]).then(function (res) {
      if (!state) return;
      state.seedTypes = res[0].rows;
      state.varieties = res[1].rows;
      state.companies = res[2].rows;
      return reload(view, ctx);
    }).catch(ctx.handleError);
  }

  /* The image drawer is shared: the farmers directory opens the same one. */
  global.DatasetView = { render: render, title: 'Dataset', openImage: openDrawer, closeImage: closeDrawer };
})(window);
