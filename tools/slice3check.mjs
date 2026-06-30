// Slice 3 fidelity harness — exercises the new write paths added in slice 3,
// all offline against the live ops files (the GitHub PUT itself needs a browser
// + PAT and is verified on the deploy). Covers:
//   (1) rider-2 status flips: Ready + In Review land as native tokens, minimal
//       2-line diff (row + Last updated), and re-parse to the canonical column;
//   (2) Write Pattern 3 intake: insertTopLevelRow appends ONE new top-level row,
//       bumpLastUpdated changes ONE line, the rest is byte-identical, and the new
//       row re-parses with the expected id/type/status.
//
//   node tools/slice3check.mjs
//
// The core is extracted from index.html (single source of truth).

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
const NEW_DATE = "2026-07-01"; // sentinel: must differ from BOTH files' current
                               // "Last updated" so bumpLastUpdated is a real edit
                               // (the pilot files reach 2026-06-13 this session; keep this ahead).
let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };

// ---- (1) rider-2 status flips (Ready / In Review), both vocabularies ----
const FLIPS = [
  { file: "plexus_operations.md",        id: "EP-001", token: "`ready`",    expect: "Ready"     },
  { file: "plexus_operations.md",        id: "EP-002", token: "`inreview`", expect: "In Review" },
  { file: "laser_cutting_operations.md", id: "EP-004", token: "🟡",          expect: "Ready"     },
  { file: "laser_cutting_operations.md", id: "EP-005", token: "👀",          expect: "In Review" },
];
for (const c of FLIPS) {
  const orig = readFileSync(join(DATA, c.file), "utf8");
  const model = P.parse(orig);
  if (!P.setStatus(model, c.id, c.token)) { fail(`${c.file}: setStatus(${c.id}) false`); continue; }
  if (!P.bumpLastUpdated(model, NEW_DATE)) { fail(`${c.file}: bumpLastUpdated false`); continue; }
  const out = P.serialize(model);
  const a = orig.split("\n"), b = out.split("\n");
  if (a.length !== b.length) { fail(`${c.file} ${c.id}: line count changed`); continue; }
  const changed = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);
  if (changed.length !== 2) { fail(`${c.file} ${c.id}: ${changed.length} lines changed (want 2)`); continue; }
  const rowOk = changed.some(i => b[i].includes(c.id) && b[i].includes(c.token));
  const luOk = changed.some(i => /Last updated/.test(b[i]) && b[i].includes(NEW_DATE));
  if (!rowOk) { fail(`${c.file} ${c.id}: changed row missing token ${c.token}`); continue; }
  if (!luOk) { fail(`${c.file} ${c.id}: Last updated not bumped`); continue; }
  const rec2 = P.findRecord(P.parse(out), c.id);
  if (!rec2 || rec2.status !== c.expect) { fail(`${c.file} ${c.id}: re-parse status = ${rec2 && rec2.status}, want ${c.expect}`); continue; }
  console.log(`PASS  ${c.file}  flip ${c.id} -> ${c.expect}  (token ${c.token}, exactly 2 lines changed)`);
}

// ---- (2) Write Pattern 3 intake (insert one top-level row) ----
const INTAKE = [
  { file: "plexus_operations.md",        id: "EP-007", type: "Epic", token: "`pending`", expect: "Backlog" },
  { file: "laser_cutting_operations.md", id: "ML-003", type: "Maintenance Loop", token: "🔲", expect: "Backlog" },
];
for (const c of INTAKE) {
  const orig = readFileSync(join(DATA, c.file), "utf8");
  const model = P.parse(orig);
  const before = model.topLevel.length;
  const newRow = `| ${c.id} | ${c.type} | Test intake ${c.id} | ${c.token} | P2 | — |  |  | [root](file:///C:/x) |`;
  if (!P.insertTopLevelRow(model, newRow)) { fail(`${c.file}: insertTopLevelRow false`); continue; }
  if (!P.bumpLastUpdated(model, NEW_DATE)) { fail(`${c.file}: bumpLastUpdated false`); continue; }
  const out = P.serialize(model);
  const a = orig.split("\n"), b = out.split("\n");
  if (b.length !== a.length + 1) { fail(`${c.file}: expected +1 line, got ${b.length - a.length}`); continue; }
  // Remove the (unique) inserted row; the remainder must equal orig except the
  // single Last-updated line (date-only change).
  const rowHits = b.filter(l => l === newRow);
  if (rowHits.length !== 1) { fail(`${c.file}: inserted row appears ${rowHits.length}x`); continue; }
  const remainder = b.filter(l => l !== newRow);
  if (remainder.length !== a.length) { fail(`${c.file}: remainder length ${remainder.length} != ${a.length}`); continue; }
  const diffs = []; for (let i = 0; i < a.length; i++) if (a[i] !== remainder[i]) diffs.push(i);
  if (diffs.length !== 1 || !/Last updated/.test(remainder[diffs[0]])) {
    fail(`${c.file}: non-row diffs = ${diffs.length} (want 1 Last-updated line)`); continue;
  }
  const reparsed = P.parse(out);
  const rec = P.findRecord(reparsed, c.id);
  if (!rec || rec.status !== c.expect || rec.kind !== c.id.slice(0, 2)) { fail(`${c.file}: ${c.id} did not re-parse cleanly`); continue; }
  if (reparsed.topLevel.length !== before + 1) { fail(`${c.file}: top-level count ${reparsed.topLevel.length} != ${before + 1}`); continue; }
  console.log(`PASS  ${c.file}  intake ${c.id} (${c.type}): +1 top-level row, only the row + Last updated changed, re-parses as ${c.expect}`);
}

console.log(failed ? `\n${failed} slice-3 case(s) FAILED` : `\nAll slice-3 cases passed (rider-2 flips + Write Pattern 3 intake, minimal diff verified)`);
process.exit(failed ? 1 : 0);
