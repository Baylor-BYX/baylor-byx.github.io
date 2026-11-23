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
    ...(global.EXTRA || {}),
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
    if (col === "addresses" && (op === "get" || op === "read")) return !writer;
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
      case "rounds": return !admin;
      case "sends": if (admin) return false; if (op === "set" && !existing) return !(writer && d.uid === u.uid); if (op === "delete") return !(writer && existing && existing.uid === u.uid); return true;
      case "cards": { if (admin) return false; if (!writer) return true; const ok = ["rusheeId","signers","signedBy","asked","askedBy","hasAddress","addressed"]; if (op === "set" && !existing) return !Object.keys(d).every(k => ok.includes(k)); if (op === "update") return !Object.keys(d).every(k => ok.includes(k)); return true; }
      case "addresses": return !writer;
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
      if (global.FAKE_NOW) { const RD = w.Date; const off = global.FAKE_NOW - RD.now(); class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } } w.Date = FD; }
      fake = makeFake({ store: (global.KEEP = global.KEEP || seed()), user, denied: (...a) => rulesFor(fake, userRef)(...a) });
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


const fire = async (w, el, ev) => { el.dispatchEvent(new w.Event(ev, { bubbles: true, cancelable: true })); await wait(250); };
(async () => {
  const D0 = new Date(2026, 10, 18, 12).getTime(); global.FAKE_NOW = D0;   // "today" for the first checks
  global.EXTRA = { "config/main": { chapter: "Iota Chapter", season: "Spring 2027 Rush", breakMode: true },
    "rounds/old": { name: "Old text", kind: "text", msg: "hi {first}", assign: { "r-jake": "t-aiden" }, createdAt: D0 - 8 * 86400000, closed: false },
    "rounds/oldcall": { name: "Calls · week of Nov 9", kind: "call", week: "2026-11-09", assign: { "r-jake": "t-aiden" }, createdAt: D0 - 9 * 86400000, closed: false } };
  // today (Nov 18): nothing auto-created yet
  let J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(300);
  ok(!Object.keys(J.fake.store).some(k => k.startsWith("rounds/auto-")), "nothing auto-created before Thanksgiving week");
  ok(/Past \(2\)/.test(txt(J.d)), "old text and old call week moved to Past");
  let t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(!/Old text/.test(txt(t.d)) && !/Your calls this week/.test(txt(t.d)), "brothers don't see old rounds");
  // Thanksgiving week
  global.FAKE_NOW = new Date(2026, 10, 24, 12).getTime();
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(500);
  const tg = J.fake.store["rounds/auto-thanksgiving-2026"];
  ok(tg && tg.name === "Happy Thanksgiving" && Object.keys(tg.assign).length === 0, "Thanksgiving set itself up, unassigned");
  ok(J.fake.store["config/main"].autoDone && J.fake.store["config/main"].autoDone["auto-thanksgiving-2026"], "remembered so it won't come back if deleted");
  ok(!J.fake.store["rounds/auto-christmas-2026"], "Christmas not yet");
  // brother: brother sees nothing until assigned
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(!/Happy Thanksgiving/.test(txt(t.d)), "not on My rush until assigned");
  // deleted auto round stays deleted
  delete J.fake.store["rounds/auto-thanksgiving-2026"];
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(400);
  ok(!J.fake.store["rounds/auto-thanksgiving-2026"], "a deleted holiday text isn't recreated");
  // Christmas + New Year
  global.FAKE_NOW = new Date(2026, 11, 24, 12).getTime();
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(500);
  ok(!!J.fake.store["rounds/auto-christmas-2026"] && !J.fake.store["rounds/auto-newyear-2027"], "Christmas set up Dec 24");
  global.FAKE_NOW = new Date(2026, 11, 31, 12).getTime();
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(500);
  ok(!!J.fake.store["rounds/auto-newyear-2027"], "New Year set up Dec 31");
  const ad = J.fake.store["config/main"].autoDone; ok(ad["auto-christmas-2026"] && ad["auto-newyear-2027"] && ad["auto-thanksgiving-2026"], "all remembered");
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  J.fake.store["rounds/auto-christmas-2026"].assign = { "r-jake": "t-aiden" };
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(!/Merry Christmas/.test(txt(t.d)), "Christmas text cleared off My rush after a week");
  // break mode off: nothing auto
  global.KEEP = null; global.EXTRA = { "config/main": { breakMode: false } }; global.FAKE_NOW = new Date(2026, 10, 24, 12).getTime();
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(400);
  ok(!Object.keys(J.fake.store).some(k => k.startsWith("rounds/auto-")), "nothing auto-created with break mode off");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
