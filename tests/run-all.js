// Runs every test file one at a time and prints a summary. Usage: npm test
const { spawnSync } = require("child_process");
const fs = require("fs"); const path = require("path");
const files = fs.readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f)).sort();
let failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", timeout: 300000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0 && /ALL PASSED/.test(out);
  console.log((ok ? "PASS " : "FAIL ") + f);
  if (!ok) { failed.push(f); console.log(out.split("\n").filter(l => /FAIL|Error/.test(l)).slice(0, 10).map(l => "    " + l).join("\n")); }
}
console.log(failed.length ? `\n${failed.length} test file(s) failed` : "\nAll test files passed");
process.exit(failed.length ? 1 : 0);
