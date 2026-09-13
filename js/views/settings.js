/* ============================================================
   Settings — your account, how labelling behaves, and who else
   is working on the dataset.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, icon = Icons.icon;

  var PREF_KEY = 'cafe.prefs';
  var DEFAULTS = { confirmDiscard: false, keyboard: true, digest: true, pageSize: '5' };

  function readPrefs() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function writePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* non-fatal */ }
  }

  function toggleRow(key, title, body, on) {
    return '<div class="toggle-row"><div class="tr-text"><strong>' + esc(title) + '</strong><small>' + esc(body) + '</small></div>' +
      '<label class="switch"><input type="checkbox" data-pref="' + key + '"' + (on ? ' checked' : '') +
      ' aria-label="' + esc(title) + '"><i></i></label></div>';
  }

  /* Three states, all visible: "System" is a real choice, not the
     absence of one, so it gets a button like the other two. */
  function appearanceCard() {
    var mode = Theme.get();
    var opts = [
      { id: 'system', name: 'System', icon: 'monitor' },
      { id: 'light', name: 'Light', icon: 'sun' },
      { id: 'dark', name: 'Dark', icon: 'moon' }
    ];
    var seg = opts.map(function (o) {
      return '<button type="button" data-theme-set="' + o.id + '" aria-pressed="' + (o.id === mode) + '">' +
        icon(o.icon) + esc(o.name) + '</button>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Appearance</h2>' +
        '<p>Applies to this browser only.</p></div></div>' +
      '<div class="card-body">' +
        '<div class="toggle-row" style="padding-top:0">' +
          '<div class="tr-text"><strong>Theme</strong>' +
            '<small>Long labelling sessions are easier on a dark screen. ' +
            'System follows your operating system as it changes.</small></div>' +
        '</div>' +
        '<div class="seg" role="group" aria-label="Theme">' + seg + '</div>' +
      '</div>' +
    '</div>';
  }

  function teamCard(rows) {
    var body = rows.map(function (u) {
      return '<tr>' +
        '<td><div class="seed-cell"><span class="avatar avatar-sm">' + esc(UI.initials(u.name)) + '</span>' + esc(u.name) + '</div></td>' +
        '<td><span class="badge ' + (u.role === 'admin' ? 'badge-blue' : 'badge-green') + '">' +
          esc(UI.roleName(u.role)) + '</span></td>' +
        '<td class="num">' + num(u.reviewed) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="card-head-text"><h2>Who is labelling</h2>' +
        '<p>Counts come from the working sample, not the whole warehouse.</p></div></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Name</th><th>Role</th><th>Images labelled</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '</div>';
  }

  function render(view, ctx) {
    var user = API.session().user;
    var prefs = readPrefs();

    function paint(team) {
      view.innerHTML =
        '<div class="page-head"><div class="page-head-text">' +
          '<h1>Settings</h1><p>Your account, and how the labelling screen behaves for you.</p>' +
        '</div></div>' +

        '<div class="settings-grid">' +

          '<div class="card">' +
            '<div class="card-head"><div class="card-head-text"><h2>Your account</h2></div></div>' +
            '<div class="card-body">' +
              '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
                '<span class="avatar" style="width:54px;height:54px;font-size:17px">' + esc(UI.initials(user.name)) + '</span>' +
                '<div><div style="font-size:16px;font-weight:700">' + esc(user.name) + '</div>' +
                  '<div class="t-muted">' + esc(user.email) + '</div></div>' +
              '</div>' +
              '<div class="info-row"><span class="k">Role</span><span class="v">' +
                '<span class="badge ' + (user.role === 'admin' ? 'badge-blue' : 'badge-green') + '">' +
                esc(UI.roleName(user.role)) + '</span></span></div>' +
              '<div class="info-row"><span class="k">You can</span><span class="v">' +
                esc(user.role === 'admin'
                  ? 'Label images and manage the seed catalogue'
                  : 'Label images') +
              '</span></div>' +
            '</div>' +
            '<div class="card-foot"><span></span>' +
              '<button class="btn btn-danger" type="button" id="set-logout">' + icon('logout') + 'Sign out</button></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><div class="card-head-text"><h2>Labelling</h2></div></div>' +
            '<div class="card-body">' +
              '<div class="field"><label for="set-page">Rows shown per page</label>' +
                '<select class="select" id="set-page">' +
                  UI.selectOptions([{ id: '5', name: '5 rows' }, { id: '10', name: '10 rows' }, { id: '25', name: '25 rows' }],
                    'id', 'name', prefs.pageSize) + '</select></div>' +
              toggleRow('confirmDiscard', 'Ask before throwing an image out',
                'A quick confirmation so nothing leaves the dataset by accident.', prefs.confirmDiscard) +
              toggleRow('keyboard', 'Keyboard shortcuts',
                '1 Good, 2 Normal, 3 Bad, D to throw out, S to decide later, arrow keys to move.', prefs.keyboard) +
              toggleRow('digest', 'Daily email summary',
                'How many images were labelled, and how the classes are balancing out.', prefs.digest) +
            '</div>' +
          '</div>' +

          appearanceCard() +

          teamCard(team) +

        '</div>';

      UI.on(view, 'change', '[data-pref]', function (e, el) {
        prefs[el.getAttribute('data-pref')] = el.checked;
        writePrefs(prefs);
        UI.toast('Saved', 'ok');
      });
      view.querySelector('#set-page').addEventListener('change', function () {
        prefs.pageSize = this.value; writePrefs(prefs); UI.toast('Saved', 'ok');
      });
      function syncTheme() {
        var mode = Theme.get();
        view.querySelectorAll('[data-theme-set]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === mode));
        });
      }
      UI.on(view, 'click', '[data-theme-set]', function (e, el) {
        Theme.set(el.getAttribute('data-theme-set'));
        UI.announce('Theme: ' + Theme.resolved());
      });
      /* The topbar can change the theme while this screen is open. */
      ctx.onLeave(Theme.onChange(syncTheme));
      view.querySelector('#set-logout').addEventListener('click', function () { ctx.logout(); });
    }

    paint([]);
    API.getPeople({ limit: 999 }).then(function (res) {
      paint(res.rows.filter(function (u) { return u.role !== 'farmer'; }));
    }).catch(function () { /* the team list is not essential to this screen */ });
  }

  global.SettingsView = { render: render, title: 'Settings', readPrefs: readPrefs };
})(window);
