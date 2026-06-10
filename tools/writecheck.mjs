// Write Pattern 1 fidelity harness (Path B design contract §3.4 + slice-2
// acceptance check 2: "git diff of that commit shows ONLY the flipped row +
// the Last updated line").
//
//   node tools/writecheck.mjs
//
// For each pilot ops file: parse -> flip one row's status to a different native
// token + bump the "Last updated" date -> serialize -> diff line-by-line vs the
// original and assert EXACTLY two lines changed (the flipped row + Last updated),
// every other byte identical, and that re-parsing maps the row to the target
// column. The core is extracted from index.html (single source of truth).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const m = html.match(/<script id="plexus-core">([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: no plexus-core block in index.html"); process.exit(1); }
const sandbox = { module: { exports: {} }, globalThis: {} };
new Function("module", "globalThis", m[1])(sandbox.module, sandbox.globalThis);
const P = sandbox.module.exports.parse ? sandbox.module.exports : sandbox.globalThis.Plexus;

const DATA = join(root, "..", "plexus-bucket-d", "ops");
const NEW_DATE = "2026-06-11"; // deliberately != the files' current 2026-06-10

// { file, id, token (styled native), expectCol }
const CASES = [
  { file: "plexus_operations.md", id: "EP-001", token: "`complete`", expectCol: "Done" },
  { file: "laser_cutting_operations.md", id: "EP-004", token: "✅", expectCol: "Done" },
];

let failed = 0;
function fail(msg) { failed++; console.log("FAIL  " + msg); }

for (const c of CASES) {
  const path = join(DATA, c.file);
  const orig = readFileSync(path, "utf8");
  const model = P.parse(orig);

  const rec = P.findRecord(model, c.id);
  if (!rec) { fail(`${c.file}: record ${c.id} not found`); continue; }

  if (!P.setStatus(model, c.id, c.token)) { fail(`${c.file}: setStatus(${c.id}) returned false`); continue; }
  if (!P.bumpLastUpdated(model, NEW_DATE)) { fail(`${c.file}: bumpLastUpdated returned false`); continue; }
  const out = P.serialize(model);

  // Same line count (no structural change), and exactly two changed lines.
  const a = orig.split("\n"), b = out.split("\n");
  if (a.length !== b.length) { fail(`${c.file}: line count changed ${a.length} -> ${b.length}`); continue; }
  const changed = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);

  if (changed.length !== 2) {
    fail(`${c.file}: expected 2 changed lines, got ${changed.length}: lines ${changed.map(i => i + 1).join(", ")}`);
    changed.forEach(i => console.log(`        L${i + 1}: ${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`));
    continue;
  }
  const rowLine = b.find((_, i) => changed.includes(i) && b[i].includes(c.id));
  const luLine = b.find((_, i) => changed.includes(i) && /Last updated/.test(b[i]));
  if (!rowLine) { fail(`${c.file}: the ${c.id} row was not among the changed lines`); continue; }
  if (!luLine) { fail(`${c.file}: the Last updated line was not among the changed lines`); continue; }
  if (!rowLine.includes(c.token.replace(/`/g, "`"))) { fail(`${c.file}: flipped row missing token ${c.token}`); continue; }
  if (!luLine.includes(NEW_DATE)) { fail(`${c.file}: Last updated not bumped to ${NEW_DATE}`); continue; }

  // Re-parse the written text and confirm the canonical column landed.
  const rec2 = P.findRecord(P.parse(out), c.id);
  if (!rec2 || rec2.status !== c.expectCol) { fail(`${c.file}: re-parse of ${c.id} = ${rec2 && rec2.status}, expected ${c.expectCol}`); continue; }

  console.log(`PASS  ${c.file}  ${c.id}: ${rec.status} -> ${c.expectCol}  (exactly 2 lines changed: the row + Last updated)`);
}

console.log(failed ? `\n${failed} case(s) FAILED` : `\nAll ${CASES.length} write-pattern cases passed (minimal diff verified)`);
process.exit(failed ? 1 : 0);
