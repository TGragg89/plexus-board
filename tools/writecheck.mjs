// Write Pattern 1 fidelity harness (Path B design contract §3.4 + slice-2
// acceptance check 2: "git diff of that commit shows ONLY the changed row +
// the Last updated line"). Covers BOTH write types: status-flip (slice 2) and
// priority-change (MVP punch-list 2).
//
//   node tools/writecheck.mjs
//
// For each case: parse -> change one row's status OR priority to a different
// native token + bump the "Last updated" date -> serialize -> diff line-by-line
// vs the original and assert EXACTLY two lines changed (the changed row + Last
// updated), every other byte identical, and that re-parsing maps the row to the
// target value. The core is extracted from index.html (single source of truth).

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
// Must differ from BOTH pilot files' current "Last updated" so every bump is a real
// edit (else the date line doesn't change and the 2-line invariant can't hold). Picked
// distinct from any plausible session date — keep != the files' header dates on touch.
const NEW_DATE = "2026-06-30";

// kind "status"/"priority" use the styled-token write primitives; kind "cell"
// (OP-039) uses the generic setCell on a plain-text field (title/description/notes/
// cycle). EVERY kind must land as the SAME minimal 2-line diff: the edited row + the
// Last updated line. The cases exercise top-level §3 rows AND child sub-table rows
// (the W-21 / OP-039 child-row capability), in both vocab files.
const CASES = [
  { kind: "status",   file: "plexus_operations.md",        id: "EP-001", token: "`complete`", expect: "Done" },
  { kind: "status",   file: "laser_cutting_operations.md", id: "EP-004", token: "✅",          expect: "Done" },
  { kind: "priority", file: "plexus_operations.md",        id: "EP-001", token: "P1",          expect: "P1"   },
  { kind: "priority", file: "laser_cutting_operations.md", id: "EP-004", token: "P0",          expect: "P0"   },
  { kind: "status",   file: "plexus_operations.md",        id: "OP-036", token: "`ready`",     expect: "Ready" },
  { kind: "priority", file: "plexus_operations.md",        id: "OP-036", token: "P2",          expect: "P2"   },
  // OP-039 editable-cell cases —
  { kind: "cell", file: "plexus_operations.md",        id: "EP-002", field: "description", value: "Rules and docs refresh bundle." }, // top-level §3, empty -> populated
  { kind: "cell", file: "plexus_operations.md",        id: "EP-001", field: "cycle",       value: "Q3 2026" },                        // top-level §3, was "—"
  { kind: "cell", file: "plexus_operations.md",        id: "OP-024", field: "title",       value: "Placeholder policy — file-backed only" }, // child sub-table
  { kind: "cell", file: "plexus_operations.md",        id: "OP-024", field: "description", value: "Render only file-backed data in the drawer." }, // child sub-table, empty -> populated
  { kind: "cell", file: "plexus_operations.md",        id: "OP-023", field: "notes",       value: "Per-project ID scoping (Rider 3)." }, // child sub-table, replace
  { kind: "cell", file: "laser_cutting_operations.md", id: "EP-004", field: "title",       value: "Laser editable-title check" },      // other vocab file
];

let failed = 0;
function fail(msg) { failed++; console.log("FAIL  " + msg); }

for (const c of CASES) {
  const path = join(DATA, c.file);
  const orig = readFileSync(path, "utf8");
  const model = P.parse(orig);

  const rec = P.findRecord(model, c.id);
  if (!rec) { fail(`${c.file}: record ${c.id} not found`); continue; }
  const expect = c.kind === "cell" ? P.sanitizeCell(c.value) : c.expect;
  const before = c.kind === "priority" ? rec.priority : c.kind === "cell" ? JSON.stringify(rec[c.field] || "") : rec.status;

  const applied = c.kind === "priority" ? P.setPriority(model, c.id, c.token)
    : c.kind === "cell" ? P.setCell(model, c.id, c.field, c.value)
    : P.setStatus(model, c.id, c.token);
  const setName = c.kind === "priority" ? "setPriority" : c.kind === "cell" ? "setCell" : "setStatus";
  if (!applied) { fail(`${c.file}: ${setName}(${c.id}${c.kind === "cell" ? ", " + c.field : ""}) returned false`); continue; }
  if (!P.bumpLastUpdated(model, NEW_DATE)) { fail(`${c.file}: bumpLastUpdated returned false`); continue; }
  const out = P.serialize(model);

  // Same line count (no structural change), and exactly two changed lines.
  const a = orig.split("\n"), b = out.split("\n");
  if (a.length !== b.length) { fail(`${c.file}: line count changed ${a.length} -> ${b.length}`); continue; }
  const changed = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);

  const label = c.kind === "cell" ? c.kind + " " + c.field : c.kind;
  if (changed.length !== 2) {
    fail(`${c.file} ${label} ${c.id}: expected 2 changed lines, got ${changed.length}: lines ${changed.map(i => i + 1).join(", ")}`);
    changed.forEach(i => console.log(`        L${i + 1}: ${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`));
    continue;
  }
  const rowLine = b.find((_, i) => changed.includes(i) && b[i].includes(c.id));
  const luLine = b.find((_, i) => changed.includes(i) && /Last updated/.test(b[i]));
  if (!rowLine) { fail(`${c.file}: the ${c.id} row was not among the changed lines`); continue; }
  if (!luLine) { fail(`${c.file}: the Last updated line was not among the changed lines`); continue; }
  const needle = c.kind === "cell" ? expect : c.token;
  if (!rowLine.includes(needle)) { fail(`${c.file}: changed row missing ${JSON.stringify(needle)}`); continue; }
  if (!luLine.includes(NEW_DATE)) { fail(`${c.file}: Last updated not bumped to ${NEW_DATE}`); continue; }

  // Re-parse the written text and confirm the target value landed.
  const rec2 = P.findRecord(P.parse(out), c.id);
  const got = rec2 && (c.kind === "priority" ? rec2.priority : c.kind === "cell" ? rec2[c.field] : rec2.status);
  if (got !== expect) { fail(`${c.file}: re-parse of ${c.id} ${label} = ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`); continue; }

  console.log(`PASS  ${c.file}  ${label} ${c.id}: ${before} -> ${JSON.stringify(expect)}  (exactly 2 lines changed: the row + Last updated)`);
}

console.log(failed ? `\n${failed} case(s) FAILED` : `\nAll ${CASES.length} write-pattern cases passed (minimal diff verified)`);
process.exit(failed ? 1 : 0);
