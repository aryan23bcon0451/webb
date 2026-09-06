/* ============================================================
   Login — POST /auth/login. Routes by role once the JWT lands.
   ============================================================ */
(function (global) {
  'use strict';
  var icon = Icons.icon, esc = UI.esc;

  function render(root, onSuccess) {
    root.innerHTML =
      '<section class="login-art">' +
        '<div class="brand">' +
          '<div class="brand-mark">' + icon('sprout') + '</div>' +
          '<span class="brand-name">CAFE</span>' +
        '</div>' +
        '<div>' +
          '<h1>Build the seed quality dataset, one image at a time.</h1>' +
          '<p>Look at an image, say whether it is Good, Normal or Bad, and move on. ' +
             'Every label you give becomes training data.</p>' +
          '<div class="login-flow"><span>Collect</span><i>' + icon('chevron-right') + '</i>' +
            '<span>Label</span><i>' + icon('chevron-right') + '</i><span>Train</span></div>' +
        '</div>' +
        '<div class="login-stats">' +
          '<div><strong>4.58M</strong><small>Images collected</small></div>' +
          '<div><strong>32</strong><small>Seed types</small></div>' +
          '<div><strong>3</strong><small>Quality classes</small></div>' +
        '</div>' +
      '</section>' +
      '<section class="login-pane">' +
        '<form class="login-card" id="login-form" novalidate>' +
          '<h2>Sign in</h2>' +
          '<p class="sub">Welcome back.</p>' +
          '<div id="login-error"></div>' +
          '<div class="field">' +
            '<label for="li-id">Email</label>' +
            '<input class="input" id="li-id" name="identifier" type="text" autocomplete="username" ' +
              'placeholder="you@cafe.ag" value="alex.rivera@cafe.ag">' +
          '</div>' +
          '<div class="field">' +
            '<label for="li-pw">Password</label>' +
            '<input class="input" id="li-pw" name="password" type="password" autocomplete="current-password" ' +
              'placeholder="••••••••" value="demo1234">' +
          '</div>' +
          '<button class="btn btn-primary btn-lg btn-block" type="submit" id="li-submit">' +
            icon('lock') + '<span>Sign in</span></button>' +
          '<div class="login-hint">' +
            '<strong>Demo accounts</strong><br>' +
            'Admin — <code>alex.rivera@cafe.ag</code><br>' +
            'Labeller — <code>priya.nair@cafe.ag</code><br>' +
            'Any password of four characters or more.' +
          '</div>' +
        '</form>' +
      '</section>';

    var form = root.querySelector('#login-form');
    var errBox = root.querySelector('#login-error');
    var submit = root.querySelector('#li-submit');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errBox.innerHTML = '';
      submit.disabled = true;
      submit.querySelector('span').textContent = 'Signing in…';
      API.login(form.identifier.value, form.password.value)
        .then(function (session) { onSuccess(session); })
        .catch(function (err) {
          errBox.innerHTML = '<div class="login-error">' + esc(err.message) + '</div>';
          submit.disabled = false;
          submit.querySelector('span').textContent = 'Sign in';
          form.password.focus();
        });
    });
  }

  global.LoginView = { render: render };
})(window);
