# BYX Rush Portal: briefing for Claude Code

Read this first. It explains what this project is, how it is built, and the rules for changing it.

## What it is

A recruitment ("rush") tracker for Beta Upsilon Chi (BYX), Iota chapter at Baylor. Brothers on the rush
team take potential new members (PNMs, "rushees") to lunch, text them, log notes, and invite them to events.
Coordinators (Jonah Woo and Clark Morrison) assign lunches and run the Board. Rob Gulley (chapter president)
is the owner and builder. Luke Harbour (BYX national staff, Leadership Coordinator) has view-only access.

Long-term goal: turn this into a multi-chapter app for every BYX chapter, owned by BYX national.
The plan is in "BYX Rush Portal: Going National" (Rob has it). See "National plan" below.

## Where it runs

- Live site: https://baylor-byx.github.io/app/ (GitHub Pages, repo `baylor-byx/baylor-byx.github.io`).
  **This repository is PUBLIC.** Never commit real rushee names, phone numbers, notes or addresses,
  including in tests, fixtures or screenshots. Sample data only.
- Backend: Firebase project `byx-rush-portal`, Spark (free) plan, owned by baylor@byx.org.
  Firestore + Firebase Auth (Google sign-in, plus email/password with email verification).
  Authorized domain: baylor-byx.github.io.
- `app/firebase-config.js` holds the public web config (safe to be public; security comes from the rules).
- Firestore rules live in `firestore.rules`. They are deployed by pasting into
  `npm run deploy:rules` (Firebase CLI via npx), or by pasting into Firebase console → Firestore → Rules → Publish.

## Files

- `index.html` (repo root): tiny forwarding page to `app/`.
- `app/index.html`: **the whole app**: one file, about 2,600 lines (HTML + CSS + JS, no build step).
- `app/import.html`: owner-only restore tool for a full JSON backup.
- `app/sw.js`, `app/manifest.json`, `app/icons/`: installable home-screen app (PWA).
- `firestore.rules`: security rules (must stay in sync with what the app writes).
- `tests/`: automated tests (see Testing).

## How app/index.html is put together

- Firebase compat SDK 10.14.1 loaded from gstatic. `db` = `firebase.firestore()`.
- Global state `S` holds Maps per collection, filled by `onSnapshot` listeners after sign-in:
  `rushees, team, lunches, notes, events, checkins, reachouts, submissions, knows, rounds, sends, cards, addresses`,
  plus `S.config` (doc `config/main`). Newer collections (`rounds, sends, cards, addresses`) subscribe with a
  *soft* error handler so the app still works if their rules aren't published yet. Keep that pattern for any new collection.
- `render()` rebuilds the screen from `S` and `ui` (UI state: route, modal, drawer, filters). Views are functions
  returning HTML strings: `vMe` (My rush), `vBoard`, `vCalendar`, `vEvents`, `vRushees`, `vTeam`, `vPlan`, `vRound`,
  `vCards`, `vImport`/`vWorkbook`, plus the rushee drawer and modals (`ui.modal.type`).
- Routing: `location.hash` → `ui.route` (`#me`, `#board`, `#round:<id>`, `#cards`, …). Brothers are redirected away
  from coordinator-only routes; viewers (Luke) are read-only.
- Events are delegated:
  - clicks → `data-a="<action>"` handled in one big `switch` (`case "rtext": …`),
  - form submits → `data-form="<kind>"` handled in the submit handler (`kind==="note"` …),
  - changes → `data-change="<name>"` handled in the change handler.
- Always escape user text with `esc()` when building HTML. Use existing helpers: `fname(r)` (nickname or first name),
  `fmtDate`, `whenPhrase`, `shortTime`, `weekOf`, `today()`, `normPhone`, `cleanPhone`, `smsHref`/`extText`,
  `logReach`, `setDoc`/`updDoc`/`delDoc`, `toast`, `msgArea` (editable text message box).
