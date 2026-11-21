const { JSDOM } = require("jsdom");
const fs = require("fs");
const makeFake = require("./fakefb");
const html = fs.readFileSync(require("path").join(__dirname, "..", "app", "index.html"), "utf8");
const OWNER = "rob@example.com";
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

function seed() {
  return {
    "config/main": { chapter: "Iota Chapter", season: "Spring 2027 Rush", cardMode: true },
    "team/t-jonah": { name: "Jonah Woo", role: "coordinator", phone: "(443) 555-0128", email: "jonah@example.com", uid: null },
    "team/t-aiden": { name: "Aiden Irvin", role: "member", phone: "(830) 555-0140", email: "aiden@example.com", uid: "u-aiden" },
    "access/jonah@example.com": { role: "coordinator", name: "Jonah Woo" },
    "access/aiden@example.com": { role: "member", name: "Aiden Irvin" },
    "access/luke@example.org": { role: "viewer", name: "Luke Harbour", title: "Leadership Coordinator" },
    "rushees/r-jake": { name: "Jake Sample", phone: "(254) 555-0199", stage: "new", year: "Freshman", tags: [], createdAt: Date.now() - 20*86400000 },
    "rushees/r-ben": { name: "Ben Demo", phone: "(512) 555-0142", stage: "interested", year: "Sophomore", tags: [], createdAt: Date.now() - 20*86400000 },
    "rushees/r-cole": { name: "Cole Fresh", phone: "(512) 555-0100", stage: "strong", year: "Freshman", tags: [], createdAt: Date.now() - 1*86400000 },
    "rushees/r-drew": { name: "Drew Gone", phone: "(512) 555-0177", stage: "dropped", year: "Junior", tags: [], createdAt: Date.now() - 30*86400000 },
    "addresses/r-jake": { rusheeId: "r-jake", text: "100 Sample Ave\nWaco, TX 76706", by: "t-aiden", at: 1 },
    "cards/r-jake": { rusheeId: "r-jake", signers: [], signedBy: [], hasAddress: true },
  };
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
const openGuy = async (t, name) => { t.w.location.hash = "#rushees"; await wait(200); await click(t.w, [...t.d.querySelectorAll('[data-a="open-r"]')].find(x => x.textContent.includes(name))); };
const drawer = (d) => (d.querySelector(".drawer") || {}).textContent || "";
const JONAH = { uid: "u-jonah", email: "jonah@example.com", emailVerified: true };
const AIDEN = { uid: "u-aiden", email: "aiden@example.com", emailVerified: true };
const LUKE = { uid: "u-luke", email: "luke@example.org", emailVerified: true };

(async () => {
  // Mailing address on the profile
  let J = await load(JONAH); await openGuy(J, "Jake Sample");
  ok(/Mailing address/.test(drawer(J.d)) && /100 Sample Ave/.test(drawer(J.d)), "coordinator sees the address on his profile");
  const dd = [...J.d.querySelectorAll(".drawer dd")].find(x => /Sample Ave/.test(x.textContent));
  ok(dd && /pre-wrap/.test(dd.getAttribute("style") || ""), "address keeps its line breaks");
  await openGuy(J, "Ben Demo");
  ok(!/Mailing address/.test(drawer(J.d)), "no address row when there isn't one");

  let A = await load(AIDEN); await openGuy(A, "Jake Sample");
  ok(/100 Sample Ave/.test(drawer(A.d)), "rush team brother sees the address on his profile");

  const L = await load(LUKE); await openGuy(L, "Jake Sample");
  ok(/Jake Sample/.test(drawer(L.d)) && !/Mailing address|Sample Ave/.test(drawer(L.d)), "leadership doesn't see the address on his profile");
  const lr = await L.w.eval('firebase.firestore().doc("addresses/r-jake").get().then(()=>"ok",e=>e.code)');
  ok(lr === "permission-denied", "leadership can't read addresses via rules");

  // Owner previewing as leadership doesn't see it either
  const R = await load({ uid: "u-rob", email: OWNER, emailVerified: true });
  await openGuy(R, "Jake Sample");
  ok(/100 Sample Ave/.test(drawer(R.d)), "owner sees the address");
  R.w.location.hash = "#team"; await wait(200);
  await click(R.w, R.d.querySelector('[data-a="preview-start"][data-kind="viewer"]')); await wait(200);
  ok(/Previewing as Leadership/.test(R.d.body.textContent), "owner is previewing as leadership");
  await openGuy(R, "Jake Sample");
  ok(!/Sample Ave/.test(drawer(R.d)), "preview as leadership hides the address");

  // Select everyone
  J = await load(JONAH); J.w.location.hash = "#cards"; await wait(200);
  await click(J.w, J.d.querySelector('[data-a="card-pick"]'));
  const all = J.d.querySelector('[data-a="cp-stage"][data-v="all"]');
  ok(all && /Select everyone/.test(all.textContent), "Select everyone button in the picker");
  await click(J.w, all);
  const checked = [...J.d.querySelectorAll('input[data-change="cp-one"]')].filter(x => x.checked).map(x => x.dataset.id).sort();
  ok(JSON.stringify(checked) === JSON.stringify(["r-ben", "r-cole", "r-jake"]), "everyone active is checked: " + checked);
  ok(/3 getting a card/.test(J.d.querySelector('[data-a="cp-save"]').textContent), "save button counts 3");
  await click(J.w, J.d.querySelector('[data-a="cp-save"]')); await wait(300);
  const st = J.fake.store;
  ok(["r-jake", "r-ben", "r-cole"].every(id => st["cards/" + id] && st["cards/" + id].eligible === true), "all three saved to the card list");
  ok(!st["cards/r-drew"], "dropped guy isn't added");
  ok(st["cards/r-jake"].hasAddress === true, "existing card keeps its other fields");
  // Clear all still undoes it
  await click(J.w, J.d.querySelector('[data-a="card-pick"]'));
  await click(J.w, J.d.querySelector('[data-a="cp-stage"][data-v="none"]'));
  ok([...J.d.querySelectorAll('input[data-change="cp-one"]')].every(x => !x.checked), "Clear all unchecks everyone");
  await click(J.w, J.d.querySelector('[data-a="close-modal"]'));

  // Brothers can't do the coordinator-only thing
  A = await load(AIDEN); A.w.location.hash = "#cards"; await wait(200);
  ok(!A.d.querySelector('[data-a="card-pick"]'), "brothers don't get the card picker");
  const bad = await A.w.eval('firebase.firestore().doc("cards/r-ben").update({eligible:false}).then(()=>"ok",e=>e.code)');
  ok(bad === "permission-denied", "brothers can't change who gets a card via rules");

  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
