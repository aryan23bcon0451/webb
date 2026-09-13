/* ============================================================
   Home — the landing page.

   Four numbers, one button, and the images that are next in
   line. Everything here is a shortcut into Label images or
   the Dataset screen; nothing is only readable here.
   ============================================================ */
(function (global) {
  'use strict';
  var esc = UI.esc, num = UI.num, icon = Icons.icon;

  function skeleton() {
    var cards = '';
    for (var i = 0; i < 4; i++) cards += '<div class="stat"><div class="skeleton" style="height:96px"></div></div>';
    var tiles = '';
    for (var j = 0; j < 6; j++) tiles += '<div class="skeleton" style="height:250px;border-radius:14px"></div>';
    return '<div class="skeleton" style="height:104px;border-radius:18px;margin-bottom:20px"></div>' +
      '<div class="stat-grid c4">' + cards + '</div>' +
      '<div class="card"><div class="photo-grid">' + tiles + '</div></div>';
  }

  /** One sentence saying what would help the dataset most right now. */
  function nextStep(h, pending) {
    if (h.balanceRatio > 4) {
      return 'The dataset is short on "' + h.smallest.label + '" images — ' + num(h.smallest.count) +
        ' against ' + num(h.largest.count) + ' "' + h.largest.label + '". Those are the ones worth collecting.';
    }
    if (pending > 0) return num(pending) + ' images are waiting for a label.';
    return 'Nothing is waiting. The dataset is up to date.';
  }

  function render(view, ctx) {
    view.innerHTML = skeleton();

    Promise.all([
      API.getDashboardStats(),
      API.getDatasetHealth(),
      API.getQueue({})
    ]).then(function (res) {
      var s = res[0];
      var h = res[1];
      var queue = res[2].rows;
      var featured = queue.slice(0, 6);
      var user = API.session().user;
      var firstName = user.name.split(' ')[0];

      var cards = [
        UI.statCard({
          label: 'Images in the dataset', value: num(h.labelled), icon: 'database', tone: 'green',
          sub: 'Labelled and ready to train on', route: '#/dataset'
        }),
        UI.statCard({
          label: 'Waiting for a label', value: num(s.pendingReview), icon: 'clock', tone: 'amber',
          sub: 'Start labelling', route: '#/label'
        }),
        UI.statCard({
          label: 'Labelled today', value: num(s.approvedToday), icon: 'check-circle', tone: 'blue',
          sub: num(s.rejectedToday) + ' thrown out', route: '#/dataset?tab=images'
        }),
        UI.statCard({
          label: 'Smallest class', value: esc(h.smallest.label), icon: 'spark', tone: 'brand',
          sub: num(h.smallest.count) + ' images — collect more of these', route: '#/dataset'
        })
      ].join('');

      var tiles = featured.map(function (sub) {
        return '<button class="photo-card" type="button" data-open="' + esc(sub.id) + '">' +
          '<div class="photo-thumb">' +
            '<img src="' + Photos.of(sub) + '" alt="' + esc(sub.seedTypeName) + ' seed image taken by ' + esc(sub.farmerName) + '" loading="lazy">' +
            '<span class="photo-open">' + icon('chevron-right') + '</span>' +
          '</div>' +
          '<div class="photo-meta">' +
            '<strong>' + esc(sub.glyph) + ' ' + esc(sub.seedTypeName) + '</strong>' +
            '<small>from ' + esc(sub.farmerName) + ' · ' + UI.ago(sub.uploadedAt) + '</small>' +
          '</div>' +
        '</button>';
      }).join('');

      view.innerHTML =
        '<section class="greet">' +
          '<div class="greet-text">' +
            '<h1>' + esc(UI.greeting()) + ', ' + esc(firstName) + '</h1>' +
            '<p>' + esc(nextStep(h, s.pendingReview)) + '</p>' +
          '</div>' +
          '<button class="btn btn-lg greet-cta" type="button" data-route="#/label">' +
            icon('spark') + 'Start labelling</button>' +
        '</section>' +

        '<div class="stat-grid c4">' + cards + '</div>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div class="card-head-text"><h2>Next in line</h2>' +
              '<p>Click an image to label it.</p></div>' +
            '<button class="btn" type="button" data-route="#/label">See all ' + num(queue.length) + '</button>' +
          '</div>' +
          (featured.length
            ? '<div class="photo-grid">' + tiles + '</div>'
            : UI.empty('All caught up', 'Every image collected so far has a label.', 'check-circle')) +
        '</div>';

      UI.on(view, 'click', '[data-open]', function (e, el) {
        ctx.navigate('#/label?id=' + encodeURIComponent(el.getAttribute('data-open')));
      });
    }).catch(ctx.handleError);
  }

  global.DashboardView = { render: render, title: 'Home' };
})(window);
