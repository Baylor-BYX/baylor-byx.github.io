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
  const now = Date.now();
  return {
    "config/main": { chapter: "Iota Chapter", season: "Spring 2027 Rush", breakMode: true, breakSince: now - 2*86400000 },
    "team/t-jonah": { name: "Jonah Woo", role: "coordinator", phone: "(443) 555-0128", email: "jonah@example.com", uid: null, hometown: "Katy, TX" },
    "team/t-aiden": { name: "Aiden Irvin", role: "member", phone: "(830) 555-0140", email: "aiden@example.com", uid: "u-aiden", hometown: "Plano, TX", major: "Finance", year: "Junior" },
    "team/t-max": { name: "Max Sample", role: "member", phone: "(214) 555-0155", email: "max@example.com", uid: "u-max", hometown: "North Dallas", major: "MIS", year: "Senior" },
    "team/t-sam": { name: "Sam Houston", role: "member", phone: "(713) 555-0111", email: "sam@example.com", uid: "u-sam", hometown: "Houston", major: "Biology", year: "Junior" },
    "team/t-nate": { name: "Nate Blank", role: "member", phone: "(254) 555-0177", email: "nate@example.com", uid: "u-nate" },
    "access/jonah@example.com": { role: "coordinator", name: "Jonah Woo" },
    "access/aiden@example.com": { role: "member", name: "Aiden Irvin" },
    "access/max@example.com": { role: "member", name: "Max Sample" },
    "access/sam@example.com": { role: "member", name: "Sam Houston" },
    "access/nate@example.com": { role: "member", name: "Nate Blank" },
    "access/luke@example.org": { role: "viewer", name: "Luke Harbour", title: "Leadership Coordinator" },
    ...(global.EXTRA || {}),
    "rushees/r-jake": { name: "Jake Sample", phone: "(254) 555-0199", stage: "new", year: "Freshman", tags: [], hometown: "San Antonio", createdAt: now - 20*86400000 },
    "rushees/r-ben": { name: "Ben Demo", phone: "(512) 555-0142", stage: "interested", year: "Sophomore", tags: [], avoid: "his old roommate", createdAt: now - 20*86400000 },
    "rushees/r-cole": { name: "Cole Fresh", phone: "(512) 555-0100", stage: "strong", year: "Freshman", tags: [], hometown: "Houston", createdAt: now - 1*86400000 },
    "rushees/r-dan": { name: "Dan Example", phone: "(817) 555-0123", stage: "met", year: "Freshman", tags: [], hometown: "Fort Worth, Texas", createdAt: now - 9*86400000 },
    "rushees/r-eli": { name: "Eli Nowhere", phone: "(254) 555-0134", stage: "new", year: "Freshman", tags: [], createdAt: now - 9*86400000 },
    "rushees/r-finn": { name: "Finn Placeholder", phone: "(972) 555-0166", stage: "new", year: "Freshman", tags: [], createdAt: now - 9*86400000 },
    "rushees/r-gus": { name: "Gus Dropped", phone: "(972) 555-0188", stage: "dropped", year: "Freshman", tags: [], hometown: "Plano", createdAt: now - 9*86400000 },
    "addresses/r-ben": { rusheeId: "r-ben", text: "100 Sample St, Frisco, TX 75034", by: "t-jonah", at: now - 5*86400000 },
    "addresses/r-finn": { rusheeId: "r-finn", text: "12345 Oak Hollow Ln\nMcKinney TX 75070", by: "t-jonah", at: now - 5*86400000 },
    // an old "near" text from before this break started must not count
    "reachouts/o-old": { rusheeId: "r-dan", by: "t-sam", at: now - 60*86400000, kind: "text", near: true },
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
    if (op === "get" || op === "read") return !member;
    const isWrite = op !== "get" && op !== "read";
    if (!isWrite) return false;
    const existing = fake.store[path];
    switch (col) {
      case "config": case "events": return !admin;
      case "team": if (admin) return false; return !(writer && op === "update" && existing && existing.email === email && Object.keys(d).every(k => (global.OLD_RULES ? ["uid","hometown","major","year","church","dorm","interests"] : ["uid","hometown","homeZip","major","year","church","dorm","interests"]).includes(k)));
      case "rushees": return op === "delete" ? !admin : !writer;
      case "lunches": if (op === "update") return !writer; if (op === "set" && !existing) { if (admin) return false; const tm = fake.store["team/" + (d.teamIds || [])[0]]; return !(writer && d.selfPlanned === true && d.status === "planned" && (d.teamIds || []).length === 1 && tm && String(tm.email).toLowerCase() === email); } return !admin;
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
  // ---- matching helpers ----
  let t = await load(U("aiden"));
  // The app keeps its functions private, so run the area-matching block on its own to unit-test it.
  const blk = html.slice(html.indexOf("var AREAS=["), html.indexOf("function breakSince"));
  const lib = new Function('function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");} function addrOf(){return "";}\n' + blk + '\nreturn {placeParse:placeParse,areaKeys:areaKeys,nearMatch:nearMatch};')();
  const ev = (code) => new Function("placeParse", "areaKeys", "nearMatch", "return " + code)(lib.placeParse, lib.areaKeys, lib.nearMatch);
  ok(typeof lib.placeParse === "function", "helpers are reachable");
  let p = ev('JSON.stringify(placeParse("100 Sample St, Frisco, TX 75034", true))'); ok(p === '{"city":"Frisco","state":"TX","zip":"75034"}', "address gives city, state, zip: " + p);
  p = ev('JSON.stringify(placeParse("12345 Preston Rd, Dallas, TX", true))'); ok(JSON.parse(p).zip === "" && JSON.parse(p).city === "Dallas", "a street number is never taken for a zip: " + p);
  p = ev('JSON.stringify(placeParse("12345 Oak Hollow Ln\\nMcKinney TX 75070", true))'); ok(JSON.parse(p).zip === "75070" && JSON.parse(p).city === "", "no commas: zip only, never the street: " + p);
  ok(ev('areaKeys([placeParse("North Dallas")]).keys[0]') === "dfw" && ev('areaKeys([placeParse("Fort Worth, Texas")]).keys[0]') === "dfw", "Dallas and Fort Worth are one area");
  ok(ev('areaKeys([placeParse("Arlington, VA")]).keys[0]') === "dc" && ev('areaKeys([placeParse("Arlington")]).keys[0]') === "dfw", "same city name, different state");
  ok(ev('areaKeys([{city:"",state:"",zip:"78041"}]).keys[0]') === "lrd" && ev('areaKeys([{city:"",state:"",zip:"78006"}]).keys[0]') === "sat", "Laredo zips aren't San Antonio");
  ok(ev('nearMatch(areaKeys([placeParse("Fredericksburg")]),areaKeys([placeParse("Fredericksburg, TX")]))') === true, "small towns still match by name");
  ok(ev('nearMatch(areaKeys([placeParse("Houston")]),areaKeys([placeParse("Plano")]))') === false, "Houston and Plano don't match");
  ok(ev('areaKeys([{city:"",state:"",zip:"59715"}]).keys[0]') === "z597", "unknown zips group by region");

  // ---- brother in Plano ----
  let tx = txt(t.d);
  ok(/Guys near you over break/.test(tx), "section on My rush");
  const sec = () => [...t.d.querySelectorAll("section")].find(x => /Guys near you over break/.test(x.textContent));
  let st = sec().textContent;
  ok(/Ben Demo/.test(st) && /Dan Example/.test(st) && /Finn Placeholder/.test(st), "sees the three DFW guys");
  ok(!/Jake Sample/.test(st) && !/Cole Fresh/.test(st) && !/Eli Nowhere/.test(st) && !/Gus Dropped/.test(st), "not San Antonio, Houston, unknown or dropped guys");
  ok(/Frisco/.test(st) && /Dallas–Fort Worth/.test(st), "shows the city or area");
  ok(!/Sample St/.test(tx) && !/Oak Hollow/.test(tx) && !/75034/.test(tx), "never shows a street address or zip");
  ok(/Avoid: his old roommate/.test(st), "topics to avoid still show");
  ok(sec().querySelector(".badge").textContent === "3", "badge counts who's left");
  ok([...t.d.querySelectorAll(".tile")].some(x => /Guys near you/.test(x.textContent) && /3/.test(x.textContent)) && !/Calls left/.test(tx), "tile swapped from calls to guys near you");
  ok(!t.d.querySelector('[data-a="call-log"]') && !/Your calls this week/.test(tx), "no calls section");
  ok(!/reached out/.test(st), "a text from before this break doesn't count");
  // text one
  await click(t.w, sec().querySelector('[data-a="near-text"][data-id="r-ben"]'));
  const msg = t.d.querySelector(".modal textarea.msgedit").value;
  ok(/^Hey Ben! It's Aiden from BYX\. I'm back in Plano for break\./.test(msg), "message filled: " + msg);
  const link = t.d.querySelector('.modal a[data-a="near-sent"]'); ok(link && /^sms:/.test(link.getAttribute("href")), "opens Messages");
  ok(/Avoid/.test(t.d.querySelector(".modal").textContent), "avoid warning on the text screen");
  await click(t.w, link); await wait(500);
  const ro = Object.values(t.fake.store).find(v => v.near === true && v.rusheeId === "r-ben");
  ok(ro && ro.by === "t-aiden" && ro.kind === "text", "reach-out logged");
  st = sec().textContent;
  ok(/You reached out/.test(st) && !sec().querySelector('[data-a="near-text"][data-id="r-ben"]') && sec().querySelector(".badge").textContent === "2", "checked off for him");
  ok(!t.d.querySelector(".modal textarea.msgedit"), "text screen closed");

  // ---- another DFW brother sees it ----
  let m = await load(U("max"));
  const msec = () => [...m.d.querySelectorAll("section")].find(x => /Guys near you over break/.test(x.textContent));
  ok(/Aiden reached out/.test(msec().textContent) && !msec().querySelector('[data-a="near-text"][data-id="r-ben"]'), "Max sees Aiden already reached out");
  ok(!!msec().querySelector('[data-a="near-text"][data-id="r-dan"]'), "Max can still text Dan");
  // plan a lunch from the list
  await click(m.w, msec().querySelector('[data-a="plan-own"][data-id="r-dan"]'));
  const pf = m.d.querySelector('.modal [data-form="planown"]');
  ok(pf && pf.querySelector('[name="rushee"]').value === "Dan Example", "Plan lunch opens with him filled in");
  pf.querySelector('[name="date"]').value = "2026-11-27"; pf.querySelector('[name="place"]').value = "Chick-fil-A";
  await fire(m.w, pf, "submit"); await wait(300);
  const nl = Object.values(m.fake.store).find(v => v.selfPlanned && (v.rusheeIds || [])[0] === "r-dan");
  ok(nl && nl.teamIds[0] === "t-max" && nl.date === "2026-11-27", "lunch saved under Max");
  m = await load(U("max"));
  ok(/Lunch .* with you/.test(msec().textContent) && !msec().querySelector('[data-id="r-dan"][data-a="near-text"]') && !msec().querySelector('[data-id="r-dan"][data-a="plan-own"]'), "Dan shows the lunch, no more buttons");
  t = await load(U("aiden"));
  ok(/Lunch .* with Max/.test(sec().textContent), "Aiden sees Max's lunch with Dan");

  // ---- Houston brother ----
  const s2 = await load(U("sam"));
  const ssec = [...s2.d.querySelectorAll("section")].find(x => /Guys near you over break/.test(x.textContent)).textContent;
  ok(/Cole Fresh/.test(ssec) && !/Ben Demo/.test(ssec) && !/Dan Example/.test(ssec), "Houston brother sees only the Houston guy");

  // ---- brother with no hometown ----
  let n = await load(U("nate"));
  const nsec = () => [...n.d.querySelectorAll("section")].find(x => /Guys near you over break/.test(x.textContent));
  ok(/Add your hometown or home zip code/.test(nsec().textContent), "asks for a hometown or zip");
  const af = n.d.querySelector('[data-form="aboutme"]'); ok(af && af.querySelector('[name="homeZip"]'), "About you has a home zip box");
  af.querySelector('[name="homeZip"]').value = "77494"; af.querySelector('[name="major"]').value = "Accounting"; af.querySelector('[name="year"]').value = "Sophomore"; af.querySelector('[name="church"]').value = "Sample Church";
  await fire(n.w, af, "submit"); await wait(300);
  ok(n.fake.store["team/t-nate"].homeZip === "77494" && n.fake.store["team/t-nate"].major === "Accounting", "zip saved on his own entry");
  ok(/Cole Fresh/.test(nsec().textContent) && /Houston/.test(nsec().textContent), "zip alone puts him in Houston");
  const badZ = await n.w.eval('firebase.firestore().doc("team/t-sam").update({homeZip:"00000"}).then(()=>"ok",e=>e.code)'); ok(badZ === "permission-denied", "can't change another brother's zip");
  const badR = await n.w.eval('firebase.firestore().doc("team/t-nate").update({role:"coordinator"}).then(()=>"ok",e=>e.code)'); ok(badR === "permission-denied", "still can't make himself a coordinator");

  // ---- coordinator board ----
  const J = await load(U("jonah")); J.w.location.hash = "#board"; await wait(300);
  const jt = txt(J.d);
  ok(/Lunches over break/.test(jt) && /4 guys have a brother nearby · 2 reached so far/.test(jt), "board summary: " + (jt.match(/\d+ guys? ha[sv]e? a brother nearby[^N]*/) || [""])[0]);
  ok(/No brother nearby \(1\)/.test(jt) && /No hometown or address on file \(1\)/.test(jt), "lists guys with nobody nearby and guys with no hometown");
  ok(!/Brothers who haven’t added a hometown/.test(jt), "every brother has a hometown or zip now");
  ok(!J.d.querySelector('[data-a="call-week"]'), "no Start calls button");
  ok(!/Sample St/.test(jt) && !/Oak Hollow/.test(jt), "board doesn't show street addresses");
  const L = await load({ uid: "u-luke", email: "luke@example.org", emailVerified: true }); L.w.location.hash = "#board"; await wait(300);
  ok(!/Lunches over break/.test(txt(L.d)) && !/Sample St/.test(txt(L.d)), "leadership view doesn't get the list");

  // ---- if the zip rule isn't published yet, About you still saves ----
  global.KEEP = null; global.OLD_RULES = true;
  n = await load(U("nate"));
  const af2 = n.d.querySelector('[data-form="aboutme"]');
  af2.querySelector('[name="homeZip"]').value = "77494"; af2.querySelector('[name="hometown"]').value = "Katy, TX"; af2.querySelector('[name="major"]').value = "Accounting"; af2.querySelector('[name="year"]').value = "Sophomore";
  await fire(n.w, af2, "submit"); await wait(300);
  ok(n.fake.store["team/t-nate"].hometown === "Katy, TX" && !n.fake.store["team/t-nate"].homeZip, "old rules: everything but the zip saves");
  ok(/Cole Fresh/.test([...n.d.querySelectorAll("section")].find(x => /Guys near you over break/.test(x.textContent)).textContent), "hometown alone still matches Houston");

  // ---- break mode off: nothing shows ----
  global.KEEP = null; global.OLD_RULES = false; global.EXTRA = {};
  const sd = seed(); sd["config/main"].breakMode = false; global.KEEP = sd;
  t = await load(U("aiden"));
  ok(!/Guys near you/.test(txt(t.d)), "hidden when break mode is off");

  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})();
