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
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

function seed() {
  const s = {
    "config/main": { chapter: "Iota Chapter", season: "Spring 2027 Rush" },
    "team/t-jonah": { name: "Jonah Woo", role: "coordinator", phone: "(443) 555-0128", email: "jonah@example.com", uid: null },
    "team/t-aiden": { name: "Aiden Irvin", role: "member", phone: "(830) 555-0140", email: "aiden@example.com", uid: "u-aiden" },
    "team/t-sam": { name: "Sam Houston", role: "member", phone: "(713) 555-0111", email: "sam@example.com", uid: null, hometown: "Houston" },
    "team/t-rob": { name: "Rob Gulley", role: "member", phone: "(254) 555-0101", email: "", uid: null },
    "access/jonah@example.com": { role: "coordinator", name: "Jonah Woo" },
    "access/aiden@example.com": { role: "member", name: "Aiden Irvin" },
    "access/luke@example.org": { role: "viewer", name: "Luke Harbour", title: "Leadership Coordinator" },
    "rushees/r-jake": { name: "Jake Sample", phone: "(254) 555-0199", stage: "new", year: "Freshman", tags: [], hometown: "San Antonio", createdAt: Date.now() - 20*86400000 },
    "rushees/r-ben": { name: "Ben Demo", phone: "(512) 555-0142", stage: "interested", year: "Sophomore", tags: [], createdAt: Date.now() - 20*86400000 },
    "rushees/r-cole": { name: "Cole Fresh", phone: "(512) 555-0100", stage: "strong", year: "Freshman", tags: [], hometown: "Houston", createdAt: Date.now() - 1*86400000 },
    "notes/n-old": { rusheeId: "r-ben", teamId: "t-aiden", uid: "claude-old-uid", text: "Grew up in Austin, loves soccer", rating: 5, createdAt: Date.now() - 15*86400000 },
    "lunches/l2": { kind: "Lunch", rusheeIds: ["r-ben"], teamIds: ["t-aiden"], status: "done", week: "2026-11-08", reachedOut: true, date: "2026-11-10", time: "12:00", place: "Penland" },
    "events/e1": { name: "Info Night", date: "2026-11-20", time: "19:00", place: "SUB" },
    "lunches/l1": { kind: "Lunch", rusheeIds: ["r-jake"], teamIds: ["t-aiden"], status: "planned", week: "2026-11-15", reachedOut: false, date: "", time: "", place: "", createdAt: Date.now() - 4*86400000 },
    "lunches/l3": { kind: "Lunch", rusheeIds: ["r-ben"], teamIds: ["t-aiden"], status: "planned", date: "2026-11-25", time: "12:30", place: "Common Grounds", reachedOut: true, createdAt: Date.now() - 1*86400000 },
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
      w.URL.createObjectURL = (b) => { w.__lastBlob = b; return "blob:x"; }; w.URL.revokeObjectURL = () => {};
      w.print = () => { w.__printed = true; };
      w.onerror = (m) => { console.log("PAGE ERROR", m); fails++; };
    },
  });
  await wait(300);
  return { dom, w: dom.window, d: dom.window.document, fake, userRef };
}
const txt = (d) => d.getElementById("app").textContent;
const click = async (w, el) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wait(150); };



