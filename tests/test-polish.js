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
    "team/t-x": { name: "Zed Hunter", role: "member", phone: "", email: "zed@example.com", interests: "Hunting, golf, Spurs" },
    "team/t-sam": { name: "Sam Houston", role: "member", phone: "(713) 555-0111", email: "sam@example.com", uid: null, hometown: "Houston" },
    "team/t-rob": { name: "Rob Gulley", role: "member", phone: "(254) 555-0101", email: "", uid: null },
    "access/jonah@example.com": { role: "coordinator", name: "Jonah Woo" },
    "access/aiden@example.com": { role: "member", name: "Aiden Irvin" },
    "access/luke@example.org": { role: "viewer", name: "Luke Harbour", title: "Leadership Coordinator" },
    "rushees/r-jake": { name: "Jake Sample", phone: "(254) 555-0199", stage: "new", year: "Freshman", tags: [], hometown: "San Antonio", interests: "Loves hunting and golf", createdAt: Date.now() - 20*86400000 },
    "rushees/r-ben": { name: "Ben Demo", phone: "(512) 555-0142", stage: "interested", year: "Sophomore", tags: [], createdAt: Date.now() - 20*86400000 },
    "rushees/r-cole": { name: "Cole Fresh", interests: "big into hunting", phone: "(512) 555-0100", stage: "strong", year: "Freshman", tags: [], hometown: "Houston", createdAt: Date.now() - 1*86400000 },
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
    if (op === "get" || op === "read") return !member;
    const isWrite = op !== "get" && op !== "read";
    if (!isWrite) return false;
    const existing = fake.store[path];
    switch (col) {
      case "config": case "events": return !admin;
      case "team": if (admin) return false; return !(writer && op === "update" && existing && existing.email === email && Object.keys(d).every(k => ["uid","hometown","major","year","church","dorm","interests"].includes(k)));
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


const fire = async (w, el, ev) => { el.dispatchEvent(new w.Event(ev, { bubbles: true, cancelable: true })); await wait(250); };
(async () => {
  const U = (n) => ({ uid: "u-" + n, email: n + "@example.com", emailVerified: true });
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  // sizes: every text box is 16px, so iPhones don't zoom in when one is tapped
  ok(/input\[type=text\][^{]*select,textarea,textarea\.msgedit\{font-size:16px;min-height:44px/.test(css), "text boxes are 16px and 44px tall");
  ok(/\.inline-add input,\.plantable select,th select\{font-size:16px/.test(css), "small boxes are 16px too");
  const sizes = [...css.matchAll(/(?:^|\})([^{}]*(?:input|select|textarea)[^{}]*)\{([^}]*font-size:\s*([\d.]+)px[^}]*)\}/g)].filter(m => !/\.door|label|small|span|\.checks|\.rate|\.chip/.test(m[1]));
  const last = {}; sizes.forEach(m => m[1].split(",").forEach(sel => { last[sel.trim()] = +m[3]; }));
  const small = Object.keys(last).filter(k => last[k] < 16);
  ok(small.length === 0, "no text box rule ends up under 16px" + (small.length ? ": " + small.join(" | ") : ""));
  ok(/\.btn\{min-height:44px/.test(css) && /\.btn\.sm\{min-height:40px/.test(css), "buttons are 44px, small ones 40px");
  ok(/prefers-reduced-motion:reduce/.test(css), "respects Reduce Motion");
  ok(!/\.modal\{animation:rise \.18s/.test(css), "old always-on animation removed");

  // motion happens once, on open
  let t = await load(U("aiden"));
  const app = () => t.d.getElementById("app");
  ok((app().getAttribute("data-enter") || "") === "", "nothing animates on first paint");
  await click(t.w, t.d.querySelector('[data-a="sub-lunch"]'));
  ok(/\bmodal\b/.test(app().getAttribute("data-enter")), "a sheet animates when it opens");
  await click(t.w, t.d.querySelector('.modal [data-a="close-modal"]'));
  // a sheet that redraws itself (picking a preset) must not slide in again
  const J = await load(U("jonah"));
  await J.w.eval('firebase.firestore().doc("config/main").update({breakMode:true,breakSince:Date.now()})'); await wait(200);
  J.w.location.hash = "#board"; await wait(300);
  await click(J.w, J.d.querySelector('[data-a="round-new"]'));
  ok(/\bmodal\b/.test(J.d.getElementById("app").getAttribute("data-enter")), "coordinator sheet animates on open");
  await click(J.w, J.d.querySelector('.modal [data-a="round-preset"][data-v="christmas"]'));
  ok(!!J.d.querySelector(".modal") && !/\bmodal\b/.test(J.d.getElementById("app").getAttribute("data-enter")), "and not again when it redraws");
  t.w.location.hash = "#rushees"; await wait(250);
  ok(/\bview\b/.test(app().getAttribute("data-enter")), "switching tabs fades the new tab in");
  await click(t.w, t.d.querySelector('[data-a="open-r"]'));
  ok(/\bdrawer\b/.test(app().getAttribute("data-enter")) && !/\bview\b/.test(app().getAttribute("data-enter")), "a profile slides in when it opens");
  await t.w.eval('firebase.firestore().doc("rushees/r-jake").update({tags:["y"]})'); await wait(250);
  ok(!!t.d.querySelector(".drawer") && (app().getAttribute("data-enter") || "") === "", "profile stays put on refresh");

  // faces
  const avs = [...t.d.querySelectorAll("#view .avatar")];
  ok(avs.length >= 3 && avs.some(a => /\bav[1-5]\b/.test(a.className)), "initials get tints");
  const cls = (n) => { const el = [...t.d.querySelectorAll("#view .item")].find(x => x.textContent.indexOf(n) >= 0); return el ? el.querySelector(".avatar").className : ""; };
  const c1 = cls("Jake Sample"); t = await load(U("aiden")); t.w.location.hash = "#rushees"; await wait(250);
  ok(c1 && c1 === cls("Jake Sample"), "a guy keeps the same tint every time: " + c1);

  // toast
  await t.w.eval('firebase.firestore().doc("rushees/r-jake").update({tags:[]})');
  t.w.location.hash = "#me"; await wait(200);
  const f = t.d.querySelector('[data-form="aboutme"]');
  if (f) { f.querySelector('[name="hometown"]').value = "Boerne, TX"; await fire(t.w, f, "submit"); await wait(200); }
  const toast = t.d.querySelector(".toast"); ok(toast && toast.classList.contains("in"), "toast slides in");

  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
