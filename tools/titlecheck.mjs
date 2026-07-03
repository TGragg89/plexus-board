// OP-032 title-fallback regression harness.
//
//   node tools/titlecheck.mjs
//
// The four remaining-four migrated legacy ops files keep each work item's title
// in an unmapped column (Item / Action) and carry no Title column, so before the
// OP-032 fix parse() rendered their board cards with a blank title. parse() now
// uses a name-priority fallback (Title -> Item -> Action -> Task -> Decision ->
// Name -> Summary) for the card title. This harness asserts every work-item card
// in those four files now parses with a non-empty title, and re-asserts the three
// already-good ops files still parse every card with a non-empty title (no
// regression from the generalized fallback).
//
// Scope note: "work-item card" = a real kanban card = a model.topLevel / model.ops
// record whose ID anchors the START of its row's first cell (e.g. `| OP-001 | ... |`).
// The parser also picks up phantom IDs from narrative prose tables whose first cell
// merely *mentions* an ID mid-text (e.g. a "Drift" row reading "...post-OP-002..." or
// "...§4 PD-007..PD-014..."); those are not real work items, carry no title column in
// the OP-032 fallback list (their columns are Mechanism / Mitigation), were blank
// before this fix, and no column-mapping fallback could fill them. They are a separate
// pre-existing parser quirk (false-positive ID detection), out of scope for OP-032 —
// excluded here and reported, not asserted on. The §8 Resolved register (R-NNN,
// "One-line resolution" column) is likewise not a board card and out of scope.
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
if (!P || !P.parse) { console.error("FAIL: core did not export parse"); process.exit(1); }

const DATA = join(root, "..", "plexus-bucket-d", "ops");

// The four remaining-four migrated files (OP-032) — every card MUST now have a title.
const MIGRATED = [
  "lapdesk_operations.md",
  "3d_printing_operations.md",
  "home_network_operations.md",
  "understory_operations.md",
];
// The already-good ops files — regression guard: still no blank card titles.
const NATIVE = [
  "plexus_operations.md",
  "laser_cutting_operations.md",
  "claude_ci_operations.md",
  "home_improvement_operations.md", // OP-074 onboarding — §A.6.1 native file, every card titled
  "finances_operations.md",         // OP-076 onboarding — §A.6.1 native file, every card titled
];

let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };

// A real work-item card has its ID anchored at the start of its row's first cell.
// Phantom rows merely mention an ID mid-prose, so the first cell does not start with it.
const isRealCard = (rec, lines) => {
  const raw = lines[rec.line];
  if (!raw) return false;
  const firstCell = raw.replace(/^\s*\|/, "").split("|")[0].trim();
  return firstCell.indexOf(rec.id) === 0;
};

const check = (f, { regression }) => {
  const text = readFileSync(join(DATA, f), "utf8");
  const lines = text.split("\n");
  const model = P.parse(text);
  const all = [...model.topLevel, ...model.ops];
  const cards = all.filter((r) => isRealCard(r, lines));
  const phantoms = all.length - cards.length;
  const blank = cards.filter((r) => !r.title || !r.title.trim());
  const tag = regression ? "REGRESSION — " : "";
  const phNote = phantoms ? `  (${phantoms} non-card phantom ID${phantoms === 1 ? "" : "s"} excluded)` : "";
  if (!regression && cards.length === 0) { fail(`${f}: parsed 0 work-item cards (expected the migrated items)`); return; }
  if (blank.length) { fail(`${f}: ${tag}${blank.length}/${cards.length} card(s) have a blank title [${blank.map((r) => r.id).join(", ")}]`); return; }
  console.log(`PASS  ${f}  all ${cards.length} work-item card(s) have a non-empty title${regression ? " (no regression)" : ""}${phNote}`);
};

for (const f of MIGRATED) check(f, { regression: false });
for (const f of NATIVE) check(f, { regression: true });

console.log(failed ? `\n${failed} title-fallback case(s) FAILED` : `\nAll title-fallback cases passed (four migrated files + four native files: every board card has a non-empty title)`);
process.exit(failed ? 1 : 0);
