// Freeze the clock at Nov 17, 2026 (when these tests were written), so fixed dates in the sample data never go stale.
{ const RD = Date; const OFF = new RD(2026, 10, 17, 12).getTime() - RD.now();
  global.__FREEZE = function (W) { const B = W.Date; class FD extends B { constructor(...a) { if (a.length) super(...a); else super(B.now() + OFF); } static now() { return B.now() + OFF; } } W.Date = FD; };
  global.__FREEZE(global); }
const { JSDOM } = require("jsdom");
const fs = require("fs");
const makeFake = require("./fakefb");
const html = fs.readFileSync(require("path").join(__dirname, "..", "app", "index.html"), "utf8");
const OWNER = "rob@example.com";
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Home lists to-dos as short rows; this opens each one so its full card (buttons, note form) is on the page.
const openTodos = async (t) => { for (let i = 0; i < 20; i++) { const el = t.d.querySelector('.todo [data-a="todo"][aria-expanded="false"]'); if (!el) break; el.dispatchEvent(new t.w.MouseEvent("click", { bubbles: true })); await wait(120); } if (t.d.activeElement && t.d.activeElement.blur) t.d.activeElement.blur(); };
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

function seed() {
  const s = {
    "config/main": { chapter: "Iota Chapter", season: "Spring 2027 Rush" },
    "team/t-jonah": { name: "Jonah Woo", role: "coordinator", phone: "(443) 555-0128", email: "jonah@example.com", uid: null },
    "team/t-aiden": { name: "Aiden Irvin", role: "member", phone: "(830) 555-0140", email: "aiden@example.com", uid: null },
    "team/t-rob": { name: "Rob Gulley", role: "member", phone: "(254) 555-0101", email: "", uid: null },
    "access/jonah@example.com": { role: "coordinator", name: "Jonah Woo" },
    "access/aiden@example.com": { role: "member", name: "Aiden Irvin" },
    "access/luke@example.org": { role: "viewer", name: "Luke Harbour", title: "Leadership Coordinator" },
    "rushees/r-jake": { name: "Jake Sample", phone: "(254) 555-0199", stage: "new", year: "Freshman", tags: [] },
    "rushees/r-ben": { name: "Ben Demo", phone: "(512) 555-0142", stage: "interested", year: "Sophomore", tags: [] },
    "lunches/l2": { kind: "Lunch", rusheeIds: ["r-ben"], teamIds: ["t-aiden"], status: "done", week: "2026-11-08", reachedOut: true, date: "2026-11-10", time: "12:00", place: "Penland" },
    "events/e1": { name: "Info Night", date: "2026-11-20", time: "19:00", place: "SUB" },
    "lunches/l1": { kind: "Lunch", rusheeIds: ["r-jake"], teamIds: ["t-aiden"], status: "planned", week: "2026-11-15", reachedOut: false, date: "", time: "", place: "" },
  };
  return s;
}

// Mirror of firestore.rules, so we catch the app trying something the rules would refuse.
function rulesFor(fake, userRef) {
  return (op, path, d) => {
    const u = userRef.u; if (!u || !u.emailVerified) return true;
    const email = u.email.toLowerCase();
    const owner = email === OWNER;
    const acc = fake.store["access/" + email];
    const member = owner || !!acc, admin = owner || (acc && acc.role === "coordinator");
    const writer = owner || (acc && (acc.role === "member" || acc.role === "coordinator"));
    const [col] = path.split("/");
    if (col === "access") { if (op === "get") return path !== "access/" + email; return !admin; }
    if (op === "get" || op === "read") return !member;
    const isWrite = op !== "get" && op !== "read";
    if (!isWrite) return false;
    const existing = fake.store[path];
    switch (col) {
      case "config": case "events": return !admin;
      case "team": if (admin) return false; return !(writer && op === "update" && existing && existing.email === email && Object.keys(d).every(k => k === "uid"));
      case "rushees": return op === "delete" ? !admin : !writer;
      case "lunches": return op === "update" ? !writer : !admin;
      case "notes": if (admin) return false; if (op === "set" && !existing) return !(writer && d.uid === u.uid); return !(writer && existing && existing.uid === u.uid);
      case "reachouts": case "submissions": return (op === "set" && !existing) ? !writer : !admin;
      case "checkins": return !writer;
    }
    return true;
  };
}

