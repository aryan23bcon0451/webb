/* Runtime configuration. Overwritten at build time by amplify.yml when
   API_BASE is set; the committed version keeps the dashboard same-origin,
   which is what `npm start` serves locally. */
window.CAFE_CONFIG = { apiBase: '/api' };
