/* ============================================================
   Shell + hash router.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, icon = Icons.icon;

  var ROUTES = [
    { path: '/dashboard', label: 'Home', icon: 'grid', view: 'DashboardView' },
    { path: '/label', label: 'Label images', icon: 'spark', view: 'LabelView', badge: 'review' },
    { path: '/dataset', label: 'Dataset', icon: 'database', view: 'DatasetView' },
    { path: '/farmers', label: 'Farmers directory', icon: 'users', view: 'FarmersView', badge: 'farmers' },
    { path: '/seeds', label: 'Seed catalogue', icon: 'sprout', view: 'SeedManagementView' },
    { path: '/settings', label: 'Settings', icon: 'gear', view: 'SettingsView' }
  ];

  /* Old bookmarks from when these screens had different names. */
  var LEGACY = { '/review': '/label', '/users': '/dataset' };

  var loginRoot = document.getElementById('login-root');
  var appRoot = document.getElementById('app-root');
  var view = document.getElementById('view');
  var nav = document.getElementById('nav');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');

  var leaveHooks = [];
  var currentPath = null;

  /* ---------------------------------------------------- routing */
  function parseHash() {
    var raw = (location.hash || '#/dashboard').slice(1);
    var qi = raw.indexOf('?');
    var path = qi === -1 ? raw : raw.slice(0, qi);
    var params = {};
    if (qi > -1) {
      raw.slice(qi + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    if (!path || path === '/') path = '/dashboard';
    return { path: path, params: params };
  }

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  var ctx = {
    navigate: navigate,
    onLeave: function (fn) { leaveHooks.push(fn); },
    refreshBadges: refreshBadges,
    logout: logout,
    handleError: function (err) {
      if (err && err.status === 401) {
        UI.toast('Your session expired. Sign in again.', 'err');
        logout();
        return;
      }
      UI.toast((err && err.message) || 'Something went wrong.', 'err');
      if (err) console.error(err);
    }
  };

  /* ---------------------------------------------------- chrome */
  function renderNav(activePath) {
    nav.innerHTML = ROUTES.map(function (r) {
      /* Only the queue count changes under you, so only it is announced. */
      var live = r.badge === 'review' ? ' role="status" aria-atomic="true"' : '';
      return '<button class="nav-item ' + (r.path === activePath ? 'active' : '') + '" type="button" data-path="' + r.path + '">' +
        icon(r.icon) + '<span>' + esc(r.label) + '</span>' +
        (r.badge
          ? '<span class="nav-badge" id="badge-' + r.badge + '" aria-hidden="true">—</span>' +
            '<span class="sr-only" id="badge-' + r.badge + '-text"' + live + '></span>'
          : '') +
      '</button>';
    }).join('');
  }

  /* Each badge fetches its own count. The number alone reads as "323"
     out of nowhere after each save, so the hidden text carries the
     sentence instead. */
  var BADGES = {
    review: function () {
      return API.getQueueStats().then(function (s) {
        return { count: s.pending, said: UI.num(s.pending) + ' images waiting to be labelled' };
      });
    },
    farmers: function () {
      return API.getFarmers({ limit: 1 }).then(function (res) {
        return { count: res.summary.farmers, said: UI.num(res.summary.farmers) + ' farmers in the directory' };
      });
    }
  };

  function refreshBadges() {
    if (!API.session()) return;
    Object.keys(BADGES).forEach(function (key) {
      if (!document.getElementById('badge-' + key)) return;
      BADGES[key]().then(function (b) {
        var el = document.getElementById('badge-' + key);
        if (el) el.textContent = UI.num(b.count);
        var said = document.getElementById('badge-' + key + '-text');
        if (said) said.textContent = b.said;
      }).catch(function () { /* the badge is a convenience, not the source of truth */ });
    });
  }

  function renderProfile() {
    var user = API.session().user;
    var ini = UI.initials(user.name);
    document.getElementById('profile-avatar').textContent = ini;
    document.getElementById('sidebar-avatar').textContent = ini;
    document.getElementById('sidebar-name').textContent = user.name;
    document.getElementById('sidebar-role').textContent = UI.roleName(user.role);

    document.getElementById('profile-menu').innerHTML =
      '<div class="menu-head"><strong>' + esc(user.name) + '</strong><small>' + esc(user.email) + '</small></div>' +
      '<button type="button" data-path="/settings">' + icon('gear') + 'Settings</button>' +
      '<button type="button" class="danger" id="menu-logout">' + icon('logout') + 'Sign out</button>';
  }

  function setTitle(route) {
    var label = route ? route.label : 'Dashboard';
    document.getElementById('topbar-title').innerHTML = '<b>' + esc(label) + '</b>';
    document.title = label + ' · CAFE';
  }

  /* The topbar button is a straight flip: it shows where you would
     land, not where you are. The three-way choice, including
     "follow the system", lives on the Settings screen. */
  function paintThemeButton() {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    var goingDark = Theme.resolved() !== 'dark';
    var label = goingDark ? 'Switch to dark theme' : 'Switch to light theme';
    btn.innerHTML = icon(goingDark ? 'moon' : 'sun');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function closeNav() {
    sidebar.classList.remove('open');
    scrim.hidden = true;
  }

  /* ---------------------------------------------------- render */
  function render() {
    if (!API.session()) { showLogin(); return; }

    var r = parseHash();
    if (LEGACY[r.path]) { navigate('#' + LEGACY[r.path]); return; }
    var route = ROUTES.filter(function (x) { return x.path === r.path; })[0];
    if (!route) { navigate('#/dashboard'); return; }

    leaveHooks.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    leaveHooks = [];
    closeNav();

    currentPath = route.path;
    renderNav(route.path);
    setTitle(route);
    refreshBadges();
    view.scrollTop = 0;
    window.scrollTo(0, 0);

    var View = global[route.view];
    if (!View) { view.innerHTML = UI.empty('View unavailable', route.label + ' failed to load.'); return; }
    View.render(view, ctx, r.params);
  }

  /* ---------------------------------------------------- auth */
  function showLogin() {
    appRoot.hidden = true;
    loginRoot.hidden = false;
    LoginView.render(loginRoot, function () {
      loginRoot.hidden = true;
      loginRoot.innerHTML = '';
      appRoot.hidden = false;
      renderProfile();
      UI.toast('Signed in as ' + API.session().user.name, 'ok');
      if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
      else render();
    });
  }

  function logout() {
    leaveHooks.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    leaveHooks = [];
    API.logout();
    view.innerHTML = '';
    showLogin();
  }

  /* ---------------------------------------------------- wiring */
  function boot() {
    Icons.hydrate(document);
    UI.autoCloseMenus();

    /* Sidebar + any element carrying data-path / data-route. */
    document.addEventListener('click', function (e) {
      var nv = e.target.closest('[data-path]');
      if (nv) { navigate('#' + nv.getAttribute('data-path')); return; }
      var rt = e.target.closest('[data-route]');
      if (rt) { navigate(rt.getAttribute('data-route')); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var rt = e.target.closest && e.target.closest('[data-route]');
      if (rt && rt.getAttribute('role') === 'link') { e.preventDefault(); navigate(rt.getAttribute('data-route')); }
    });

    var pBtn = document.getElementById('profile-btn');
    var pMenu = document.getElementById('profile-menu');
    pBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      pMenu.hidden = !pMenu.hidden;
      pBtn.setAttribute('aria-expanded', String(!pMenu.hidden));
    });
    pMenu.addEventListener('click', function (e) {
      if (e.target.closest('#menu-logout')) { pMenu.hidden = true; logout(); return; }
      if (e.target.closest('[data-path]')) pMenu.hidden = true;
    });

    document.getElementById('sidebar-user').addEventListener('click', function () { navigate('#/settings'); });

    paintThemeButton();
    Theme.onChange(paintThemeButton);
    document.getElementById('theme-btn').addEventListener('click', function () {
      Theme.toggle();
      UI.announce('Theme: ' + Theme.resolved());
    });

    document.getElementById('refresh-btn').addEventListener('click', function () {
      var btn = this;
      btn.classList.add('spinning');
      render();
      setTimeout(function () { btn.classList.remove('spinning'); }, 700);
    });

    document.getElementById('menu-toggle').addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      scrim.hidden = !open;
    });
    scrim.addEventListener('click', closeNav);

    window.addEventListener('hashchange', render);

    if (API.session()) {
      loginRoot.hidden = true;
      appRoot.hidden = false;
      renderProfile();
      if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
      else render();
    } else {
      showLogin();
    }
  }

  boot();
})(window);
