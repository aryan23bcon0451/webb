# CAFE — Seed Image Dataset

People photograph seeds in the field with the capture app. This dashboard is
where those images get a quality label — **Good**, **Normal** or **Bad** — so
they can be used to train a seed quality classifier.

The whole product is one loop: **collect → label → train.** Every screen here
serves the middle step, or tells you whether the set is ready for the last one.

## Running it

The dashboard is served by its own API. Both live in `server/`.

```bash
cd server && npm install
```

Build the database once — it is generated from `js/data.js`:

```bash
npm run seed
```

Then start it:

```bash
npm start
```

Visit http://localhost:4321. The API and the page come from the same origin,
so there is no CORS to configure and one process to run.

Sign in as `alex.rivera@cafe.ag` (admin) or `priya.nair@cafe.ag` (labeller).
The seed script sets every password to `cafe1234`.

`npm run seed -- --force` wipes and rebuilds. `JWT_SECRET` must be set in any
real deployment; locally the server generates one into `server/.jwt-secret`.

With the server running, `npm run audit` checks the invariants that would
quietly corrupt the dataset if they broke — that an image never changes split,
that the counters agree, that roles are enforced. It is read-only, so it is
safe to point at a real deployment.

## How the pieces fit

| Layer | Where |
| --- | --- |
| Page, styles, views | `index.html`, `assets/`, `js/views/` |
| API client — one `fetch` per method | `js/api.js` |
| HTTP routes | `server/routes/` |
| Schema, pagination, split assignment | `server/schema.sql`, `server/db.js` |
| JWT auth, roles | `server/auth.js` |
| Database, stored photos | `server/cafe.db`, `server/uploads/` |

Every screen calls `API.*` and nothing else. The in-browser mock that predated
the server is kept at `js/api.mock.js` for reference; it is not loaded.

## The five screens

| Screen | What you do there |
| --- | --- |
| **Home** | What is collected, what is waiting, and one sentence on what the dataset needs most right now. |
| **Label images** | One image at a time. Press **Good**, **Normal** or **Bad** — that single click saves the label and opens the next image. Or throw the image out, or leave it for later. |
| **Dataset** | Class balance, the train / validation / test split, five readiness checks, coverage per variety, and the export. A second tab searches every image ever collected. |
| **Farmers directory** | Everyone sending photos in: which crops each person uploads, how much of it is kept after review, and when they last sent something. Open a farmer to page through every photo they have sent and see why their photos get thrown out. Admins and labellers can add photos on a farmer's behalf (they join the labelling queue) — or pick several video clips, choose frames per second, and add the extracted frames; admins can select photos and delete them. |
| **Seed catalogue** | Seed types, varieties and companies. This is the list the capture app shows people, so hiding a seed type here removes it from their dropdown. |
| **Settings** | Your account, labelling preferences, the light / dark theme, and who else is labelling. |

Labelling by keyboard: `1` Good, `2` Normal, `3` Bad, `D` to throw out, `S` to
decide later, arrow keys to move. Nothing in the interface depends on knowing
these exist — they can be turned off in Settings.

## What makes this a dataset tool rather than a review queue

* **One click per image.** The label *is* the save. There is no separate
  "approve" step, because in a labelling job the label is the whole decision.
* **Class balance is on the front page.** A classifier trained on 80% "Good"
  learns to answer "Good". The Dataset screen names the smallest class and says
  how far off balance it is; Home repeats it as the next thing worth collecting.
* **Splits are fixed, not random.** `API.splitOf(seq)` assigns train / validation
  / test from the image's own id on a 5 / 1 / 1 cycle, so an image keeps its
  split across every export and a model is never tested on an image it was
  trained on.
* **Label agreement is measured.** Every upload carries the label the
  photographer gave it. Comparing that against the reviewer's label is a free
  signal — when it drops, the capture instructions are being read two ways.
