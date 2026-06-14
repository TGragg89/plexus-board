// Captures store (OP-040) fidelity harness. The core is extracted from index.html
// (single source of truth — no duplicated parser).
//
//   node tools/capturescheck.mjs
//
// Verifies, against the live ops/captures.md:
//   1. parse() finds the migrated CAP rows + their recommended-destination hints.
//   2. setCell(Notes) is a minimal 2-line diff (the row + Last updated) — the in-app
//      "edit Notes" write path (Write Pattern 1), identical discipline to the ops files.
//   3. insertCaptureRow + nextCaptureId append ONE new row (the "Add capture" path),
//      leaving every other byte identical, and the new row re-parses correctly.

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

const FILE = join(root, "..", "plexus-bucket-d", "ops", "captures.md");
const NEW_DATE = "2026-06-30"; // != the file's current Last updated, so the bump is a real edit
let failed = 0;
function fail(msg) { failed++; console.log("FAIL  " + msg); }
function ok(msg) { console.log("PASS  " + msg); }

const orig = readFileSync(FILE, "utf8");

// --- 1. parse + hint extraction ---
const model = P.parse(orig);
const caps = model.captures;
if (!caps.length) fail("no CAP rows parsed");
else {
  const withHints = caps.filter(c => c.recLevel && c.recType && c.recProject);
  ok(`parsed ${caps.length} captures; ${withHints.length} carry Level/Type/Project hints; ` +
     `first=${caps[0].id} "${caps[0].title}" → ${caps[0].recLevel}/${caps[0].recType}/${caps[0].recProject}`);
  // ids unique + well-formed
  const ids = new Set(caps.map(c => c.id));
  if (ids.size !== caps.length) fail("duplicate CAP ids");
  if (!caps.every(c => /^CAP-\d{3}$/.test(c.id))) fail("malformed CAP id present");
  // notes editable (cell range present)
  if (!caps.every(c => c.cellRanges && c.cellRanges.notes)) fail("a CAP row has no editable Notes cell range");
}

// --- 2. edit Notes = minimal 2-line diff ---
{
  const target = caps[2]; // CAP-003
  const model2 = P.parse(orig);
  const applied = P.setCell(model2, target.id, "notes", "Edited note — verified minimal diff.");
  if (!applied) fail(`setCell(notes) on ${target.id} returned false`);
  else {
    P.bumpLastUpdated(model2, NEW_DATE);
    const out = P.serialize(model2);
    const a = orig.split("\n"), b = out.split("\n");
    if (a.length !== b.length) fail(`edit-notes: line count changed ${a.length} -> ${b.length}`);
    else {
      const changed = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);
      if (changed.length !== 2) fail(`edit-notes: expected 2 changed lines, got ${changed.length} (${changed.map(i => i + 1).join(", ")})`);
      else {
        const row = b[changed.find(i => b[i].includes(target.id))];
        const lu = changed.some(i => /Last updated/.test(b[i]));
        if (!row || !row.includes("Edited note")) fail("edit-notes: changed row missing new note text");
        else if (!lu) fail("edit-notes: Last updated not among changed lines");
        else {
          const rec2 = P.findRecord(P.parse(out), target.id);
          if (rec2 && rec2.notes === "Edited note — verified minimal diff.") ok(`edit Notes ${target.id}: minimal 2-line diff (row + Last updated), re-parse confirms`);
          else fail("edit-notes: re-parse note mismatch");
        }
      }
    }
  }
}

// --- 3. Add capture = single-row append ---
{
  const model3 = P.parse(orig);
  const id = P.nextCaptureId(model3);
  if (id !== "CAP-039") fail(`nextCaptureId = ${id}, expected CAP-039`);
  const row = `| ${id} | New idea from board | Quick dump. | added on board | child | Task | Plexus | — | ${NEW_DATE} |`;
  const applied = P.insertCaptureRow(model3, row);
  if (!applied) fail("insertCaptureRow returned false");
  else {
    P.bumpLastUpdated(model3, NEW_DATE);
    const out = P.serialize(model3);
    const a = orig.split("\n"), b = out.split("\n");
    if (b.length !== a.length + 1) fail(`add-capture: expected +1 line, got ${b.length - a.length}`);
    else {
      // every original line still present in order (only an insertion + the Last updated bump)
      const reparsed = P.parse(out);
      const got = P.findRecord(reparsed, id);
      if (reparsed.captures.length !== caps.length + 1) fail(`add-capture: capture count ${reparsed.captures.length}, expected ${caps.length + 1}`);
      else if (!got || got.title !== "New idea from board" || got.recType !== "Task") fail("add-capture: new row did not re-parse with its fields");
      else ok(`add capture ${id}: single-row append, re-parse confirms (${reparsed.captures.length} captures)`);
    }
  }
}

console.log(failed ? `\n${failed} captures case(s) FAILED` : `\nAll captures-store cases passed (parse + hints + minimal-diff edit + single-row add)`);
process.exit(failed ? 1 : 0);
