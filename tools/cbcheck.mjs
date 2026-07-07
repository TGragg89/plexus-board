// CB-register coupling harness (OP-081 / EP-034). Offline, against the live repo
// mirror ops/cb_register.md + the shipped core (parseCbRegister extracted from
// index.html — one source of truth, no drift). Covers:
//   (1) parse — every CB-NNN row parses; CB-006 + CB-007 (OP-080 AC-2) are present;
//   (2) coupling — the EP->CB map derived from the Execution column contains the live
//       couplings CB-005->EP-010, CB-006->EP-026, CB-007->EP-030 (OP-081 AC-1 source);
//   (3) no dangling pointer — every Execution EP-NNN exists as an allocated row in
//       ops/EP_Register.md (a mirror row can't couple to a non-existent Epic);
//   (4) next-free — the mirror's "Next free number" parses to a CB-NNN.
//
//   node tools/cbcheck.mjs

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
if (!P || !P.parseCbRegister) { console.error("FAIL: core did not export parseCbRegister"); process.exit(1); }

const DATA = join(root, "..", "plexus-bucket-d", "ops");
let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };
const ok = (msg) => console.log("PASS  " + msg);

const cbText = readFileSync(join(DATA, "cb_register.md"), "utf8");
const epText = readFileSync(join(DATA, "EP_Register.md"), "utf8");
const cb = P.parseCbRegister(cbText);

// ---- (1) parse + required rows present ----
if (cb.rows.length >= 7) ok(`parsed ${cb.rows.length} CB rows`);
else fail(`expected >=7 CB rows, parsed ${cb.rows.length}`);
for (const id of ["CB-006", "CB-007"]) {
  const row = cb.rows.find((r) => r.id === id);
  if (row && row.exec) ok(`${id} present with Execution ${row.exec}`);
  else fail(`${id} missing or has no Execution pointer (OP-080 AC-2)`);
}

// ---- (2) coupling map — live couplings the engine cascades ----
const EXPECT = { "EP-010": "CB-005", "EP-026": "CB-006", "EP-030": "CB-007" };
for (const [ep, cbid] of Object.entries(EXPECT)) {
  if (cb.cbByEpic[ep] === cbid) ok(`coupling ${ep} -> ${cbid}`);
  else fail(`coupling ${ep} -> ${cbid} expected, got ${cb.cbByEpic[ep] || "(none)"}`);
}

// ---- (3) no dangling execution pointer — each EP-NNN exists in EP_Register ----
const allocatedEps = new Set();
epText.split("\n").forEach((ln) => { const mm = ln.match(/^\|\s*(EP-\d{3})\s*\|/); if (mm) allocatedEps.add(mm[1]); });
for (const [ep, cbid] of Object.entries(cb.cbByEpic)) {
  if (allocatedEps.has(ep)) ok(`${cbid} execution ${ep} is an allocated Epic`);
  else fail(`${cbid} execution ${ep} is NOT in EP_Register (dangling pointer)`);
}

// ---- (4) next-free parses ----
if (/^CB-\d{3}$/.test(cb.nextFree || "")) ok(`next free parses: ${cb.nextFree}`);
else fail(`next free did not parse (got "${cb.nextFree}")`);

console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll CB-register checks passed`);
process.exit(failed ? 1 : 0);
