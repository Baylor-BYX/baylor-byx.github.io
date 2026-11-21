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
  // coordinator board: nudge + going cold
  let t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  t.w.location.hash = "#board"; await wait(200);
  ok(/Needs a nudge/.test(txt(t.d)) && /Aiden Irvin → Jake Sample/.test(txt(t.d)), "nudge lists stalled assignment");
  const nb = [...t.d.querySelectorAll('a')].find(a => /Nudge Aiden/.test(a.textContent));
  ok(nb && /^sms:/.test(nb.getAttribute("href")) && /reach%20out%20to%20Jake/.test(nb.getAttribute("href")), "nudge opens text to brother");
  ok(/Going cold/.test(txt(t.d)) && /Last contact|Never contacted/.test(txt(t.d)), "going cold section shows");
  const gcSec = [...t.d.querySelectorAll("section")].find(x => /Going cold/.test(x.textContent));
  ok(gcSec && /Jake Sample/.test(gcSec.textContent) && !/Cole Fresh/.test(gcSec.textContent) && !/Ben Demo/.test(gcSec.textContent), "going cold: Jake (never contacted, 20d) yes; Ben (lunch 7d ago) and Cole (new) no");
  // search by note text
  t.w.location.hash = "#rushees"; await wait(150);
  const rsI = t.d.getElementById("rsearch"); rsI.value = "soccer"; rsI.dispatchEvent(new t.w.Event("input", { bubbles: true })); await wait(200);
  ok(/Ben Demo/.test(t.d.getElementById("rlist").textContent) && !/Jake Sample/.test(t.d.getElementById("rlist").textContent), "search finds rushee by note text");
  rsI.value = ""; rsI.dispatchEvent(new t.w.Event("input", { bubbles: true })); await wait(100);
  // fuzzy duplicate on add rushee
  await click(t.w, t.d.querySelector('[data-a="new-r"]'));
  let rf = t.d.querySelector('form[data-form="rushee"]');
  const nameInput = rf.querySelector('[name="name"]') || rf.querySelector('#r-name');
  if (!nameInput) { ok(false, "no name input in rushee form: " + [...rf.querySelectorAll("input")].map(i=>i.name).join(",")); }
  else {
    nameInput.value = "Jacob Sample";
    const first = rf.querySelector('[name="first"]'), last = rf.querySelector('[name="last"]'); if (first) first.value = "Jacob"; if (last) last.value = "Sample";
    rf.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(250);
    const n1 = Object.values(t.fake.store).filter(v => v && /Jacob Sample/.test(v.name || "")).length;
    ok(n1 === 0 && /already on the list/.test(t.d.getElementById("toast") ? t.d.getElementById("toast").textContent : t.d.body.textContent), "near-duplicate warned, not saved");
    rf = t.d.querySelector('form[data-form="rushee"]'); rf.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(250);
    ok(Object.values(t.fake.store).some(v => v && v.name === "Jacob Sample"), "second save adds anyway");
  }
  // plan a week prefers hometown match
  t.w.location.hash = "#plan"; await wait(250);
  const planTxt = txt(t.d);
  ok(/Both from Houston/.test(planTxt), "plan shows hometown match (Sam ↔ Cole)");
  // ask for email
  t.w.location.hash = "#team"; await wait(250);
  const ask = [...t.d.querySelectorAll("a")].find(a => /Ask for email/.test(a.textContent));
  ok(ask && /^sms:/.test(ask.getAttribute("href")), "ask-for-email button for brothers without email");
  // old notes link
  const fx = t.d.querySelector('[data-a="fix-notes"]');
  ok(fx && /Link 1 note/.test(fx.textContent), "old notes card counts 1");
  if (fx) { await click(t.w, fx); await wait(300); ok(t.fake.store["notes/n-old"].uid === "u-aiden", "old note linked to writer"); }
  // full backup
  const fb = t.d.querySelector('[data-a="export-json"]');
  ok(!!fb, "full backup button shows");
  if (fb) { await click(t.w, fb); await wait(400); const b = t.w.__lastBlob; const txtB = b ? await b.text() : ""; ok(/byx-rush-export/.test(txtB) && /Grew up in Austin/.test(txtB), "full backup file has everything"); }
  // report
  t.w.location.hash = "#report"; await wait(250);
  ok(/Recruitment report/.test(txt(t.d)) && /Top-rated rushees/.test(txt(t.d)) && /Ben Demo/.test(txt(t.d)), "report renders with top-rated");
  await click(t.w, t.d.querySelector('[data-a="print"]')); ok(t.w.__printed, "print button works");
  // season archive
  t.w.location.hash = "#team"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="season-end"]'));
  const sf = t.d.querySelector('form[data-form="season"]');
  sf.querySelector("#se-next").value = "Fall 2027 Rush"; sf.querySelector("#se-ok").value = "nope";
  sf.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(200);
  ok(t.fake.store["rushees/r-cole"].stage === "strong", "archive refused without END");
  const sf2 = t.d.querySelector('form[data-form="season"]'); sf2.querySelector("#se-next").value = "Fall 2027 Rush"; sf2.querySelector("#se-ok").value = "end";
  sf2.dispatchEvent(new t.w.Event("submit", { bubbles: true, cancelable: true })); await wait(900);
  ok(t.fake.store["rushees/r-cole"].stage === "dropped" && t.fake.store["rushees/r-cole"].archivedSeason, "archive drops active rushees with season tag");
  ok(t.fake.store["lunches/l1"].status === "cancelled", "archive cancels open assignments");
  ok(t.fake.store["config/main"].season === "Fall 2027 Rush" && t.fake.store["config/main"].seasonStart && t.fake.store["config/main"].pastSeasons.length === 1, "season config updated");
  // bring back restores stage
  t.w.location.hash = "#rushees"; await wait(200);
  await click(t.w, t.d.querySelector('[data-a="stage-filter"][data-v="dropped"]'));
  await click(t.w, t.d.querySelector('[data-a="open-r"][data-id="r-cole"]'));
  const ud = t.d.querySelector('[data-a="undrop"]'); if (ud) { await click(t.w, ud); await wait(250); }
  ok(t.fake.store["rushees/r-cole"].stage === "strong" && !t.fake.store["rushees/r-cole"].archivedSeason, "bring back restores pre-archive stage");

  // member: add to calendar on a dated lunch
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  const cal = t.d.querySelector('[data-a="cal"]');
  ok(!!cal, "add to calendar button on dated lunch");
  await click(t.w, cal);
  const g = [...t.d.querySelectorAll("a")].find(a => /calendar\.google\.com/.test(a.getAttribute("href")||""));
  const o = [...t.d.querySelectorAll("a")].find(a => /outlook\.office\.com/.test(a.getAttribute("href")||""));
  ok(g && /dates=20261125T123000\/20261125T133000/.test(g.getAttribute("href")) && /ctz=America%2FChicago|ctz=America\/Chicago/.test(g.getAttribute("href")), "google link has right times: " + (g && g.getAttribute("href").slice(0,140)));
  ok(o && /startdt=2026-11-25T12%3A30%3A00/.test(o.getAttribute("href")), "outlook link has right start");
  const ap = t.d.querySelector('[data-a="cal-apple"]'); ok(!!ap, "apple calendar option");
  if (ap) { await click(t.w, ap); const b = t.w.__lastBlob; const tx = b ? await b.text() : ""; ok(/BEGIN:VCALENDAR/.test(tx) && /DTSTART:20261125T123000/.test(tx), "apple option builds a calendar file"); }
  await click(t.w, t.d.querySelector('[data-a="close-modal"]'));
  ok(!/Needs a nudge|Going cold/.test(txt(t.d)), "member doesn't see coordinator sections");
  // viewer: report + going cold
  t = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true });
  ok(/Recruitment report/.test(txt(t.d)) && /Going cold/.test(txt(t.d)) && !/Needs a nudge/.test(txt(t.d)), "viewer sees report link and going cold, not nudges");
  t.w.location.hash = "#report"; await wait(200);
  ok(/Rush team activity/.test(txt(t.d)), "viewer can open report");
  ok(!t.fake.log.length, "viewer wrote nothing");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