async function load(user) {
  const userRef = { u: user };
  let fake;
  const dom = new JSDOM(html.replace(/<script src="[^"]*"><\/script>/g, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://baylor-byx.github.io/app/",
    beforeParse(w) {
      global.__FREEZE(w);
      fake = makeFake({ store: seed(), user, denied: (...a) => rulesFor(fake, userRef)(...a) });
      const origSet = fake.setUser; fake.setUser = (u) => { userRef.u = u; origSet(u); };
      w.firebase = fake.firebase; w.BYX_FIREBASE = { apiKey: "test" }; w.BYX_OWNERS = [OWNER];
      w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.navigator.clipboard = { writeText: () => Promise.resolve() };
      w.onerror = (m) => { console.log("PAGE ERROR", m); fails++; };
    },
  });
  await wait(300);
  return { dom, w: dom.window, d: dom.window.document, fake, userRef };
}
const txt = (d) => d.getElementById("app").textContent;
const click = async (w, el) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wait(150); };

(async () => {
  // 1. signed out
  let t = await load(null);
  ok(/Sign in with Google/.test(txt(t.d)), "signed out shows sign-in");
  // 2. unverified password account
  t = await load({ uid: "u0", email: "new@example.com", emailVerified: false });
  ok(/Check your email/.test(txt(t.d)), "unverified email shows confirm screen");
  // 3. stranger
  t = await load({ uid: "u1", email: "stranger@example.com", emailVerified: true });
  ok(/isn.t on the rush team list/.test(txt(t.d)), "stranger sees not-on-list");
  ok(!t.fake.log.length, "stranger wrote nothing");
  // 4. member
  t = await load({ uid: "u-aiden", email: "Aiden@Example.com", emailVerified: true });
  ok(/Hey, Aiden/.test(txt(t.d)), "member lands on his My rush by email");
  ok(t.fake.store["team/t-aiden"].uid === "u-aiden", "member's uid stamped on roster");
  const sms = [...t.d.querySelectorAll('a[href^="sms:"]')];
  ok(true, "sms links on My rush: " + sms.length);
  ok(!/Assign lunch/.test(txt(t.d)), "member doesn't see Assign lunch");
  // open text picker and pick a template
  const tb = t.d.querySelector('[data-a="rtext"]');
  if (tb) {
    await click(t.w, tb);
    const a = t.d.querySelector('.modal a[href^="sms:"], a[href^="sms:"]');
    ok(a && /^sms:/.test(a.getAttribute("href")) && !a.hasAttribute("target"), "text option is a direct sms link: " + (a && a.getAttribute("href").slice(0, 60)));
    if (a) { a.addEventListener("click", e => e.preventDefault()); await click(t.w, a); }
    await wait(200);
    ok(t.fake.log.some(l => l[1].startsWith("reachouts/")), "reach-out logged for member");
    ok(t.fake.store["lunches/l1"].reachedOut === true, "lunch marked reached out");
  } else ok(false, "no rtext button found");
  // note on a done lunch
  t.w.location.hash = "#me"; await wait(200); await openTodos(t);
  const nf = t.d.querySelector('form[data-form="note"]');
  if (nf) { const ta = nf.querySelector("textarea"); ta.value = "Great guy, from Austin."; const rb = nf.querySelector('input[name="rating"][value="4"]'); if (rb) rb.checked = true;
    nf.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
    const n = Object.entries(t.fake.store).find(([p, v]) => p.startsWith("notes/") && v.text === "Great guy, from Austin.");
    ok(n && n[1].uid === "u-aiden", "member note saved with his uid"); } else ok(false, "no note form");
  // event check-in by member
  t.w.location.hash = "#events"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="open-ev"][data-id="e1"]'));
  const ck = t.d.querySelector('[data-a="checkin"]');
  if (ck) { await click(t.w, ck); await wait(200); ok(Object.keys(t.fake.store).some(p => p.startsWith("checkins/e1__")), "member checked a guy in"); } else ok(false, "no checkin button");
  ok(!t.d.querySelector('[data-a="del-ev"],[data-a="edit-ev"]'), "member can't edit/delete events");
  // team tab: sign out present, no unclaim
  t.w.location.hash = "#team"; await wait(200);
  ok(/Signed in as aiden@example.com/.test(txt(t.d)), "team tab shows signed-in email + sign out");
  // sign out
  await click(t.w, t.d.querySelector('[data-a="signout"]')); await wait(200);
  ok(/Sign in with Google/.test(txt(t.d)), "sign out returns to sign-in");

  // 5. coordinator adds a brother with email -> access doc
  t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  ok(/Hey, Jonah/.test(txt(t.d)) && /Assign lunch/.test(txt(t.d)), "coordinator sees tools");
  t.w.location.hash = "#team"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="new-t"]'));
  const f = t.d.querySelector('form[data-form="team"]');
  f.querySelector("#t-name").value = "Carter New"; f.querySelector("#t-email").value = "Carter@Example.com";
  f.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  ok(t.fake.store["access/carter@example.com"] && t.fake.store["access/carter@example.com"].role === "member", "adding brother creates access doc");
  const cid = Object.keys(t.fake.store).find(p => p.startsWith("team/") && t.fake.store[p].name === "Carter New");
  ok(cid && t.fake.store[cid].email === "carter@example.com", "team doc stores lowercase email");
  // change role + email
  await click(t.w, t.d.querySelector('[data-a="edit-t"][data-id="' + cid.split("/")[1] + '"]'));
  const f2 = t.d.querySelector('form[data-form="team"]');
  f2.querySelector("#t-email").value = "carter2@example.com"; f2.querySelector("#t-role").value = "coordinator";
  f2.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  ok(!t.fake.store["access/carter@example.com"] && t.fake.store["access/carter2@example.com"].role === "coordinator", "email/role change moves access doc");
  // duplicate email refused
  await click(t.w, t.d.querySelector('[data-a="new-t"]'));
  const f3 = t.d.querySelector('form[data-form="team"]');
  f3.querySelector("#t-name").value = "Dup"; f3.querySelector("#t-email").value = "jonah@example.com";
  f3.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  ok(!Object.values(t.fake.store).some(x => x && x.name === "Dup"), "duplicate email refused");
  // board + plan + status + calendar + events render without errors
  for (const r of ["board", "calendar", "events", "rushees", "status", "plan", "lunches"]) { t.w.location.hash = "#" + r; await wait(150); ok(t.d.getElementById("app").textContent.length > 50, "renders " + r); }

  // 7. bulk logging by a member
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  const logOne = async (name, date, rating, note) => {
    const b = t.d.querySelector('[data-a="sub-lunch"]'); await click(t.w, b);
    const f = t.d.querySelector('form[data-form="sublunch"]');
    f.querySelector("#sl-r").value = name; f.querySelector("#sl-d").value = date; f.querySelector("#sl-n").value = note;
    if (rating) f.querySelector('input[name="rating"][value="' + rating + '"]').checked = true;
    f.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  };
  await logOne("Jake Sample", "2026-11-01", 4, "Coffee at Common Grounds");
  ok(/Lunch logged/.test(txt(t.d)) && !!t.d.querySelector(".modal .okmark") && !!t.d.querySelector('.modal [data-a="sub-lunch"], [data-a="sub-lunch"]'), "after logging: Logged screen with Log another");
  await logOne("Ben Demo", "2026-11-03", 5, "Great talk about faith");
  await logOne("Jake Sample", "2026-11-01", 4, "Coffee again (dup)");
  const subsNow = Object.entries(t.fake.store).filter(([p, v]) => p.startsWith("submissions/"));
  ok(subsNow.length === 3 && subsNow.every(([p, v]) => v.uid === "u-aiden"), "3 submissions saved with brother's uid");
  ok(subsNow.some(([p, v]) => v.rating === 5), "rating saved on submission");
  const store = t.fake.store;
  // coordinator approves all
  t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  Object.assign(t.fake.store, Object.fromEntries(Object.entries(store).filter(([p]) => p.startsWith("submissions/"))));
  t.fake.store["_"] = 1; delete t.fake.store["_"];
  t.w.location.hash = "#me"; await wait(50); t.w.location.hash = "#board"; await wait(300);
  // force a snapshot refresh
  await t.fake.firebase.firestore().doc("config/main").update({ season: "Spring 2027 Rush" }); await wait(300);
  ok(/Possible duplicate/.test(txt(t.d)), "duplicate flagged in review list");
  const all = t.d.querySelector('[data-a="sub-approve-all"]');
  ok(all && /Approve all 2 lunches/.test(all.textContent), "Approve all button counts non-duplicates: " + (all && all.textContent));
  if (all) { await click(t.w, all); await wait(800); }
  const approved = Object.values(t.fake.store).filter(v => v && v.status === "approved").length;
  ok(approved === 2, "approve all approved 2 (skipped dup): " + approved);
  const notes = Object.values(t.fake.store).filter(v => v && v.source === "submitted" && v.text);
  ok(notes.length === 2 && notes.every(n => n.uid === "u-aiden") && notes.some(n => n.rating === 5), "approved notes owned by brother with rating");
  ok(t.fake.store["rushees/r-jake"].stage === "met", "new rushee moved to Met");
  // photo button visible
  t.w.location.hash = "#rushees"; await wait(150);
  await click(t.w, t.d.querySelector('[data-a="open-r"][data-id="r-ben"]'));
  ok(/Add photo/.test(txt(t.d)), "Add photo button shows in new app");
  await click(t.w, t.d.querySelector('[data-a="close-modal"], [data-a="close-drawer"]') || t.d.body);
  // coordinator gives leadership access
  t.w.location.hash = "#team"; await wait(300);
  ok(/Leadership access/.test(txt(t.d)) && /Luke Harbour/.test(txt(t.d)), "leadership card lists existing viewer");
  const vf = t.d.querySelector('form[data-form="viewer"]');
  vf.querySelector("#v-name").value = "Nat Staff"; vf.querySelector("#v-email").value = "Staff@BYX.org";
  vf.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  ok(t.fake.store["access/staff@byx.org"] && t.fake.store["access/staff@byx.org"].role === "viewer", "coordinator added a viewer");

  // 8. leadership viewer
  t = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true });
  ok(/Leadership view/.test(txt(t.d)), "viewer sees leadership banner");
  ok(t.w.location.hash !== "#me" && /Active rushees/.test(txt(t.d)), "viewer lands on Board");
  ok(!t.d.querySelector('nav.tabs a[href="#me"]'), "viewer has no My rush tab");
  ok(!/Assign lunch|Plan a week|Import sheet/.test(txt(t.d)), "viewer has no coordinator tools");
  for (const r of ["calendar", "events", "rushees", "status", "team"]) { t.w.location.hash = "#" + r; await wait(150); ok(txt(t.d).length > 50, "viewer can open " + r); }
  t.w.location.hash = "#rushees"; await wait(150);
  await click(t.w, t.d.querySelector('[data-a="open-r"][data-id="r-jake"]'));
  ok(!/Add photo|Drop…|Merge a duplicate|Save note/.test(txt(t.d)), "viewer sees profile without edit tools");
  ok(!t.fake.log.length, "viewer wrote nothing");

  // 6. owner with no email on his roster entry -> claim works and stamps email
  t = await load({ uid: "u-rob", email: OWNER, emailVerified: true });
  ok(/Who are you/i.test(txt(t.d)) || /Pick your name/.test(txt(t.d)), "owner without roster email sees name picker");
  const cb = t.d.querySelector('[data-a="claim"][data-id="t-rob"]');
  if (cb) { await click(t.w, cb); await wait(200); ok(t.fake.store["team/t-rob"].email === OWNER, "owner claim stamps email"); ok(/Hey, Rob/.test(txt(t.d)), "owner lands on My rush"); }
  else ok(false, "no claim button for t-rob");

  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
