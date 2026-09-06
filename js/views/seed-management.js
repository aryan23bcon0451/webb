/* ============================================================
   Seed management — the lists the field app reads.

   Three tabs, each the same shape: type a name, press Add, or
   search what is already there. Nothing else to learn.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, icon = Icons.icon;

  var state = null;

  var TABS = [
    { id: 'types', label: 'Seed types', icon: 'sprout' },
    { id: 'varieties', label: 'Varieties', icon: 'wheat' },
    { id: 'companies', label: 'Companies', icon: 'building' }
  ];

  function tabBar() {
    return '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="tab ' + (state.tab === t.id ? 'on' : '') + '" type="button" data-tab="' + t.id + '">' +
        icon(t.icon) + t.label + '</button>';
    }).join('') + '</div>';
  }

  /** Add form + search, identical across the three tabs. */
  function toolbar(o) {
    return '<div class="card-body sm-tools">' +
      '<div class="sm-add">' +
        '<input class="input" id="sm-name" placeholder="' + esc(o.placeholder) + '">' +
        (o.selectRows
          ? '<select class="select" id="sm-parent" style="max-width:190px">' +
              UI.selectOptions(o.selectRows, 'id', 'name', null, 'Seed type') + '</select>'
          : '') +
        '<button class="btn btn-primary" type="button" id="sm-add">' + icon('plus') + esc(o.addLabel) + '</button>' +
      '</div>' +
      '<div class="search-field sm-search"><span class="search-ico">' + icon('search') + '</span>' +
        '<input class="input" id="sm-search" placeholder="' + esc(o.searchPlaceholder) + '" value="' + esc(state.search) + '"></div>' +
    '</div>';
  }

  function statusBadge(active) {
    return '<span class="badge ' + (active ? 'badge-green' : 'badge-gray') + '">' + (active ? 'In use' : 'Hidden') + '</span>';
  }

  /** One plain button rather than a menu behind a "…". */
  function toggleCell(id, active) {
    return '<td style="text-align:right">' +
      '<button class="btn btn-sm" type="button" data-toggle="' + esc(id) + '">' +
        (active ? 'Hide' : 'Use again') + '</button></td>';
  }

  function panel() {
    var p = state.data;
    var head, body, tools, noun;

    if (state.tab === 'types') {
      noun = 'seed types';
      tools = toolbar({
        placeholder: 'New seed type, e.g. Wheat',
        addLabel: 'Add seed type',
        searchPlaceholder: 'Search seed types…'
      });
      head = '<tr><th>Name</th><th>Varieties</th><th>Status</th><th></th></tr>';
      body = p.rows.map(function (row) {
        return '<tr>' +
          '<td><div class="seed-cell"><span class="seed-glyph" aria-hidden="true">' + esc(row.glyph) + '</span>' + esc(row.name) + '</div></td>' +
          '<td class="num">' + num(row.varietyCount) + '</td>' +
          '<td>' + statusBadge(row.active) + '</td>' +
          toggleCell(row.id, row.active) +
        '</tr>';
      }).join('');

    } else if (state.tab === 'varieties') {
      noun = 'varieties';
      tools = toolbar({
        placeholder: 'New variety, e.g. HD-2967',
        addLabel: 'Add variety',
        searchPlaceholder: 'Search varieties…',
        selectRows: state.seedTypes
      });
      head = '<tr><th>Variety</th><th>Seed type</th><th>Labelled images</th><th>Progress</th></tr>';
      body = p.rows.map(function (row) {
        return '<tr>' +
          '<td><div class="seed-cell"><span class="seed-glyph" aria-hidden="true">' + esc(row.glyph) + '</span>' + esc(row.name) + '</div></td>' +
          '<td class="t-muted">' + esc(row.seedTypeName) + '</td>' +
          '<td class="num">' + num(row.approved) + '</td>' +
          '<td><div class="progress-cell"><span>' + row.progress + '%</span>' +
            '<div class="bar ' + (row.progress >= 85 ? '' : row.progress >= 60 ? 'amber' : 'red') + '">' +
            '<i style="width:' + row.progress + '%"></i></div></div></td>' +
        '</tr>';
      }).join('');

    } else {
      noun = 'companies';
      tools = toolbar({
        placeholder: 'New company, e.g. Greenfield Seeds',
        addLabel: 'Add company',
        searchPlaceholder: 'Search companies…'
      });
      head = '<tr><th>Company</th><th>Location</th><th>Varieties supplied</th></tr>';
      body = p.rows.map(function (row) {
        return '<tr>' +
          '<td><div class="seed-cell"><span class="seed-glyph" aria-hidden="true">' + icon('building') + '</span>' + esc(row.name) + '</div></td>' +
          '<td class="t-muted">' + esc(row.location) + '</td>' +
          '<td class="num">' + num(row.varietyCount) + '</td>' +
        '</tr>';
      }).join('');
    }

    var foot = '';
    if (p.total) {
      var from = (p.page - 1) * p.limit + 1;
      var to = Math.min(p.page * p.limit, p.total);
      foot = '<div class="card-foot"><span>Showing ' + from + '–' + to + ' of ' + num(p.total) + ' ' + noun + '</span>' +
        UI.pager(p.page, p.pages) + '</div>';
    }

    return '<div class="card">' + tools +
      (p.rows.length
        ? '<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
        : UI.empty('Nothing found', 'Try a different search, or add one above.', 'sprout')) +
      foot +
    '</div>';
  }

  function paint(view, ctx) {
    view.innerHTML =
      '<div class="page-head"><div class="page-head-text">' +
        '<h1>Seed catalogue</h1>' +
        '<p>What the capture app offers people when they take a photo. Hide a seed type here and it disappears from their list.</p>' +
      '</div></div>' +
      tabBar() + panel();

    wire(view, ctx);
  }

  function wire(view, ctx) {
    var $ = function (id) { return view.querySelector('#' + id); };

    UI.on(view, 'click', '[data-tab]', function (e, el) {
      state.tab = el.getAttribute('data-tab');
      state.search = '';
      state.page = 1;
      reload(view, ctx);
    });

    var name = $('sm-name'), parent = $('sm-parent'), add = $('sm-add');

    function submit() {
      var call = state.tab === 'types' ? API.createSeedType(name.value)
        : state.tab === 'varieties' ? API.createVariety(name.value, parent ? parent.value : null)
        : API.createCompany(name.value);
      call.then(function (row) {
        UI.toast('Added "' + row.name + '"', 'ok');
        state.search = ''; state.page = 1;
        return reload(view, ctx);
      }).catch(ctx.handleError);
    }
    if (add) add.addEventListener('click', submit);
    if (name) name.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    /* Debounced so each keystroke does not fire a request. */
    var search = $('sm-search');
    if (search) search.addEventListener('input', function () {
      clearTimeout(state.searchTimer);
      var v = search.value;
      state.searchTimer = setTimeout(function () {
        state.search = v; state.page = 1;
        reload(view, ctx).then(function () {
          var again = view.querySelector('#sm-search');
          if (again) { again.focus(); again.setSelectionRange(v.length, v.length); }
        });
      }, 260);
    });

    UI.on(view, 'click', '[data-toggle]', function (e, el) {
      var id = el.getAttribute('data-toggle');
      var row = state.data.rows.filter(function (r) { return r.id === id; })[0];
      API.setSeedTypeActive(id, !row.active)
        .then(function (r) {
          UI.toast('"' + r.name + '" is ' + (r.active ? 'back in use' : 'hidden from uploaders'), 'ok');
          return reload(view, ctx);
        })
        .catch(ctx.handleError);
    });

    UI.on(view, 'click', '.pager button[data-page]', function (e, el) {
      var p = parseInt(el.getAttribute('data-page'), 10);
      if (isNaN(p)) return;
      state.page = p;
      reload(view, ctx);
    });
  }

  function reload(view, ctx) {
    var q = { search: state.search, page: state.page, limit: parseInt(SettingsView.readPrefs().pageSize, 10) || 5 };
    var call = state.tab === 'types' ? API.getSeedTypes(q)
      : state.tab === 'varieties' ? API.getVarieties(q)
      : API.getCompanies(q);
    return call.then(function (data) {
      if (!state) return null;       // the view was left while this was in flight
      state.data = data;
      state.page = data.page;
      return API.getSeedTypes({ active: true, limit: 999 });
    }).then(function (types) {
      if (!state || !types) return;
      state.seedTypes = types.rows;
      paint(view, ctx);
    }).catch(ctx.handleError);
  }

  function render(view, ctx, params) {
    view.innerHTML = '<div class="skeleton" style="height:520px;border-radius:14px"></div>';
    state = {
      tab: params.tab && ['types', 'varieties', 'companies'].indexOf(params.tab) > -1 ? params.tab : 'types',
      search: '', page: 1, searchTimer: null,
      data: { rows: [], total: 0, page: 1, pages: 1, limit: 5 }, seedTypes: []
    };
    ctx.onLeave(function () { clearTimeout(state.searchTimer); state = null; });
    reload(view, ctx);
  }

  global.SeedManagementView = { render: render, title: 'Seed management' };
})(window);
