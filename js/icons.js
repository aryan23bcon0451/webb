/* Inline SVG icon set (stroke-based, 24x24 viewBox). */
(function (global) {
  'use strict';

  var P = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8.1 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>',
    sprout: '<path d="M12 21V11"/><path d="M12 11C12 7.7 9.5 5 6 5c0 3.3 2.5 6 6 6z"/><path d="M12 12c0-3.3 2.5-6 6-6 0 3.3-2.5 6-6 6z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16.5 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3.2"/><path d="M4 6v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6"/><path d="M4 12v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    flag: '<path d="M4 21V4"/><path d="M4 4h11l-1.6 3.5L15 11H4"/>',
    filter: '<path d="M3 5h18l-7.2 8.2V20l-3.6-2v-4.8z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    skip: '<path d="m4 5 8 7-8 7z"/><path d="m13 5 8 7-8 7z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3.5 17 5-5 4.5 4.5L16 14l4.5 4.5"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h1.5"/><path d="M13.5 8H15"/><path d="M9 12h1.5"/><path d="M13.5 12H15"/><path d="M10 21v-4h4v4"/>',
    wheat: '<path d="M12 21V9"/><path d="M12 12c-2.2 0-4-1.8-4-4 2.2 0 4 1.8 4 4z"/><path d="M12 12c2.2 0 4-1.8 4-4-2.2 0-4 1.8-4 4z"/><path d="M12 7C9.8 7 8 5.2 8 3c2.2 0 4 1.8 4 4z"/><path d="M12 7c2.2 0 4-1.8 4-4-2.2 0-4 1.8-4 4z"/>',
    trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    trendDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M21 17v-6h-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    inbox: '<path d="M21 12h-5l-2 3h-4l-2-3H3"/><path d="M5.5 5h13l2.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
    menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    tag: '<path d="M20.5 12.5 12 21l-8.5-8.5V4H12z"/><circle cx="8" cy="8" r="1.4"/>',
    ruler: '<rect x="2.5" y="8" width="19" height="8" rx="2" transform="rotate(-45 12 12)"/><path d="M9 7.5 10.5 9"/><path d="M11.5 10 13 11.5"/><path d="M14 12.5 15.5 14"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3.2 9h17.6"/><path d="M3.2 15h17.6"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
    key: '<circle cx="8" cy="14" r="4.5"/><path d="m11.5 11 8-8"/><path d="m17 5.5 2.5 2.5"/><path d="m14.5 8 2.5 2.5"/>',
    download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>',
    alert: '<path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 16.8h.01"/>',
    spark: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M4.9 4.9 7 7"/><path d="m17 17 2.1 2.1"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="3.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
    moon: '<path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z"/>',
    monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M9 21h6"/><path d="M12 17v4"/>',
    trash: '<path d="M3.5 6h17"/><path d="M8.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V6"/><path d="M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
    upload: '<path d="M12 15.5V3.5"/><path d="m7 8.5 5-5 5 5"/><path d="M20.5 15v3.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V15"/>',
    video: '<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3.2v9.4L16 13.5"/>'
  };

  var ALIASES = {
    'chevron-down': 'chevronDown', 'chevron-left': 'chevronLeft', 'chevron-right': 'chevronRight',
    'arrow-left': 'arrowLeft', 'check-circle': 'checkCircle', 'x-circle': 'xCircle',
    'trend-up': 'trendUp', 'trend-down': 'trendDown'
  };

  function icon(name, size) {
    var key = ALIASES[name] || name;
    var body = P[key];
    if (!body) return '';
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /** Hydrate every [data-icon] element in a subtree. */
  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.getAttribute('data-icon'));
      el.removeAttribute('data-icon');
    });
  }

  global.Icons = { icon: icon, hydrate: hydrate, has: function (n) { return !!P[ALIASES[n] || n]; } };
})(window);
