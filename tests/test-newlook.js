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
const openTodos = async (t) => { for (let i = 0; i < 20; i++) { const el = t.d.querySelector('.todo [data-a="todo"][aria-expanded="false"]'); if (!el) break; el.dispatchEvent(new t.w.MouseEvent("click", { bubbles: true })); await wait(120); } if (t.d.activeElement && t.d.activeElement.blur) t.d.activeElement.blur(); };
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
  const U = (n) => ({ uid: "u-" + n, email: n + "@example.com", emailVerified: true });
  // ---------- Home ----------
  let t = await load(U("aiden"));
  const up = t.d.querySelector(".upnext");
  ok(up && /Up next/.test(up.textContent) && /Lunch with Ben Demo/.test(up.textContent) && /Common Grounds/.test(up.textContent), "Up next shows his next lunch: " + (up ? up.textContent.slice(0, 80) : ""));
  ok(/1 lunch coming up/.test(txt(t.d)) && /things to do/.test(txt(t.d)), "greeting sums up the day");
  const todo = () => t.d.querySelector(".todo");
  ok(todo() && /Reach out to Jake Sample/.test(todo().textContent) && /Add your note on Ben Demo/.test(todo().textContent) && /Tell the team about you/.test(todo().textContent), "to-do list has the assignment, the note owed and About you");
  ok(t.d.querySelector("h3 .badge").textContent === String(todo().querySelectorAll(".todo-item").length), "badge matches the number of to-dos");
  ok(!t.d.querySelector('.todo form[data-form="note"]') && !t.d.querySelector('.todo input[data-change="reached"]'), "rows start closed");
  ok(!!t.d.querySelector('.quick [data-a="plan-own"]') && !!t.d.querySelector('.quick [data-a="sub-lunch"]') && !!t.d.querySelector('.quick [data-a="sub-pnm"]'), "three quick actions");
  const stat = (lbl) => { const el = [...t.d.querySelectorAll(".stat")].find(x => x.textContent.indexOf(lbl) >= 0); return el ? el.querySelector(".num").textContent : null; };
  ok(stat("Scheduled") === "1" && stat("Your guys") === "2" && stat("In review") === "0", "numbers strip: " + [stat("Scheduled"), stat("Your guys"), stat("In review")].join("/"));
  ok(!/Guys near you/.test(txt(t.d)), "no break section when break mode is off");
  // text the guy he's meeting
  await click(t.w, up.querySelector('[data-a="up-text"]'));
  const um = t.d.querySelector(".modal textarea.msgedit").value;
  ok(/^Hey Ben! Looking forward to lunch/.test(um) && /Common Grounds/.test(um), "confirm text filled: " + um);
  await click(t.w, t.d.querySelector('.modal a[data-a="up-sent"]')); await wait(500);
  ok(Object.values(t.fake.store).some(v => v.kind === "text" && v.rusheeId === "r-ben" && v.lunchId === "l3"), "confirm text counts as contact");
  ok(!t.d.querySelector(".modal"), "text sheet closed");
  // to-do: Text opens the same outreach texts as before
  await click(t.w, todo().querySelector('[data-a="rtext"]'));
  ok(/Text Jake/.test(t.d.querySelector(".modal").textContent) && !!t.d.querySelector('.modal [data-a="rtext-sent"]'), "Text on a to-do opens the outreach texts");
  await click(t.w, t.d.querySelector('.modal a[data-a="rtext-sent"]')); await wait(500);
  ok(t.fake.store["lunches/l1"].reachedOut === true, "sending marks reached out");
  ok(/Waiting on Jake Sample/.test(todo().textContent) && /You reached out today/.test(todo().textContent), "row becomes Waiting on him");
  // open the row: the full card is there with every control
  await click(t.w, [...todo().querySelectorAll('[data-a="todo"]')].find(x => /Next step/.test(x.textContent)));
  ok(!!todo().querySelector('.todo-body form[data-form="schedule"]') && !!todo().querySelector('.todo-body [data-a="fu-text"]') && !!todo().querySelector('.todo-body input[data-change="reached"]'), "opened row has set-a-time, follow up and reached out");
  // write the note he owes
  await click(t.w, [...todo().querySelectorAll('button[data-a="todo"]')].find(x => /Write/.test(x.textContent)));
  const nf = todo().querySelector('.todo-body form[data-form="note"]'); ok(!!nf, "Write opens the note form in place");
  if (t.d.activeElement && t.d.activeElement.blur) t.d.activeElement.blur();
  nf.querySelector("textarea").value = "Solid guy, wants a small group"; nf.querySelector('[name="rating"][value="4"]').checked = true;
  await fire(t.w, nf, "submit"); await wait(300);
  ok(Object.values(t.fake.store).some(v => v.text === "Solid guy, wants a small group" && v.lunchId === "l2" && v.uid === "u-aiden"), "note saved against that lunch");
  ok(!/Add your note on Ben Demo/.test(todo().textContent), "note to-do clears");

  // ---------- Rushees ----------
  t.w.location.hash = "#rushees"; await wait(250);
  const chip = (v) => t.d.querySelector('[data-a="stage-filter"][data-v="' + v + '"]');
  ok(/All\s*3/.test(chip("all").textContent) && /Strong\s*1/.test(chip("strong").textContent) && /New\s*1/.test(chip("new").textContent), "stage filters show counts");
  await click(t.w, chip("bid"));
  ok(/No rushees match/.test(txt(t.d)) && !!t.d.querySelector('[data-a="clear-filters"]'), "empty result offers Clear filters");
  await click(t.w, t.d.querySelector('[data-a="clear-filters"]'));
  ok(t.d.querySelectorAll('#rlist [data-a="open-r"]').length === 3, "Clear filters brings everyone back");

  // ---------- Profile ----------
  await t.w.eval('firebase.firestore().doc("rushees/r-jake").update({avoid:"his old team"})'); await wait(250);
  await click(t.w, [...t.d.querySelectorAll('#rlist [data-a="open-r"]')].find(x => /Jake/.test(x.textContent)));
  const dr = () => t.d.querySelector(".drawer");
  ok(!!dr().querySelector(".phead") && /Jake Sample/.test(dr().querySelector(".phead h2").textContent), "profile header");
  const kids = [...dr().children]; const iHead = kids.findIndex(x => x.classList.contains("phead")), iAvoid = kids.findIndex(x => x.classList.contains("avoid-top")), iActs = kids.findIndex(x => x.classList.contains("pactions"));
  ok(iAvoid === iHead + 1 && iActs === iAvoid + 1 && /his old team/.test(kids[iAvoid].textContent), "topics to avoid sits right under his name, above the buttons");
  ok(!!dr().querySelector('.pactions [data-a="p-text"]') && /^tel:/.test(dr().querySelector(".pactions a.pact").getAttribute("href")) && !!dr().querySelector('.pactions [data-a="save-contact"]') && !!dr().querySelector('.pactions [data-a="sub-lunch"]'), "Text, Call, Log lunch, Save contact");
  ok(["Topics to avoid", "Tags", "Rushing with", "Events attended", "Lunches", "Team notes"].every(h => dr().textContent.indexOf(h) >= 0) && !!dr().querySelector('form[data-form="avoid"]') && !!dr().querySelector('form[data-form="tag"]') && !!dr().querySelector('form[data-form="nick"]'), "every old profile section is still there");
  ok(!!dr().querySelector('.pcta [data-a="note-jump"]'), "Add a note stays pinned at the bottom");
  await click(t.w, dr().querySelector('[data-a="p-text"]'));
  ok(/^Hey Jake! It's Aiden from BYX\./.test(t.d.querySelector(".modal textarea.msgedit").value) && /Avoid/.test(t.d.querySelector(".modal").textContent), "Text from the profile, with the avoid warning");
  await click(t.w, t.d.querySelector('.modal a[data-a="p-sent"]')); await wait(500);
  await click(t.w, dr().querySelector('.pactions [data-a="sub-lunch"]'));
  ok(t.d.querySelector('.modal [data-form="sublunch"] [name="rushee"]').value === "Jake Sample", "Log lunch opens with him filled in");
  const sf = t.d.querySelector('.modal [data-form="sublunch"]'); sf.querySelector('[name="rating"][value="5"]').checked = true; sf.querySelector('[name="note"]').value = "Great lunch";
  await fire(t.w, sf, "submit"); await wait(300);
  ok(/Lunch logged/.test(t.d.querySelector(".modal").textContent) && !!t.d.querySelector(".modal .okmark.big") && !!t.d.querySelector('.modal [data-a="sub-lunch"]'), "logged screen with the check and Log another");
  await click(t.w, t.d.querySelector('.modal [data-a="close-modal"]'));
  // Ben has a note: latest note shows up top
  await click(t.w, dr().querySelector('[data-a="close-drawer"]'));
  await click(t.w, [...t.d.querySelectorAll('#rlist [data-a="open-r"]')].find(x => /Ben/.test(x.textContent)));
  ok(/Latest note/.test(dr().querySelector(".latest").textContent) && /Solid guy/.test(dr().querySelector(".latest").textContent), "latest note near the top");
  ok(!dr().querySelector(".avoid-top"), "no avoid banner when there's nothing to avoid");

  // ---------- Board ----------
  const J = await load(U("jonah")); J.w.location.hash = "#board"; await wait(300);
  const rv = J.d.querySelector("#review");
  ok(rv && /Needs your review/.test(rv.textContent) && /1 lunch/.test(rv.querySelector(".upnext-title").textContent) && /From Aiden/.test(rv.textContent), "review card sums up what's waiting");
  const ap = rv.querySelector('[data-a="sub-approve"]'); ok(!!ap, "Approve is still one tap, right under the card");
  await click(J.w, ap); await wait(400);
  ok(Object.values(J.fake.store).some(v => v.type === "lunch" && v.status === "approved" && v.rusheeId === "r-jake"), "approving works");
  ok(!J.d.querySelector("#review"), "review card goes away when nothing is waiting");
  const bs = (lbl) => { const el = [...J.d.querySelectorAll(".stats.card .stat")].find(x => x.textContent.indexOf(lbl) >= 0); return el ? el.querySelector(".num").textContent : null; };
  ok(bs("Active rushees") === "3" && bs("Not assigned") !== null && bs("Notes this week") !== null, "board numbers strip");
  const rows = [...J.d.querySelectorAll(".piperow")];
  ok(rows.length === 7 && rows.some(r => r.dataset.v === "strong" && /1/.test(r.querySelector("b").textContent)), "pipeline has a row per stage with counts");
  await click(J.w, J.d.querySelector('.piperow[data-v="strong"]')); await wait(300);
  ok(J.w.location.hash === "#rushees" && J.d.querySelector('[data-a="stage-filter"][data-v="strong"]').getAttribute("aria-pressed") === "true" && J.d.querySelectorAll('#rlist [data-a="open-r"]').length === 1, "tapping a stage opens Rushees filtered to it");
  J.w.location.hash = "#board"; await wait(250);
  ok(!!J.d.querySelector('input[data-change="mode"][data-k="breakMode"]') && /Not assigned yet/.test(txt(J.d)) && /Team load/.test(txt(J.d)), "seasons, not assigned and team load are still on the Board");

  // ---------- leadership view ----------
  const L = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true }); L.w.location.hash = "#rushees"; await wait(250);
  await click(L.w, L.d.querySelector('#rlist [data-a="open-r"]'));
  ok(!!L.d.querySelector(".drawer .phead") && !L.d.querySelector(".drawer .pactions") && !L.d.querySelector(".drawer .pcta"), "leadership sees the profile without action buttons");
  L.w.location.hash = "#board"; await wait(250);
  ok(L.d.querySelectorAll(".piperow").length === 7 && !L.d.querySelector('[data-a="sub-approve"]'), "leadership sees the pipeline, can't approve");

  // ---------- nothing to do ----------
  global.KEEP = null; const sd = seed(); delete sd["lunches/l1"]; delete sd["lunches/l2"]; delete sd["lunches/l3"];
  Object.assign(sd["team/t-aiden"], { hometown: "Boerne", major: "Finance", year: "Junior" }); global.KEEP = sd;
  t = await load(U("aiden"));
  ok(!t.d.querySelector(".upnext") && !t.d.querySelector(".todo") && /all caught up/i.test(txt(t.d)), "empty Home says he's caught up");
  ok(/Nothing on your calendar yet/.test(txt(t.d)) && !!t.d.querySelector('.empty.rich [data-a="plan-own"]'), "empty schedule offers Plan a lunch");

  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
