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
    "knows/r-jake__t-sam": { rusheeId: "r-jake", teamId: "t-sam", uid: null, at: 1 },
    "lunches/l1": { kind: "Lunch", rusheeIds: ["r-jake"], teamIds: ["t-aiden"], status: "planned", week: "2026-11-15", reachedOut: false, date: "", time: "", place: "", createdAt: Date.now() - 4*86400000 },
    "lunches/l3": { kind: "Lunch", rusheeIds: ["r-ben"], teamIds: ["t-aiden"], status: "planned", date: "2026-11-25", time: "12:30", place: "Common Grounds", reachedOut: true, createdAt: Date.now() - 1*86400000 },
  };
  const iso=(d)=>{const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10);};
  s["events/e2"]={ name: "Info Night", date: iso(new Date(Date.now()+86400000)), time: "19:00", place: "the SUB" };
  s["events/e3"]={ name: "Game Night", date: iso(new Date(Date.now()+10*86400000)), time: "12:30", place: "" };
  if (global.EXTRA) Object.assign(s, global.EXTRA);
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
    if (col === "knows") {
      if (op === "read") return !admin;
      if (op === "readq") return !(admin || (writer && d && d.field === "uid" && d.value === u.uid));
      const ex = fake.store[path];
      if (op === "set" && !ex) return !(admin || (writer && d.uid === u.uid));
      if (op === "delete") return !(admin || (writer && ex && ex.uid === u.uid));
      return !admin;
    }
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
  const w = t.w;
  w.location.hash = "#events"; await wait(150);
  const openEv = async (name) => { const c=[...t.d.querySelectorAll('[data-a="open-ev"]')].find(x=>x.textContent.indexOf(name)>=0) || [...t.d.querySelectorAll('.evcard')].find(x=>x.textContent.indexOf(name)>=0); await click(w, c.querySelector('[data-a]')||c); };
  { const c = t.d.querySelector('[data-a="open-ev"][data-id="e2"]'); if (c) await click(w, c); else await openEv("Info Night"); }
  let inv = [...t.d.querySelectorAll('button')].find(x=>/^Invites/.test(x.textContent.trim()));
  if (inv) await click(w, inv);
  let ib = t.d.querySelector('[data-a="ev-invite"]');
  if (ib) { await click(w, ib); const im = t.d.querySelector('.modal textarea.msgedit').value; console.log("   " + im);
    ok(/Info Night tomorrow night at 7pm at the SUB\./.test(im) && !/ on tomorrow/i.test(im) && /bring any guys you know/.test(im), "invite text reads naturally");
    await click(w, t.d.querySelector('[data-a="close-modal"]')); } else ok(false, "no invite button: " + txt(t.d).slice(0,300));
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  // custom message
  await click(w, t.d.querySelector('[data-a="rtext"]'));
  ok(/Custom message/.test(txt(t.d)), "custom message option");
  const tas = t.d.querySelectorAll(".modal textarea.msgedit"); ok(tas.length === 3, "3 editable messages");
  const ta = tas[2]; ta.value = "Yo Jake, want to grab Chick-fil-A?"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
  const card = ta.closest(".card"); const a = card.querySelector('a[href^="sms"]'); const cp = card.querySelector("[data-v]");
  ok(a && decodeURIComponent(a.href).indexOf("Chick-fil-A") >= 0, "custom text goes into sms link");
  ok(cp && /Chick-fil-A/.test(cp.dataset.v) && /555-0199/.test(cp.dataset.v), "copy button updated");
  await click(w, a); await wait(400);
  ok(t.fake.store["lunches/l1"].reachedOut === true, "custom text marks reached out");
  // log lunch with time + low interest
  t.w.location.hash = "#me"; await wait(150);
  await click(w, t.d.querySelector('[data-a="sub-lunch"]'));
  const f = t.d.querySelector('[data-form="sublunch"]');
  ok(!!f.querySelector('input[name="time"]'), "log a lunch has time");
  ok(/How interested is he/.test(f.textContent) && !/fit/.test(f.textContent), "interest wording");
  f.querySelector('[name="rushee"]').value = "Ben Demo"; f.querySelector('[name="time"]').value = "12:15";
  f.querySelector('[name="rating"][value="2"]').checked = true; f.querySelector('[name="note"]').value = "Not really interested in Greek life";
  f.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
  const sub = Object.entries(t.fake.store).find(([k, v]) => k.startsWith("submissions/") && v.rusheeId === "r-ben");
  ok(sub && sub[1].time === "12:15", "time saved on submission");
  ok(/Low interest/.test(txt(t.d)) && /Text Jonah/.test(txt(t.d)), "low interest prompt after logging");
  const lt = t.d.querySelector(".modal textarea.msgedit"); console.log("   " + lt.value);
  ok(/rated his interest a 2 out of 5/.test(lt.value) && /Ben Demo/.test(lt.value), "low interest message");
  ok(/4435550128/.test(decodeURIComponent(t.d.querySelector('.modal a[href^="sms"]').href).replace(/\D/g, "")), "texts Jonah");
  ok(!!t.d.querySelector('.modal [data-a="sub-lunch"]'), "log another still there");
  await click(w, t.d.querySelector('[data-a="close-modal"]'));
  // note form low rating
  const nf = t.d.querySelector('[data-form="note"]');
  if (nf) {
    ok(/How interested is he/.test(nf.textContent), "note form interest wording");
    nf.querySelector('[name="rating"][value="1"]').checked = true; nf.querySelector("textarea").value = "Said he's joining another org";
    nf.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await wait(300);
    ok(/Low interest \(1 of 5\)/.test(txt(t.d)), "note low rating prompts");
  } else ok(false, "no note form found");
  // coordinator board
  global.EXTRA = { "notes/n-low": { rusheeId: "r-cole", teamId: "t-aiden", uid: "u-aiden", text: "Not interested", rating: 2, createdAt: Date.now() - 86400000 },
    "submissions/s1": { type: "lunch", status: "pending", by: "t-aiden", uid: "u-aiden", rusheeId: "r-jake", date: "2026-11-12", time: "11:45", place: "SUB", note: "meh", rating: 2, createdAt: Date.now() } };
  t = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  t.w.location.hash = "#board"; await wait(200);
  ok(/Low interest/.test(txt(t.d)) && /Cole Fresh/.test(txt(t.d)), "board low interest section");
  ok(/11:45 AM/.test(txt(t.d)), "review shows logged time");
  await click(t.w, t.d.querySelector('[data-a="low-seen"]')); await wait(200);
  ok(t.fake.store["notes/n-low"].lowSeen === true, "Got it clears");
  await click(t.w, t.d.querySelector('[data-a="sub-approve"][data-id="s1"]')); await wait(300);
  const nl = Object.values(t.fake.store).find(v => v.source === "submitted" && v.kind === "Lunch" && v.rusheeIds && v.rusheeIds[0] === "r-jake");
  ok(nl && nl.time === "11:45", "approved lunch keeps time");
  t = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true });
  t.w.location.hash = "#board"; await wait(200);
  ok(!t.d.querySelector('[data-a="low-seen"]'), "leadership has no Got it");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