- Roles: `isCoord()` (coordinator or owner), `isBrother()`, `me.viewer` (Luke), `me.isOwner`, `myTeam()` (the signed-in
  person's team entry, matched by email). Owner can "Preview as…" another role.

## Data and permissions (summary of firestore.rules)

- `access/{email}`: role `member` | `coordinator` | `viewer`. Owner is hardcoded (`baylor@byx.org`).
- Helper functions in rules: `verified()`, `email()`, `isOwner()`, `isMember()`, `isWriter()` (member or coordinator),
  `isAdmin()` (coordinator or owner).
- Brothers can update their own `team` entry only for `uid` and About-you fields (including `homeZip`); can't change roles.
- `knows` ("I know him personally") and the "Closest on the team" list: coordinators/owner only (brothers see their own).
- `lunches`: brothers can create only self-planned lunches for themselves (`selfPlanned: true`).
- `cards`: brothers can only change signing/asking/address-flag fields; `eligible` (who gets a card) is coordinators only.
- `addresses`: rush team can read/write; viewers cannot.
- When a feature writes a new field or collection, update `firestore.rules` and the rules mirror inside the tests.

## Break mode (what it does now)

- Coordinators switch it on from the Board ("Seasons"). Turning it on stamps `config/main.breakSince`.
- **Guys near you** (My rush): rushees whose home is in the same metro area as the brother, so they can grab lunch
  over break. Areas come from the `AREAS` table in `app/index.html` (zip prefixes + city names). A rushee's area comes
  from his saved home address (`addresses/{id}`) and his `hometown`; a brother's from `homeZip` and `hometown` on his
  team entry (About you). **Show the city or area only, never the street address.**
- "Reached out" is a `reachouts` doc with `near: true`; a lunch dated since break started also counts. Both show to
  the whole team so a rushee isn't texted twice.
- The Board (coordinators only) lists rushees with no brother nearby and rushees with no hometown on file.
- **Holiday texts** (`rounds` with `kind: "text"`, checked off in `sends`) are still part of break mode.
- Weekly call rounds were removed (Nov 2026). Old `kind: "call"` rounds still show under Past on the Board.

## Testing

- `npm install` once, then `npm test` runs every file in `tests/` (jsdom + an in-memory fake Firebase in
  `tests/fakefb.js`). All tests must pass before any release.
- Each test file has its own seed data and a JavaScript mirror of `firestore.rules` (`rulesFor`). If you change the
  real rules, change the mirrors too, and add a test that proves a brother *can't* do the coordinator-only thing.
- The clock is frozen at Nov 17, 2026 in most tests so fixed sample dates don't go stale.
- Add a new `tests/test-<feature>.js` for each feature (copy the header from an existing test).

## Releasing (current manual process)

**Never commit or push to GitHub unless Rob explicitly says "push."** Rob uploads changes to the live
site manually for now. Make changes in the working tree only.

1. `npm test` passes.
2. Upload `app/index.html` (and any other changed files) to the repo's `app/` folder.
3. If rules changed: **never deploy rules unless Rob explicitly says "deploy rules"** (dry runs are fine). Then run `npm run deploy:rules` (Firebase CLI via npx; config in `firebase.json` / `.firebaserc`,
   signed in as baylor@byx.org) **before** people use the new feature. Check first with
   `npx firebase-tools deploy --only firestore:rules --dry-run`. Pasting into the console still works as a fallback.
4. Check the live site after ~1–2 minutes (GitHub Pages delay). The service worker is network-first, so a refresh picks it up.

## Writing and UI conventions

- Users are college guys on iPhones. Mobile first, big tap targets, plain words, short sentences.
- **Sizes (polish update, Nov 2026):** every text box, dropdown and textarea is 16px or larger, or iPhones zoom the
  page when it's tapped. Buttons are 44px tall (`.btn`), small ones 40px (`.btn.sm`). `tests/test-polish.js` checks this.
- **Motion:** `render()` rebuilds the whole screen, so CSS animations must be gated on `#app[data-enter~="modal|drawer|view"]`,
  which `render()` sets only when that thing just opened. An ungated animation replays on every refresh.
  Always keep the `prefers-reduced-motion` fallbacks.
- Cards use a soft shadow in light mode (`--shadow`) and a thin outline in dark mode (`--card-line`). Don't add new
  hard borders around cards.
- **New look (Nov 2026), what each screen is built from:**
  - Home (`vMe`): `upNextHTML` (next lunch card), then break section, then the To do list (`myTodos` / `todoRow`).
    A to-do row is a summary; tapping it opens the full `lunchCard` or note form underneath (`ui.todo[key]`), so every
    old control is still reachable. Then quick actions (`.quick`), schedule, guys, notes, numbers (`statStrip`), About you.
  - Rushees: stage filter chips carry counts. Profile (`drawerHTML`): `.phead`, the red avoid banner directly under the
    name, `.pactions` (Text, Call, Log lunch, Save contact), latest note, details, then every older section, and a pinned
    Add a note button. On phones the profile is a bottom sheet; on wide screens it is a right-hand panel.
  - Board (`vBoard`): review card (`#review`) with the approve buttons directly under it, numbers strip, pipeline rows
    (`.piperow`, tap goes to Rushees filtered by stage), then seasons, left over, low interest, nudges, going cold.
  - Use `emptyHTML(icon,title,text,btn)` for empty screens and `skeletonHTML()` while the first data loads.
  - Tests: `tests/test-newlook.js`. Tests that need controls inside a to-do call `openTodos(t)` first.
- No jargon in the UI ("Reached out", "Closest on the team", "Goes by", not technical terms).
- Brand: BYX purple/plum with gold accents; supports dark mode through CSS variables (`--ink`, `--panel`, `--purple`, …).
  Never hardcode white backgrounds.
- Text messages the app writes are editable before sending (`msgArea`), use the guy's nickname (`fname`), and open
  Messages via `sms:` links (the app can't send texts itself).
- Contacts save via a .vcf file (share sheet on iPhone). Web apps can't add contacts directly.

## National plan (where this is headed)

1. Restructure `app/index.html` into a real project (modules + Vite), with no behavior change, keeping all tests green.
2. Multi-chapter data: everything under `chapters/{chapterId}/…`, a `members/{email}` index, national/LC roles.
3. Rewrite rules per chapter, with rules tests proving chapters can't see each other.
4. Chapter settings (name, help contacts, text templates, time zone, which is hardcoded to America/Chicago today).
5. Photos to Firebase Storage. National dashboard with nightly summaries (Cloud Functions, Blaze plan).
6. Staging + production Firebase projects, GitHub Actions CI/CD, Firebase Hosting at rush.byx.org.
7. Optional: wrap the web app with Capacitor for App Store / Google Play apps (push notifications, native contacts).

Ask Rob before changing anything that affects live users, deleting data, or touching production settings.
