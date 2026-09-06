/* ============================================================
   Procedural seedling photography.
   Every submission image is generated deterministically from its
   numeric id, so the dashboard renders identically offline with
   no external asset hosting. Swap `Photos.url()` for the real
   S3 pre-signed URL returned by the API when wiring a backend.
   ============================================================ */
(function (global) {
  'use strict';

  function rng(seed) {
    var t = (seed >>> 0) + 0x6D2B79F5;
    return function () {
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Per-crop foliage palettes: [leafLight, leafDark, soil, bokeh] */
  var PALETTE = {
    Wheat:     ['#A8C24A', '#5E7B1E', '#2A2413', '#C9D96B'],
    Rice:      ['#7FD08A', '#22633B', '#15251C', '#9EE7A8'],
    Maize:     ['#9BD24E', '#3F6B1C', '#241F12', '#CBE277'],
    Soybean:   ['#69C97A', '#1E5C34', '#1A2118', '#8FE39C'],
    Cotton:    ['#8FCB86', '#2E6136', '#20231A', '#D9E7BC'],
    Barley:    ['#B5C95C', '#66801F', '#2B2716', '#D6E184'],
    Mustard:   ['#C7D24A', '#7A7C1B', '#2C2A13', '#E4E081'],
    Groundnut: ['#7CC46B', '#2B5F27', '#231F14', '#A7DC93'],
    Sugarcane: ['#77CC7E', '#215E32', '#1B2519', '#9BE2A2'],
    Sorghum:   ['#A6C155', '#587326', '#282314', '#C8DA7C'],
    Chickpea:  ['#8ACB74', '#356331', '#211F15', '#B2DE99'],
    Millet:    ['#B0C85A', '#5F7A22', '#292616', '#D2DF80']
  };
  var FALLBACK = ['#7FD08A', '#25693D', '#191F18', '#A6E6AF'];

  function leaf(x, y, rot, scale, light, dark, veinOpacity) {
    return '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + rot.toFixed(1) + ') scale(' + scale.toFixed(3) + ')">' +
      '<path d="M0 0 C 26 -30 78 -34 108 -8 C 78 20 26 22 0 0 Z" fill="url(#lg)"/>' +
      '<path d="M0 0 C 26 -30 78 -34 108 -8" fill="none" stroke="' + light + '" stroke-opacity="0.5" stroke-width="2"/>' +
      '<path d="M2 0 C 40 -6 76 -8 104 -8" fill="none" stroke="' + dark + '" stroke-opacity="' + veinOpacity + '" stroke-width="2.4"/>' +
      '<path d="M22 -7 L 30 -18 M44 -9 L 52 -21 M66 -10 L 73 -20 M30 3 L 36 12 M54 2 L 60 11" ' +
      'fill="none" stroke="' + dark + '" stroke-opacity="0.34" stroke-width="1.6"/>' +
      '</g>';
  }

  function build(seed, cropName) {
    var r = rng(seed * 2654435761 % 2147483647);
    var pal = PALETTE[cropName] || FALLBACK;
    var light = pal[0], dark = pal[1], soil = pal[2], bokeh = pal[3];
    var W = 640, H = 480;
    var cx = W * (0.40 + r() * 0.22);
    var baseY = H * (0.80 + r() * 0.07);
    var stemH = H * (0.30 + r() * 0.16);
    var lean = (r() - 0.5) * 34;
    var s = [];

    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">');
    s.push('<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">' +
        '<stop offset="0" stop-color="' + dark + '" stop-opacity="0.92"/>' +
        '<stop offset="0.55" stop-color="' + soil + '"/>' +
        '<stop offset="1" stop-color="#0B0E09"/>' +
      '</linearGradient>' +
      '<linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.4">' +
        '<stop offset="0" stop-color="' + dark + '"/>' +
        '<stop offset="0.62" stop-color="' + light + '"/>' +
        '<stop offset="1" stop-color="' + light + '" stop-opacity="0.86"/>' +
      '</linearGradient>' +
      '<linearGradient id="st" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="' + dark + '"/>' +
        '<stop offset="0.5" stop-color="' + light + '"/>' +
        '<stop offset="1" stop-color="' + dark + '"/>' +
      '</linearGradient>' +
      '<radialGradient id="vig" cx="0.5" cy="0.45" r="0.75">' +
        '<stop offset="0.45" stop-color="#000" stop-opacity="0"/>' +
        '<stop offset="1" stop-color="#000" stop-opacity="0.55"/>' +
      '</radialGradient>' +
      '<filter id="blur"><feGaussianBlur stdDeviation="13"/></filter>' +
      '<filter id="soft"><feGaussianBlur stdDeviation="4"/></filter>' +
      '</defs>');

    s.push('<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>');

    /* Out-of-focus highlights (bokeh) */
    s.push('<g filter="url(#blur)">');
    for (var i = 0; i < 16; i++) {
      var bx = r() * W, by = r() * H * 0.78;
      var br = 12 + r() * 46;
      var op = (0.05 + r() * 0.17).toFixed(3);
      s.push('<circle cx="' + bx.toFixed(0) + '" cy="' + by.toFixed(0) + '" r="' + br.toFixed(0) + '" fill="' + bokeh + '" opacity="' + op + '"/>');
    }
    s.push('</g>');

    /* Soil bed */
    s.push('<g filter="url(#soft)">');
    s.push('<ellipse cx="' + (W / 2) + '" cy="' + (H * 0.94) + '" rx="' + (W * 0.75) + '" ry="' + (H * 0.19) + '" fill="#0C0A06" opacity="0.9"/>');
    for (var g = 0; g < 26; g++) {
      var gx = r() * W, gy = H * (0.79 + r() * 0.21), gr = 2 + r() * 7;
      s.push('<ellipse cx="' + gx.toFixed(0) + '" cy="' + gy.toFixed(0) + '" rx="' + gr.toFixed(1) + '" ry="' + (gr * 0.68).toFixed(1) + '" fill="#000" opacity="' + (0.2 + r() * 0.4).toFixed(2) + '"/>');
    }
    s.push('</g>');

    /* Stem */
    var topX = cx + lean, topY = baseY - stemH;
    s.push('<path d="M' + cx.toFixed(0) + ' ' + baseY.toFixed(0) +
      ' Q ' + (cx + lean * 0.25).toFixed(0) + ' ' + (baseY - stemH * 0.55).toFixed(0) +
      ' ' + topX.toFixed(0) + ' ' + topY.toFixed(0) + '" fill="none" stroke="url(#st)" stroke-width="' +
      (7 + r() * 4).toFixed(1) + '" stroke-linecap="round"/>');

    /* Cotyledons + true leaves */
    var pairs = 1 + Math.floor(r() * 2);
    for (var p = 0; p <= pairs; p++) {
      var t = p / (pairs + 0.35);
      var ly = topY + (baseY - topY) * t * 0.72;
      var lx = topX + (cx - topX) * t * 0.72;
      var sc = (0.98 - t * 0.24) * (0.82 + r() * 0.36);
      s.push(leaf(lx, ly, -18 - r() * 26 + t * 12, sc, light, dark, 0.45));
      s.push('<g transform="translate(' + lx.toFixed(1) + ',' + ly.toFixed(1) + ') scale(-1,1) translate(' + (-lx).toFixed(1) + ',' + (-ly).toFixed(1) + ')">' +
        leaf(lx, ly + 4 + r() * 8, -14 - r() * 24 + t * 12, sc * (0.9 + r() * 0.2), light, dark, 0.45) + '</g>');
    }

    /* Dew */
    for (var d = 0; d < 9; d++) {
      var dx = topX + (r() - 0.5) * 190, dy = topY + r() * 130;
      var dr = 2 + r() * 4.5;
      s.push('<circle cx="' + dx.toFixed(0) + '" cy="' + dy.toFixed(0) + '" r="' + dr.toFixed(1) + '" fill="#FFFFFF" opacity="' + (0.13 + r() * 0.3).toFixed(2) + '"/>');
      s.push('<circle cx="' + (dx - dr * 0.3).toFixed(0) + '" cy="' + (dy - dr * 0.32).toFixed(0) + '" r="' + (dr * 0.34).toFixed(1) + '" fill="#FFFFFF" opacity="0.6"/>');
    }

    s.push('<rect width="' + W + '" height="' + H + '" fill="url(#vig)"/>');
    s.push('</svg>');
    return s.join('');
  }

  var cache = {};

  function url(seed, cropName) {
    var key = seed + '|' + (cropName || '');
    if (!cache[key]) {
      cache[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(build(seed, cropName));
    }
    return cache[key];
  }

  global.Photos = { url: url };
})(window);
