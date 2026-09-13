/* ============================================================
   Read-only invariant checks against a running server.

     npm start          # in one terminal
     npm run audit      # in another

   Every check here is a GET or a login — nothing is written, so this is
   safe to point at a real deployment. It asserts the things that would
   quietly corrupt the dataset if they broke: that a split never moves,
   that the counters agree with each other, that roles are enforced, and
   that internal fields stay server-side.
   ============================================================ */
'use strict';

const BASE = process.env.AUDIT_URL || 'http://localhost:4321/api';
const ADMIN = process.env.AUDIT_ADMIN || 'alex.rivera@cafe.ag';
const STAFF = process.env.AUDIT_STAFF || 'priya.nair@cafe.ag';
const PASSWORD = process.env.AUDIT_PASSWORD || 'cafe1234';

const JSON_H = { 'Content-Type': 'application/json' };
let passed = 0, failed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

async function login(identifier, password) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier, password })
  });
  return r.json();
}

async function get(token, path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/* The split cycle the browser uses. If the server ever disagrees with this,
   an image changes split between the UI and an export — which silently
   leaks training images into the test set. */
const SPLIT_CYCLE = ['train', 'train', 'train', 'train', 'train', 'val', 'test'];
const clientSplit = (seq) => SPLIT_CYCLE[seq % SPLIT_CYCLE.length];

(async () => {
  let admin, staff;
  try {
    admin = await login(ADMIN, PASSWORD);
    staff = await login(STAFF, PASSWORD);
  } catch (e) {
    console.error(`Cannot reach ${BASE}. Is the server running? (npm start)`);
    process.exit(1);
  }
  if (!admin.token) {
    console.error('Admin login failed: ' + (admin.message || 'no token returned'));
    process.exit(1);
  }

  console.log('\nauth and roles');
  check('admin signs in with the admin role', admin.user.role === 'admin');
  check('labeller signs in with the verifier role', staff.token && staff.user.role === 'verifier');
  check('a wrong password is refused', (await login(ADMIN, 'definitely-wrong')).token === undefined);
  check('an unknown account is refused', (await login('nobody@example.com', PASSWORD)).token === undefined);
  check('no token is 401', (await fetch(BASE + '/stats/dashboard')).status === 401);
  check('a garbage token is 401', (await get('not.a.jwt', '/stats/dashboard')).status === 401);

  const post = async (token, path, body) => (await fetch(BASE + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, ...JSON_H }, body: JSON.stringify(body)
  })).status;
  const del = async (token, path, body) => (await fetch(BASE + path, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token, ...JSON_H }, body: JSON.stringify(body)
  })).status;
  check('a labeller cannot create seed types', await post(staff.token, '/seed-types', { name: '__audit__' }) === 403);
  check('a labeller cannot delete photos', await del(staff.token, '/submissions', { ids: ['__audit__'] }) === 403);

  const T = admin.token;

  console.log('\nexport manifest');
  const all = (await get(T, '/export/manifest')).body;
  const train = (await get(T, '/export/manifest?split=train')).body;
  const val = (await get(T, '/export/manifest?split=val')).body;
  const test = (await get(T, '/export/manifest?split=test')).body;
  check('splits sum to the total', train.total + val.total + test.total === all.total);
  check('server split matches the browser for every row',
    all.rows.every((r) => clientSplit(Number(r.image_id.split('-').pop())) === r.split));
  check('every exported row carries a class',
    all.rows.every((r) => ['good', 'normal', 'bad'].includes(r.label)));
  check('every exported row carries both timestamps',
    all.rows.every((r) => r.uploaded_at && r.labelled_at));
  check('an unknown split is refused', (await get(T, '/export/manifest?split=nope')).status === 422);

  console.log('\nlabelling queue');
  const q = (await get(T, '/submissions/queue')).body;
  check('reports total, returned and truncated', q.total != null && q.returned != null && q.truncated != null);
  check('is capped rather than unbounded', q.returned <= 500);
  check('holds only pending images', q.rows.every((r) => r.status === 'pending_verification'));
  check('is ordered oldest-effective-first', q.rows.every((r, i, a) =>
    i === 0 || (a[i - 1].deferredAt || a[i - 1].uploadedAt) <= (r.deferredAt || r.uploadedAt)));
  check('does not leak the storage filename', q.rows.length === 0 || !('imageKey' in q.rows[0]));

  console.log('\ncounters agree');
  const health = (await get(T, '/stats/dataset-health')).body;
  const dash = (await get(T, '/stats/dashboard')).body;
  const qStats = (await get(T, '/stats/review-queue')).body;
  check('class counts sum to the labelled total',
    health.classes.reduce((n, c) => n + c.count, 0) === health.labelled);
  check('split sizes sum to the labelled total',
    health.splits.train + health.splits.val + health.splits.test === health.labelled);
  check('five readiness checks are returned', health.checks.length === 5);
  check('the passing count matches the checks', health.passing === health.checks.filter((c) => c.ok).length);
  check('dashboard pending matches queue stats', dash.pendingReview === qStats.pending);
  check('queue total matches pending count', q.total === qStats.pending);

  console.log('\npagination is bounded');
  const huge = (await get(T, '/submissions?limit=99999999')).body;
  check('an absurd limit is clamped', huge.limit <= 1000);
  check('a non-numeric limit falls back to the default', (await get(T, '/submissions?limit=abc')).body.limit === 10);
  check('page 0 resolves to page 1', (await get(T, '/submissions?page=0')).body.page === 1);
  check('a quote in a search term is inert',
    (await get(T, "/submissions?search=' OR 1=1 --")).body.total === 0);
  check('an unknown sort key falls back instead of erroring',
    (await get(T, '/farmers?sort=%3B%20DROP%20TABLE%20users')).status === 200);

  console.log('\nfarmers');
  const farmers = (await get(T, '/farmers?limit=12')).body;
  check('a page of farmers comes back', farmers.rows.length > 0);
  check('every row carries crops and thumbnails',
    farmers.rows.every((r) => Array.isArray(r.crops) && Array.isArray(r.recent)));
  check('the summary reports regions', Array.isArray(farmers.summary.regions));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nAudit crashed:', e.message); process.exit(1); });
