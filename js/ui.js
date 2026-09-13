/* ============================================================
   Shared rendering helpers used by every view.
   ============================================================ */
(function (global) {
  'use strict';

  var icon = Icons.icon;

  /* ---------------------------------------------------- text */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return (n == null ? 0 : Math.round(n)).toLocaleString('en-US'); }
  function pct(n, digits) { return (n || 0).toFixed(digits == null ? 1 : digits) + '%'; }
  function signed(n) { return (n > 0 ? '+' : '') + num(n); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function dateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return date(ts) + ' · ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function ago(ts) {
    if (!ts) return '—';
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    var d = Math.round(h / 24); if (d < 30) return d + 'd ago';
    return date(ts);
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function greeting(d) {
    var h = (d || new Date()).getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  /* The stored role names are what the API gates on; these are the
     words the interface uses for them. */
  var ROLE_NAMES = { admin: 'Admin', verifier: 'Labeller', farmer: 'Uploader' };
  function roleName(role) { return ROLE_NAMES[role] || String(role || ''); }

  /* ---------------------------------------------------- status */
  var STATUS = {
    pending_verification: { label: 'Waiting', cls: 'badge-amber' },
    approved: { label: 'In dataset', cls: 'badge-green' },
    rejected: { label: 'Thrown out', cls: 'badge-red' }
  };
  function statusBadge(status) {
    var s = STATUS[status] || { label: status, cls: 'badge-gray' };
    return '<span class="badge ' + s.cls + '">' + esc(s.label) + '</span>';
  }
  var LABEL_CLS = { Good: 'badge-green', Normal: 'badge-amber', Bad: 'badge-red' };
  function labelBadge(label) {
    if (!label) return '<span class="t-muted">—</span>';
    return '<span class="badge ' + (LABEL_CLS[label] || 'badge-gray') + '">' +
      '<i class="badge-dot"></i>' + esc(label) + '</span>';
  }

  /* ---------------------------------------------------- toast */
  function toast(message, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    var ico = kind === 'ok' ? 'check-circle' : kind === 'err' ? 'x-circle' : 'info';
    el.innerHTML = icon(ico) + '<span>' + esc(message) + '</span>';
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 3000);
  }

  /**
   * Say something to a screen reader without showing it or moving focus.
   * The region lives in the shell, not in a view — a live region only
   * announces reliably when it was already in the page before its text
   * changed. Use a whole sentence: a bare number announced on its own
   * means nothing.
   */
  function announce(message) {
    var region = document.getElementById('live-region');
    if (!region) return;
    /* Same text twice in a row is otherwise silent. */
    region.textContent = region.textContent === message ? message + ' ' : message;
  }

  /* ---------------------------------------------------- charts */
  /** Smooth area sparkline; `stroke` is any CSS colour. */
  function sparkline(values, stroke, id) {
    if (!values || !values.length) return '';
    var W = 240, H = 42, pad = 2;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var step = W / (values.length - 1);
    var pts = values.map(function (v, i) {
      return [i * step, pad + (H - pad * 2) * (1 - (v - min) / span)];
    });
    var d = pts.map(function (p, i) {
      if (i === 0) return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      var prev = pts[i - 1];
      var cx = (prev[0] + p[0]) / 2;
      return 'C' + cx.toFixed(1) + ' ' + prev[1].toFixed(1) + ' ' + cx.toFixed(1) + ' ' + p[1].toFixed(1) +
        ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
    var gid = 'sp' + (id || Math.random().toString(36).slice(2, 8));
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + stroke + '" stop-opacity="0.22"/>' +
      '<stop offset="1" stop-color="' + stroke + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  /* ---------------------------------------------------- blocks */
  /**
   * Stat card.
   * opts: { label, value, icon, tone, delta:{text,dir}, sub, spark:{values,color},
   *         bar:{pct,tone}, route }
   */
  function statCard(o) {
    var linked = o.route ? ' linked' : '';
    var attrs = o.route ? ' data-route="' + esc(o.route) + '" role="link" tabindex="0"' : '';
    var h = '<div class="stat' + linked + '"' + attrs + '>';
    h += '<div class="stat-top"><div class="stat-ico i-' + (o.tone || 'blue') + '">' + icon(o.icon) + '</div>' +
      '<div class="stat-label">' + esc(o.label) + '</div></div>';
    h += '<div class="stat-value">' + esc(o.value) + '</div>';
    if (o.delta) {
      var cls = o.delta.dir === 'up' ? 't-green' : o.delta.dir === 'down' ? 't-red' : 't-muted';
      var ic = o.delta.dir === 'up' ? 'trend-up' : o.delta.dir === 'down' ? 'trend-down' : null;
      h += '<div class="stat-delta ' + cls + '">' + (ic ? icon(ic) : '') + '<span>' + esc(o.delta.text) + '</span></div>';
    } else if (o.sub) {
      h += '<div class="stat-delta t-muted"><span>' + esc(o.sub) + '</span></div>';
    }
    if (o.bar) h += '<div class="bar ' + (o.bar.tone || '') + '"><i style="width:' + Math.max(2, Math.min(100, o.bar.pct)) + '%"></i></div>';
    if (o.spark) h += '<div class="stat-spark">' + sparkline(o.spark.values, o.spark.color, o.spark.id) + '</div>';
    h += '</div>';
    return h;
  }

  /** Pagination control. Emits buttons carrying data-page. */
  function pager(page, pages) {
    if (pages <= 1) return '<div class="pager"></div>';
    var out = ['<div class="pager">'];
    out.push('<button type="button" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') +
      ' aria-label="Previous page">' + icon('chevron-left') + '</button>');
    var shown = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1 || (page <= 3 && i <= 5) || (page >= pages - 2 && i >= pages - 4)) shown.push(i);
    }
    var last = 0;
    shown.forEach(function (i) {
      if (i - last > 1) out.push('<button type="button" class="gap" disabled>…</button>');
      out.push('<button type="button" data-page="' + i + '" class="' + (i === page ? 'on' : '') + '">' + i + '</button>');
      last = i;
    });
    out.push('<button type="button" data-page="' + (page + 1) + '"' + (page === pages ? ' disabled' : '') +
      ' aria-label="Next page">' + icon('chevron-right') + '</button>');
    out.push('</div>');
    return out.join('');
  }

  function empty(title, body, ico) {
    return '<div class="empty">' + icon(ico || 'inbox') +
      '<strong>' + esc(title) + '</strong><span>' + esc(body || '') + '</span></div>';
  }

  function selectOptions(rows, valueKey, labelKey, selected, placeholder) {
    var out = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    rows.forEach(function (r) {
      var v = r[valueKey];
      out += '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(r[labelKey]) + '</option>';
    });
    return out;
  }

  /** Close any open .menu when clicking outside it. */
  function autoCloseMenus() {
    document.addEventListener('click', function (e) {
      document.querySelectorAll('.menu:not([hidden])').forEach(function (m) {
        if (m.contains(e.target)) return;
        var trigger = m.previousElementSibling;
        if (trigger && trigger.contains(e.target)) return;
        m.hidden = true;
        if (trigger && trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.menu:not([hidden])').forEach(function (m) { m.hidden = true; });
    });
  }

  /** Delegate clicks inside `root` for elements matching `sel`. */
  function on(root, event, sel, fn) {
    root.addEventListener(event, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) fn(e, t);
    });
  }

  /**
   * Same as `on(root, 'click', ...)`, but Enter and Space work too.
   * For anything that behaves like a button without being one — a table
   * row that opens a drawer, say — which is otherwise mouse-only.
   */
  function onActivate(root, sel, fn) {
    on(root, 'click', sel, fn);
    on(root, 'keydown', sel, function (e, t) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();          /* Space would scroll the page */
      fn(e, t);
    });
  }

  /** Attributes that make a non-button element behave like one. */
  function rowButton(label) {
    return ' role="button" tabindex="0" aria-label="' + esc(label) + '"';
  }

  global.UI = {
    esc: esc, num: num, pct: pct, signed: signed,
    date: date, dateTime: dateTime, ago: ago, initials: initials, greeting: greeting,
    roleName: roleName, statusBadge: statusBadge, labelBadge: labelBadge, statusMap: STATUS,
    toast: toast, announce: announce, sparkline: sparkline, statCard: statCard, pager: pager,
    empty: empty, selectOptions: selectOptions, autoCloseMenus: autoCloseMenus,
    on: on, onActivate: onActivate, rowButton: rowButton,
    icon: icon
  };
})(window);
