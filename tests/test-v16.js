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
  // modes off
  let t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(!/Your calls this week/.test(txt(t.d)) && !/Christmas cards/.test(txt(t.d)), "nothing shows with modes off");
  let J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true });
  J.w.location.hash = "#board"; await wait(200);
  const sw = J.d.querySelector('input[data-change="mode"][data-k="breakMode"]'); ok(!!sw, "seasons switches on Board");
  sw.checked = true; await fire(J.w, sw, "change");
  ok(J.fake.store["config/main"].breakMode === true, "break mode on");
  await click(J.w, J.d.querySelector('[data-a="call-week"]')); await wait(300);
  const rid = Object.keys(J.fake.store).find(k => k.startsWith("rounds/")).slice(7);
  ok(J.w.location.hash === "#round:" + rid && /Calls · week of/.test(txt(J.d)), "call week created, round page open");
  ok(/Not assigned/.test(txt(J.d)) && Object.keys(J.fake.store["rounds/" + rid].assign).length === 0, "starts unassigned");
  const sel = J.d.querySelector('select[data-change="round-who"][data-id="r-jake"]'); sel.value = "t-aiden"; await fire(J.w, sel, "change");
  ok(J.fake.store["rounds/" + rid].assign["r-jake"] === "t-aiden", "manual assign");
  await click(J.w, J.d.querySelector('[data-a="round-auto"]')); await wait(300);
  const asg = J.fake.store["rounds/" + rid].assign; ok(Object.keys(asg).length === 3 && asg["r-jake"] === "t-aiden", "auto-assign fills the rest, keeps manual: " + JSON.stringify(asg));
  // holiday text round
  J.w.location.hash = "#board"; await wait(200);
  await click(J.w, J.d.querySelector('[data-a="round-new"]'));
  await fire(J.w, J.d.querySelector('[data-form="roundnew"]'), "submit"); await wait(300);
  const tid = Object.keys(J.fake.store).filter(k => k.startsWith("rounds/")).map(k => k.slice(7)).find(k => k !== rid);
  ok(J.fake.store["rounds/" + tid].name === "Happy Thanksgiving", "thanksgiving round");
  await click(J.w, J.d.querySelector('[data-a="round-auto"]')); await wait(300);
  // brother side
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  let tx = txt(t.d);
  ok(/Your calls this week/.test(tx) && /Jake Sample/.test(tx), "brother sees his calls");
  ok(!!t.d.querySelector('a[href^="tel:"]'), "call button dials");
  ok(/Happy Thanksgiving/.test(tx), "brother sees holiday text");
  await click(t.w, t.d.querySelector('[data-a="call-out"][data-v="talked"][data-id="r-jake"]')); await wait(300);
  ok(t.fake.store["sends/" + rid + "__r-jake"] && t.fake.store["sends/" + rid + "__r-jake"].outcome === "talked", "talked recorded");
  ok(/Call with Jake/.test(txt(t.d)), "note prompt after call");
  const nf = t.d.querySelector('.modal [data-form="note"]'); nf.querySelector("textarea").value = "Good call, loves skiing"; nf.querySelector('[name="rating"][value="4"]').checked = true;
  await fire(t.w, nf, "submit"); await wait(200);
  ok(Object.values(t.fake.store).some(v => v.text === "Good call, loves skiing" && v.rating === 4) && !t.d.querySelector('.modal [data-form="note"]'), "call note saved, modal closed");
  ok(Object.values(t.fake.store).some(v => v.kind === "call" && v.rusheeId === "r-jake"), "call counts as contact");
  const tb = t.d.querySelector('[data-a="round-text"]');
  if (tb) { const who = tb.dataset.id; await click(t.w, tb); const m = t.d.querySelector(".modal textarea.msgedit").value; ok(/Happy Thanksgiving from all of us at BYX/.test(m) && m.indexOf("{first}") < 0, "holiday message filled: " + m.slice(0, 40));
    await click(t.w, t.d.querySelector('.modal [data-a="round-sent"]')); await wait(300); ok(!!t.fake.store["sends/" + tid + "__" + who], "holiday text checked off"); }
  else ok(false, "no holiday text button for aiden");
  // brother cannot assign or mark others' sends via rules
  const r1 = await t.w.eval('firebase.firestore().doc("rounds/x").set({name:"x"}).then(()=>"ok",e=>e.code)'); ok(r1 === "permission-denied", "brother can't create rounds");
  // cards
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#board"; await wait(200);
  const cs = J.d.querySelector('input[data-change="mode"][data-k="cardMode"]'); cs.checked = true; await fire(J.w, cs, "change");
  J.w.location.hash = "#cards"; await wait(200);
  ok(/No one is on the card list yet/.test(txt(J.d)), "cards start empty");
  await click(J.w, J.d.querySelector('[data-a="card-pick"]'));
  const cb = J.d.querySelector('input[data-change="cp-one"][data-id="r-jake"]'); cb.checked = true; await fire(J.w, cb, "change");
  await click(J.w, J.d.querySelector('[data-a="cp-save"]')); await wait(300);
  ok(J.fake.store["cards/r-jake"] && J.fake.store["cards/r-jake"].eligible === true && !J.fake.store["cards/r-ben"], "picker adds only who's chosen");
  J.w.location.hash = "#rushees"; await wait(200);
  await click(J.w, [...J.d.querySelectorAll('[data-a="open-r"]')].find(x => /Cole/.test(x.textContent)));
  const pe = J.d.querySelector('input[data-change="card-elig"]'); ok(!!pe, "Christmas card checkbox on profile");
  pe.checked = true; await fire(J.w, pe, "change");
  ok(J.fake.store["cards/r-cole"] && J.fake.store["cards/r-cole"].eligible === true, "profile checkbox adds him");
  const badE = await (await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true })).w.eval('firebase.firestore().doc("cards/r-ben").set({rusheeId:"r-ben",eligible:true}).then(()=>"ok",e=>e.code)');
  ok(badE === "permission-denied", "brothers can't add guys to the card list");
  t = await load({ uid: "u-aiden", email: "aiden@example.com", emailVerified: true });
  ok(/Christmas cards/.test(txt(t.d)), "cards link on My rush");
  t.w.location.hash = "#cards"; await wait(200);
  ok(/2\s*Getting a card/.test(txt(t.d)), "card page shows only the 2 picked");
  await click(t.w, t.d.querySelector('[data-a="card-claim"]')); await wait(200);
  const c1 = Object.entries(t.fake.store).find(([k, v]) => k.startsWith("cards/") && (v.signers || []).includes("t-aiden")); ok(c1 && c1[1].signers[0] === "t-aiden", "claim card");
  const cr = c1[0].slice(6);
  await click(t.w, t.d.querySelector('[data-a="card-sign"][data-id="' + cr + '"]')); await wait(200);
  ok(t.fake.store["cards/" + cr].signedBy[0] === "t-aiden", "signed");
  await click(t.w, t.d.querySelector('[data-a="card-edit"][data-id="' + cr + '"]'));
  const ce = t.d.querySelector('[data-form="cardedit"]'); ok(!ce.querySelector('[name="sent"]'), "brother can't mark sent");
  ce.querySelector('[name="address"]').value = "123 Main St\nWaco, TX 76706"; await fire(t.w, ce, "submit"); await wait(300);
  ok(t.fake.store["addresses/" + cr] && /Main St/.test(t.fake.store["addresses/" + cr].text) && t.fake.store["cards/" + cr].hasAddress === true, "address saved");
  ok(/123 Main St/.test(txt(t.d)), "team sees the address");
  const bad = await t.w.eval('firebase.firestore().doc("cards/' + cr + '").update({sent:true}).then(()=>"ok",e=>e.code)'); ok(bad === "permission-denied", "brother can't mark sent via rules");
  const L = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true }); L.w.location.hash = "#cards"; await wait(200);
  ok(!/123 Main St/.test(txt(L.d)), "leadership doesn't see addresses");
  J = await load({ uid: "u-jonah", email: "jonah@example.com", emailVerified: true }); J.w.location.hash = "#cards-print"; await wait(200);
  ok(/123 Main St/.test(txt(J.d)), "address list for printing");
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
