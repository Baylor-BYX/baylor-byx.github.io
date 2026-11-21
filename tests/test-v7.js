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
    "events/e0": { name: "Cookout", date: "2026-11-10", time: "18:00", place: "Fountain Mall" },
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
  let t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  const st = t.fake.firebase.firestore();
  await st.doc("checkins/e0__r-jake").set({ eventId: "e0", rusheeId: "r-jake", by: "t-jonah", at: 1 });
  await st.doc("reachouts/iv1").set({ rusheeId: "r-jake", by: "t-aiden", at: 1, kind: "invite", eventId: "e0" });
  await st.doc("reachouts/iv2").set({ rusheeId: "r-ben", by: "t-aiden", at: 1, kind: "invite", eventId: "e0" });
  t.fake.store["rushees/r-ben"].photoData = "data:image/jpeg;base64,AAAA";
  await wait(250);
  t.w.location.hash = "#events"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="open-ev"][data-id="e0"]'));
  const fuTab = t.d.querySelector('[data-a="evtab"][data-v="followup"]');
  ok(!!fuTab, "past event has Follow up tab");
  await click(t.w, fuTab);
  const T = txt(t.d);
  ok(/Came\s*1/.test(T) && /Jake Sample/.test(T) && /didn’t come\s*1/.test(T) && /Ben Demo/.test(T), "came and missed lists");
  ok(/Your invite/.test(T), "brother's own invites flagged");
  await click(t.w, t.d.querySelector('[data-a="ev-follow"][data-id="r-ben"]'));
  ok(/We missed you at Cookout/.test(txt(t.d)), "missed message");
  const a = [...t.d.querySelectorAll('a')].find(x => /^Text Ben/.test(x.textContent));
  ok(a && /^sms:/.test(a.getAttribute("href")), "follow-up opens Messages");
  if (a) { a.addEventListener("click", e => e.preventDefault()); await click(t.w, a); await wait(400); }
  ok(Object.values(t.fake.store).some(v => v && v.kind === "followup" && v.rusheeId === "r-ben" && v.eventId === "e0"), "follow-up logged");
  ok(/Followed up/.test(txt(t.d)), "marked followed up");
  await click(t.w, t.d.querySelector('[data-a="ev-follow"][data-id="r-jake"]'));
  ok(/Great to see you at Cookout/.test(txt(t.d)), "came message");
  await click(t.w, t.d.querySelector('[data-a="close-modal"]'));
  // future event: no follow-up tab
  await click(t.w, t.d.querySelector('[data-a="close-ev"]'));
  await click(t.w, t.d.querySelector('[data-a="open-ev"][data-id="e1"]'));
  ok(!t.d.querySelector('[data-a="evtab"][data-v="followup"]'), "future event has no Follow up tab");
  ok(!!t.d.querySelector('[data-a="ev-graphic"]'), "Make graphic button");
  await click(t.w, t.d.querySelector('[data-a="ev-graphic"]'));
  ok(/Event graphic/.test(txt(t.d)) && t.d.querySelector('[data-a="gfx-t"][data-v="light"]'), "graphic modal opens with templates");
  await click(t.w, t.d.querySelector('[data-a="close-modal"]'));
  // photo lightbox
  t.w.location.hash = "#rushees"; await wait(150);
  await click(t.w, t.d.querySelector('[data-a="open-r"][data-id="r-ben"]'));
  const pb = t.d.querySelector('[data-a="photo-view"]'); ok(!!pb, "profile photo is tappable");
  if (pb) { await click(t.w, pb); ok(!!t.d.querySelector(".lightbox img"), "lightbox shows photo"); await click(t.w, t.d.querySelector(".lightbox")); ok(!t.d.querySelector(".lightbox"), "tap closes lightbox"); }
  await click(t.w, t.d.querySelector('[data-a="open-r"][data-id="r-jake"]') || t.d.body);
  // viewer: follow-up visible but no buttons
  t = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true });
  t.w.location.hash = "#events"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="open-ev"][data-id="e0"]'));
  await click(t.w, t.d.querySelector('[data-a="evtab"][data-v="followup"]'));
  ok(!t.d.querySelector('[data-a="ev-follow"]'), "viewer sees no follow-up buttons");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