(async () => {
  const OWN = { uid: "u-rob", email: OWNER, emailVerified: true };
  let t = await load(OWN);
  t.w.location.hash = "#team"; await wait(250);
  ok(/Preview the app as/.test(txt(t.d)), "owner sees Preview card");
  const startLog = t.fake.log.length;
  // member preview
  t.d.getElementById("pv-bro").value = "t-aiden";
  await click(t.w, t.d.querySelector('[data-a="preview-start"][data-kind="member"]')); await wait(250);
  ok(/Previewing as Aiden Irvin \(rush team\)/.test(txt(t.d)) && /Hey, Aiden/.test(txt(t.d)), "member preview shows Aiden's My rush");
  ok(!/Assign lunch|Plan a week/.test(txt(t.d)), "member preview hides coordinator tools");
  const tb = t.d.querySelector('[data-a="rtext"]');
  if (tb) { await click(t.w, tb); const a = t.d.querySelector('a[href^="sms:"]'); if (a) await click(t.w, a); await wait(200); }
  const cal = [...t.d.querySelectorAll("a")].find(a => /Add to calendar/.test(a.textContent)); if (cal) await click(t.w, cal);
  await click(t.w, t.d.querySelector('[data-a="close-modal"]') || t.d.body);
  t.w.location.hash = "#me"; await wait(150);
  const sl = t.d.querySelector('[data-a="sub-lunch"]'); if (sl) { await click(t.w, sl); const f = t.d.querySelector('form[data-form="sublunch"]'); f.querySelector("#sl-r").value = "Ben Demo"; f.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(250); }
  ok(t.fake.log.length === startLog, "nothing saved during member preview (" + (t.fake.log.length - startLog) + " writes)");
  // exit
  await click(t.w, t.d.querySelector('[data-a="preview-exit"]')); await wait(200);
  ok(!/Previewing as/.test(txt(t.d)) && /Preview the app as/.test(txt(t.d)), "exit returns to owner Team tab");
  // coordinator preview
  t.d.getElementById("pv-co").value = "t-jonah";
  await click(t.w, t.d.querySelector('[data-a="preview-start"][data-kind="coord"]')); await wait(250);
  t.w.location.hash = "#board"; await wait(200);
  ok(/Previewing as Jonah Woo \(rush coordinator\)/.test(txt(t.d)) && /Plan a week/.test(txt(t.d)), "coordinator preview shows coordinator tools");
  t.w.location.hash = "#team"; await wait(200);
  ok(!/Preview the app as/.test(txt(t.d)), "preview card hidden while previewing");
  await click(t.w, t.d.querySelector('[data-a="preview-exit"]')); await wait(200);
  // leadership preview
  await click(t.w, t.d.querySelector('[data-a="preview-start"][data-kind="viewer"]')); await wait(250);
  ok(/Previewing as Leadership/.test(txt(t.d)) && !t.d.querySelector('nav.tabs a[href="#me"]') && /Recruitment report/.test(txt(t.d)), "leadership preview matches viewer");
  ok(!/Assign lunch|Plan a week/.test(txt(t.d)), "leadership preview has no tools");
  await click(t.w, t.d.querySelector('[data-a="preview-exit"]')); await wait(200);
  t.w.location.hash = "#board"; await wait(200);
  ok(/Plan a week/.test(txt(t.d)) && !/Previewing/.test(txt(t.d)), "owner tools back after exit");
  ok(t.fake.log.length === startLog, "no writes across all previews");
  // non-owner coordinator never sees the card
  t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  t.w.location.hash = "#team"; await wait(200);
  ok(!/Preview the app as/.test(txt(t.d)), "coordinators don't get preview");
  // submissions: only pending show on My rush
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  const st = t.fake.firebase.firestore();
  await st.doc("submissions/s-a").set({ type: "lunch", status: "approved", by: "t-aiden", rusheeId: "r-ben", date: "2026-11-01", createdAt: 1 });
  await st.doc("submissions/s-b").set({ type: "pnm", status: "rejected", by: "t-aiden", name: "Old Guy", createdAt: 2 });
  await wait(250);
  ok(!/Waiting for review|Approved|Not added|Old Guy/.test(txt(t.d)), "reviewed submissions hidden");
  await st.doc("submissions/s-c").set({ type: "lunch", status: "pending", by: "t-aiden", rusheeId: "r-jake", date: "2026-11-02", createdAt: 3 }); await wait(250);
  ok(/Waiting for review/.test(txt(t.d)) && /Lunch with Jake Sample/.test(txt(t.d)), "pending submission shows");
  for (let k = 0; k < 4; k++) await st.doc("submissions/s-p" + k).set({ type: "lunch", status: "pending", by: "t-aiden", rusheeId: "r-ben", date: "2026-10-0" + (k + 1), createdAt: 10 + k });
  await wait(250);
  ok(/You have 5 submissions waiting/.test(txt(t.d)) && !/Lunch with Jake Sample/.test(txt(t.d)), "many pending collapse to one line");
  // brothers have no Board tab
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(!t.d.querySelector('nav.tabs a[href="#board"]') && t.d.querySelectorAll('nav.tabs a').length === 5, "brother has 5 tabs, no Board");
  t.w.location.hash = "#board"; await wait(200);
  ok(/Hey, Aiden/.test(txt(t.d)), "brother sent to My rush if he opens #board");
  t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  ok(!!t.d.querySelector('nav.tabs a[href="#board"]'), "coordinator keeps Board");
  t = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true });
  ok(!!t.d.querySelector('nav.tabs a[href="#board"]'), "leadership keeps Board");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
