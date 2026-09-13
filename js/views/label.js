/* ============================================================
   Label images — the screen where the dataset is actually made.

   One image, one decision. The three quality buttons *are* the
   save: pressing Good files the image into the dataset with that
   label and pulls up the next one. Nothing is a two-step.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, icon = Icons.icon;

  var state = null;

  var QUALITY = [
    { key: 'Good', cls: 'q-good', hint: 'Sharp, well lit, the seed fills the frame' },
    { key: 'Normal', cls: 'q-normal', hint: 'Usable, but soft focus or poor light' },
    { key: 'Bad', cls: 'q-bad', hint: 'Blurred, dark, or the seed is hard to see' }
  ];

  function skeleton() {
    return '<div class="skeleton" style="height:62px;border-radius:14px;margin-bottom:20px"></div>' +
      '<div class="stat-grid c3">' +
        '<div class="stat"><div class="skeleton" style="height:78px"></div></div>' +
        '<div class="stat"><div class="skeleton" style="height:78px"></div></div>' +
        '<div class="stat"><div class="skeleton" style="height:78px"></div></div>' +
      '</div>' +
      '<div class="rq-layout"><div class="skeleton" style="height:560px;border-radius:14px"></div>' +
      '<div class="skeleton" style="height:320px;border-radius:14px"></div></div>';
  }

  function filterBar() {
    return '<div class="filter-bar">' +
      '<span class="filter-ico">' + icon('filter') + '</span>' +
      '<div class="filter-group"><label for="f-seed">Seed type</label>' +
        '<select class="select" id="f-seed">' +
          UI.selectOptions(state.seedTypes, 'id', 'name', state.filters.seedTypeId, 'All seed types') +
        '</select></div>' +
      '<div class="filter-spacer"></div>' +
      (state.filters.seedTypeId
        ? '<button class="btn-link" type="button" id="f-clear">Show every seed type</button>' : '') +
      '<button class="btn" type="button" id="rq-refresh">' + icon('refresh') + 'Refresh</button>' +
      '</div>';
  }

  function statsRow() {
    var s = state.stats;
    return '<div class="stat-grid c3">' +
      UI.statCard({ label: 'Waiting to be labelled', value: num(s.pending), icon: 'clock', tone: 'amber' }) +
      UI.statCard({ label: 'Added to the dataset today', value: num(s.approvedToday), icon: 'check-circle', tone: 'green' }) +
      UI.statCard({ label: 'You have labelled this session', value: num(state.done), icon: 'spark', tone: 'brand' }) +
      '</div>';
  }

  function current() { return state.rows[state.index] || null; }

  function filmstrip() {
    var start = Math.max(0, state.index - 2);
    var shown = state.rows.slice(start, start + 6);
    var remaining = state.rows.length - (start + shown.length);
    var thumbs = shown.map(function (s, i) {
      var idx = start + i;
      return '<button class="thumb ' + (idx === state.index ? 'on' : '') + '" type="button" data-jump="' + idx + '" ' +
        'title="' + esc(s.seedTypeName) + ' from ' + esc(s.farmerName) + '">' +
        '<img src="' + Photos.of(s) + '" alt="" loading="lazy"></button>';
    }).join('');
    return '<div class="filmstrip">' +
      '<div class="strip">' + thumbs +
        (remaining > 0 ? '<div class="thumb-more">+' + num(remaining) + '</div>' : '') +
      '</div></div>';
  }

  /* One click per image: the label button is also the save button. */
  function decideBar() {
    var s = current();
    var picks = QUALITY.map(function (x, i) {
      return '<button class="label-btn ' + x.cls + '" type="button" data-label="' + x.key + '">' +
        '<span class="lb-key">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + x.key + '</span>' +
        '<span class="lb-hint">' + esc(x.hint) + '</span>' +
      '</button>';
    }).join('');

    return '<div class="decide">' +
      '<div class="decide-q">' +
        '<span class="decide-q-label">What quality is this seed image?</span>' +
        '<div class="label-picker">' + picks + '</div>' +
        (s ? '<span class="decide-q-hint">The person who took it said <b>' + esc(s.labelByUser) + '</b>. ' +
             'Picking a label saves the image and opens the next one.</span>' : '') +
      '</div>' +
      '<div class="decide-actions">' +
        '<button class="btn btn-danger" type="button" id="act-discard">' + icon('x') + 'Can\'t use it</button>' +
        '<button class="btn" type="button" id="act-skip">' + icon('skip') + 'Decide later</button>' +
      '</div>' +
    '</div>';
  }

  function infoPanel() {
    var s = current();
    if (!s) {
      return '<div class="card"><div class="card-head"><div class="card-head-text"><h2>About this image</h2></div></div>' +
        UI.empty('Nothing selected', 'Pick an image from the queue.', 'image') + '</div>';
    }
    var rows = [
      ['sprout', 'i-green', 'Seed type', s.glyph + '  ' + s.seedTypeName],
      ['wheat', 'i-amber', 'Variety', s.varietyName],
      ['building', 'i-blue', 'Company', s.companyName],
      ['user', 'i-brand', 'Taken by', s.farmerName],
      ['ruler', 'i-red', 'Image size', num(s.width) + ' × ' + num(s.height) + ' px']
    ].map(function (r) {
      return '<div class="info-row">' +
        '<span class="info-ico ' + r[1] + '">' + icon(r[0]) + '</span>' +
        '<span class="k">' + esc(r[2]) + '</span>' +
        '<span class="v">' + esc(r[3]) + '</span></div>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>About this image</h2>' +
        '<p>Added ' + UI.ago(s.uploadedAt) + '</p></div></div>' +
      '<div class="card-body" style="padding-top:6px;padding-bottom:14px">' + rows + '</div>' +
      '<div class="card-body" style="padding-top:0">' +
        '<div class="note">Label what you see, not what you expect. A wrong label costs the model more than a missing one.</div>' +
      '</div>' +
    '</div>';
  }

  function stage() {
    var s = current();
    if (!s) {
      return '<div class="card">' + UI.empty(
        state.filters.seedTypeId ? 'Nothing left here' : 'All caught up',
        state.filters.seedTypeId
          ? 'Every image of this seed type has been labelled. Switch to another one.'
          : 'Every image collected so far has a label. Nice work.',
        'check-circle') + '</div>';
    }
    return '<div class="card">' +
      '<div class="rq-toolbar">' +
        '<button class="round-btn" type="button" id="nav-prev"' + (state.index === 0 ? ' disabled' : '') +
          ' aria-label="Previous image">' + icon('chevron-left') + '</button>' +
        '<b class="rq-count">Image ' + (state.index + 1) + ' of ' + num(state.rows.length) + '</b>' +
        '<button class="round-btn" type="button" id="nav-next"' + (state.index >= state.rows.length - 1 ? ' disabled' : '') +
          ' aria-label="Next image">' + icon('chevron-right') + '</button>' +
        '<div class="filter-spacer"></div>' +
        '<button class="btn" type="button" id="toggle-view">' + icon('grid') + 'See them all</button>' +
      '</div>' +
      '<div class="stage">' +
        '<img src="' + Photos.of(s) + '" alt="' + esc(s.seedTypeName) + ' seed image taken by ' + esc(s.farmerName) + '">' +
        '<div class="stage-tag"><span class="badge badge-gray">' + esc(s.glyph) + ' ' + esc(s.seedTypeName) + '</span></div>' +
      '</div>' +
      filmstrip() +
      decideBar() +
    '</div>';
  }

  function gridMode() {
    if (!state.rows.length) {
      return '<div class="card">' + UI.empty('All caught up', 'Nothing is waiting to be labelled.', 'check-circle') + '</div>';
    }
    var tiles = state.rows.slice(0, 48).map(function (s, i) {
      return '<button class="photo-card" type="button" data-jump="' + i + '">' +
        '<div class="photo-thumb">' +
          '<img src="' + Photos.of(s) + '" alt="" loading="lazy">' +
          '<span class="photo-open">' + icon('chevron-right') + '</span>' +
        '</div>' +
        '<div class="photo-meta">' +
          '<strong>' + esc(s.glyph) + ' ' + esc(s.seedTypeName) + '</strong>' +
          '<small>from ' + esc(s.farmerName) + '</small>' +
        '</div></button>';
    }).join('');
    return '<div class="card">' +
      '<div class="rq-toolbar">' +
        '<b class="rq-count">' + num(state.rows.length) + ' images waiting</b>' +
        '<div class="filter-spacer"></div>' +
        '<button class="btn" type="button" id="toggle-view">' + icon('image') + 'Label one by one</button>' +
      '</div>' +
      '<div class="rq-grid">' + tiles + '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------- painting */

  function paint(view, ctx) {
    /* Repainting throws away the focused node. Someone labelling from
       the keyboard should not have to tab back after every image. */
    var focused = document.activeElement;
    var keep = focused && focused.closest && focused.closest('#view')
      ? (focused.id ? '#' + focused.id
        : focused.getAttribute('data-label') ? '[data-label="' + focused.getAttribute('data-label') + '"]' : null)
      : null;

    view.innerHTML =
      '<div class="page-head"><div class="page-head-text">' +
        '<h1>Label images</h1>' +
        '<p>' + num(state.rows.length) + ' images are waiting. Oldest first — each one you label joins the training set.</p>' +
      '</div></div>' +
      filterBar() +
      statsRow() +
      (state.mode === 'grid'
        ? gridMode()
        : '<div class="rq-layout">' + stage() + infoPanel() + '</div>');

    wire(view, ctx);
    preload();

    if (keep) {
      var again = view.querySelector(keep);
      if (again) again.focus();
    }
  }

  /** Warm the next few images so a decision never waits on a download. */
  function preload() {
    for (var i = state.index + 1; i <= state.index + 3 && i < state.rows.length; i++) {
      var s = state.rows[i];
      var img = new Image();
      img.src = Photos.of(s);
    }
  }

  function go(view, ctx, delta) {
    if (!state.rows.length) return;
    state.index = Math.max(0, Math.min(state.rows.length - 1, state.index + delta));
    paint(view, ctx);
  }

  /**
   * action: a quality name (saves it), 'discard', or 'skip'.
   *
   * Labelling in bulk means three or four decisions a second, and the
   * old flow blocked on the round trip and swallowed anything pressed
   * during it — silently losing work. So the image leaves the queue the
   * moment you press, the request follows behind, and a failure puts
   * that image back where it was. Each press acts on a different image,
   * so nothing is ever submitted twice.
   */
  function decide(view, ctx, action) {
    var s = current();
    if (!s) return;

    var isLabel = QUALITY.some(function (q) { return q.key === action; });
    if (action === 'discard' && SettingsView.readPrefs().confirmDiscard &&
        !window.confirm('Leave this image out of the dataset? It goes back to ' + s.farmerName + '.')) {
      return;
    }

    var at = state.index;
    state.rows.splice(at, 1);
    if (state.index >= state.rows.length) state.index = Math.max(0, state.rows.length - 1);
    if (isLabel) state.done++;
    state.inFlight++;

    /* The image changing is the confirmation on screen; this is the
       same confirmation for anyone who cannot see it. */
    UI.announce(isLabel
      ? 'Saved as ' + action + '. ' + num(state.rows.length) + ' images left.'
      : action === 'discard' ? 'Thrown out. ' + num(state.rows.length) + ' images left.'
      : 'Moved to the end of the queue.');
    if (action === 'discard') UI.toast('Left out of the dataset', 'err');
    else if (action === 'skip') UI.toast('Moved to the end of the queue', 'info');
    paint(view, ctx);

    var call = action === 'skip'
      ? API.skipSubmission(s.id)
      : API.reviewSubmission(s.id, isLabel ? 'approve' : 'reject', isLabel ? action : null);

    call.then(function () {
      return API.getQueueStats();
    }).then(function (stats) {
      if (!state) return;
      state.stats = stats;
      state.inFlight--;
      /* Only redraw once the burst is over, so counters settling do not
         swap the image out from under the next keystroke. */
      if (!state.inFlight) paint(view, ctx);
      ctx.refreshBadges();
    }).catch(function (err) {
      if (!state) return;
      state.inFlight--;
      if (isLabel) state.done--;
      state.rows.splice(Math.min(at, state.rows.length), 0, s);   // put it back
      paint(view, ctx);
      UI.toast('Could not save ' + s.id + ' — it is back in the queue.', 'err');
      if (err && err.status === 401) ctx.handleError(err);
    });
  }

  function wire(view, ctx) {
    var $ = function (id) { return view.querySelector('#' + id); };

    var seed = $('f-seed'), clear = $('f-clear');
    if (seed) seed.addEventListener('change', function () {
      state.filters.seedTypeId = seed.value || null;
      reload(view, ctx);
    });
    if (clear) clear.addEventListener('click', function () {
      state.filters.seedTypeId = null;
      reload(view, ctx);
    });

    var refresh = $('rq-refresh');
    if (refresh) refresh.addEventListener('click', function () {
      this.classList.add('spinning');
      reload(view, ctx, true);
    });

    var toggle = $('toggle-view');
    if (toggle) toggle.addEventListener('click', function () {
      state.mode = state.mode === 'grid' ? 'single' : 'grid';
      paint(view, ctx);
    });

    var prev = $('nav-prev'), next = $('nav-next');
    if (prev) prev.addEventListener('click', function () { go(view, ctx, -1); });
    if (next) next.addEventListener('click', function () { go(view, ctx, 1); });

    UI.on(view, 'click', '[data-jump]', function (e, el) {
      state.index = parseInt(el.getAttribute('data-jump'), 10);
      state.mode = 'single';
      paint(view, ctx);
    });

    UI.on(view, 'click', '[data-label]', function (e, el) {
      decide(view, ctx, el.getAttribute('data-label'));
    });

    var discard = $('act-discard'), skip = $('act-skip');
    if (discard) discard.addEventListener('click', function () { decide(view, ctx, 'discard'); });
    if (skip) skip.addEventListener('click', function () { decide(view, ctx, 'skip'); });
  }

  /* Shortcuts for anyone labelling in bulk; nothing in the interface
     depends on knowing they exist. */
  function onKey(view, ctx) {
    return function (e) {
      if (!state || state.mode !== 'single' || !current()) return;
      if (!SettingsView.readPrefs().keyboard) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3') { e.preventDefault(); decide(view, ctx, QUALITY[parseInt(k, 10) - 1].key); }
      else if (k === 'd') { e.preventDefault(); decide(view, ctx, 'discard'); }
      else if (k === 's') { e.preventDefault(); decide(view, ctx, 'skip'); }
      else if (k === 'arrowleft') { e.preventDefault(); go(view, ctx, -1); }
      else if (k === 'arrowright') { e.preventDefault(); go(view, ctx, 1); }
    };
  }

  function reload(view, ctx, announce) {
    return Promise.all([
      API.getQueue(state.filters),
      API.getQueueStats()
    ]).then(function (res) {
      if (!state) return;            // the view was left while this was in flight
      state.rows = res[0].rows;
      state.stats = res[1];
      if (state.focusId) {
        var at = state.rows.map(function (r) { return r.id; }).indexOf(state.focusId);
        state.index = at > -1 ? at : 0;
        state.focusId = null;
      } else {
        state.index = Math.min(state.index, Math.max(0, state.rows.length - 1));
      }
      paint(view, ctx);
      if (announce) UI.toast(num(state.rows.length) + ' images waiting', 'ok');
      ctx.refreshBadges();
    }).catch(ctx.handleError);
  }

  function render(view, ctx, params) {
    view.innerHTML = skeleton();
    state = {
      rows: [], index: 0, done: 0,
      stats: { pending: 0, approvedToday: 0, rejectedToday: 0 },
      filters: { seedTypeId: params.seed || null },
      mode: 'single', inFlight: 0,
      focusId: params.id || null,
      seedTypes: []
    };

    var handler = onKey(view, ctx);
    document.addEventListener('keydown', handler);
    ctx.onLeave(function () { document.removeEventListener('keydown', handler); state = null; });

    API.getSeedTypes({ active: true, limit: 999 }).then(function (res) {
      if (!state) return;
      state.seedTypes = res.rows;
      return reload(view, ctx);
    }).catch(ctx.handleError);
  }

  global.LabelView = { render: render, title: 'Label images' };
})(window);