* **The set comes out as a file.** Export writes one row per labelled image:

  ```
  image_id,file_name,label,split,seed_type,variety,company,width,height,
  uploaded_by,uploaded_at,labelled_by,labelled_at,uploader_label
  ```

  CSV for pandas, JSON for everything else. The scope is set on the screen:
  seed type, variety, company, split and class, in any combination. Whatever
  narrows the export names the file, so two exports taken the same day are
  still told apart — `seed-quality-ir-64-good-train-2026-09-09.csv`.

## Architecture

```
index.html            shell: navigation, top bar, view container
assets/styles.css     design tokens, then every component style
js/theme.js           light / dark / follow-the-system, held on <html>
js/icons.js           inline SVG icon set
js/photos.js          seed images, generated from the image's id
js/data.js            in-memory stand-in for the database
js/api.js             the shared API layer — the only thing views talk to
js/ui.js              formatters, stat cards, pagination, toasts, sparklines
js/views/*.js         one file per screen
js/app.js             router, sign-in guard, shell
serve.js              static file server for local preview
```

### Connecting a real backend

Views never touch the data directly — everything goes through `js/api.js`, and each
method is named after the route it stands in for. Swapping a mock body for a real
`fetch` is a one-line change per method:

```
POST /auth/login
GET  /stats/dashboard            GET  /stats/review-queue
GET  /stats/dataset-health       GET  /varieties/progress
GET  /export/manifest?split=&label=&seed_type_id=&variety_id=&company_id=
GET  /seed-types?active=true     POST /seed-types      PATCH /seed-types/:id
GET  /varieties                  POST /varieties
GET  /companies                  POST /companies
GET  /submissions?status=pending_verification&seed_type_id=&user_id=
GET  /submissions/:id            POST /submissions/:id/review
GET  /submissions?search=&label=&seed_type_id=&date_from=&date_to=
```

Sign-in returns a JWT held in `localStorage` and sent as a bearer token. Role gates
the writes: admins manage the seed catalogue, labellers record labels. The dashboard
never reaches past the API to the database or file storage.

Images are drawn as SVG from each image's id, so the app looks the same offline.
Point `Photos.url()` at the real image URL the API returns to swap in real photography.

The export is built in the browser from `API.getManifest()`. On a real backend,
either keep that shape and stream it from the server, or have the endpoint hand
back a signed URL to a pre-built manifest — the view only needs rows.

## The style layer

`assets/styles.css` is one file in two halves. The first is tokens — a neutral
ramp and a hue ramp, then the semantic names components actually use
(`--surface`, `--ink-3`, `--green-soft`, `--green-ink`), a ten-step type scale,
a 4px spacing grid, radius, elevation and motion. The second half is components,
and nothing in it writes a colour or a font size directly — every rule below the
token block reads a token.

That is what makes the dark theme cheap: it redefines the semantic names and
touches nothing else. The choice lives in one attribute on `<html>`, set by an
inline script in `index.html` before first paint so a dark-theme user never sees
a white flash. `js/theme.js` owns the three states — **light**, **dark**, and
**system**, which follows the operating system as it changes. The topbar button
flips between light and dark; the Settings screen offers all three.

Every text colour on every surface clears WCAG AA (4.5:1, or 3:1 for large text)
in both themes. Colours that sit on a permanently dark surface — the navigation
rail, the sign-in art, the greeting banner, a chip over a photograph — are their
own small set of tokens (`--on-dark`, `--on-brand`, `--on-media`) that do not
flip, because those surfaces do not flip either.

## Notes

* **The coverage table lists varieties, not crop categories.** Wheat / HD-2967 and
  Rice / IR-64 are separate rows because each variety has its own target, so the
  count reads "32 varieties". Crop categories live on the Seed catalogue screen.
* **The capture app's seed type list is not hardcoded.** It's fetched from
  `GET /seed-types?active=true`, so hiding a seed type here removes it from the
  photographer's dropdown.
* **Class counts sum to the labelled total.** Good / Normal / Bad cover the
  4,120,450 labelled images, not the 4.58M collected — an image waiting in the
  queue has no class yet.
* **Agreement is measured on the working sample**, not on the warehouse total;
  the dashboard only holds the recent submissions it can show.
#   w e b - w h i t e  
 