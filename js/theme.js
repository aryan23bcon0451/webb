/* ============================================================
   Theme — light, dark, or whatever the operating system says.

   The choice lives in one attribute on <html>. The stylesheet
   reads it; nothing else needs to know. The inline script in
   index.html applies the stored choice before first paint, so
   a dark-theme user never sees a white flash on load.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'cafe.theme';
  var MODES = ['system', 'light', 'dark'];
  var listeners = [];

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) > -1 ? v : 'system';
    } catch (e) { return 'system'; }
  }

  function systemPrefersDark() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /** 'system' | 'light' | 'dark' — what the user picked. */
  function get() { return stored(); }

  /** 'light' | 'dark' — what is actually on screen. */
  function resolved() {
    var m = stored();
    return m === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : m;
  }

  function apply() {
    var m = stored();
    if (m === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  }

  function set(mode) {
    if (MODES.indexOf(mode) === -1) mode = 'system';
    try { localStorage.setItem(KEY, mode); } catch (e) { /* non-fatal */ }
    apply();
    listeners.forEach(function (fn) { try { fn(mode, resolved()); } catch (e) { /* ignore */ } });
  }

  /** Flip to the opposite of what is on screen right now. */
  function toggle() { set(resolved() === 'dark' ? 'light' : 'dark'); }

  /** Returns the function that removes the listener again — a view
      that subscribes has to unsubscribe when it is torn down. */
  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  apply();

  /* Following the system means following it as it changes. */
  if (global.matchMedia) {
    var mq = global.matchMedia('(prefers-color-scheme: dark)');
    var react = function () {
      if (stored() !== 'system') return;
      listeners.forEach(function (fn) { try { fn('system', resolved()); } catch (e) { /* ignore */ } });
    };
    if (mq.addEventListener) mq.addEventListener('change', react);
    else if (mq.addListener) mq.addListener(react);
  }

  global.Theme = { get: get, set: set, toggle: toggle, resolved: resolved, onChange: onChange, MODES: MODES };
})(window);
