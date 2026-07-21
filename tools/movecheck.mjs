// Touch-move target harness — OP-087 (EP-031 "Mobile-friendly Plexus").
// Offline, against the REAL shipped statusTargets() + the REAL VOCABS table
// (both extracted verbatim from index.html — one source of truth, no drift).
//
// OP-087 adds a per-card status pill that opens a bottom-sheet of target statuses on
// mobile. The sheet must offer EXACTLY what the desktop drawer's <select> offers —
// same statuses, same order, same "can't write this one" gate — or the two surfaces
// drift and a phone can propose a move the engine will refuse. Both are now built
// from statusTargets(), and this harness drives that exact function:
//
//   (a) a full vocabulary offers every status, all writable, current flagged once;
//   (b) 3d_printing's calibration vocabulary (§A.3.2 — 🟡 means In Progress there, so
//       there is NO Ready and NO In Review token) still LISTS Ready / In Review but
//       marks them writable:false, so the sheet disables them exactly as the desktop
//       <option disabled> does — the engine must never write a status it has no token
//       for;
//   (c) an off-axis current status (Blocked / Cancelled on a word-vocab file) is shown
//       for orientation and is never duplicated;
//   (d) a current status outside the vocabulary order is prepended, not dropped;
//   (e) anti-drift: statusSelectEl() (desktop) and mMoveOpen() (mobile sheet) both
//       build from statusTargets() — asserted against the shipped source, so a future
//       edit that forks either surface fails here.
//
//   node tools/movecheck.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// ---- pull the REAL statusTargets + VOCABS out of the app <script> (no drift) ----
const appM = html.match(/<script>\s*\n\(function \(\) \{([\s\S]*)\}\)\(\);\s*<\/script>/);
if (!appM) { console.error("FAIL: could not locate the app script block in index.html"); process.exit(1); }
const app = appM[1];

// brace-match from a declaration's first "{" to its close — same technique conflictcheck uses
function extractBlock(src, startNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error(`could not find \`${startNeedle}\` in index.html`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces reading \`${startNeedle}\``);
}

let statusTargets, VOCABS;
try {
  statusTargets = new Function(extractBlock(app, "function statusTargets(") + "\nreturn statusTargets;")();
  VOCABS = new Function(extractBlock(app, "var VOCABS = ") + "\nreturn VOCABS;")();
} catch (e) {
  console.error("FAIL: extracting statusTargets/VOCABS — " + e.message);
  process.exit(1);
}

let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };
const ok = (msg) => console.log("PASS  " + msg);
const eq = (a, b, msg) => (JSON.stringify(a) === JSON.stringify(b) ? ok(msg) : fail(`${msg}\n        expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`));

// ---- (a) a full vocabulary: every status offered and writable ----
for (const name of ["word", "emoji"]) {
  const voc = VOCABS[name];
  const t = statusTargets(voc, "Backlog");
  eq(t.map((x) => x.col), voc.order, `(a) ${name}: targets are the vocabulary order, verbatim`);
  eq(t.filter((x) => !x.writable).length, 0, `(a) ${name}: every status has a token, so all are writable`);
  eq(t.filter((x) => x.current).map((x) => x.col), ["Backlog"], `(a) ${name}: exactly one row flagged current`);
}

// ---- (b) the calibration vocabulary: Ready / In Review listed but NOT writable ----
{
  const voc = VOCABS.emoji3d;
  const t = statusTargets(voc, "Backlog");
  eq(t.map((x) => x.col), voc.order, "(b) emoji3d: still lists all seven statuses (parity with the desktop <select>)");
  eq(t.filter((x) => !x.writable).map((x) => x.col), ["Ready", "In Review"],
    "(b) emoji3d: Ready + In Review are the only non-writable rows (no token — §A.3.2)");
  // the gate must be token presence, not order membership
  for (const x of t) {
    if (x.writable !== !!voc.token[x.col]) fail(`(b) emoji3d: ${x.col} writable=${x.writable} disagrees with token presence`);
  }
  ok("(b) emoji3d: writable tracks token presence for every status");
}

// ---- (c) an off-axis current status is shown once, never duplicated ----
for (const cur of ["Blocked", "Cancelled"]) {
  const t = statusTargets(VOCABS.word, cur);
  eq(t.map((x) => x.col), VOCABS.word.order, `(c) word/current=${cur}: no duplicate row for the current status`);
  eq(t.filter((x) => x.current).map((x) => x.col), [cur], `(c) word/current=${cur}: that row is the one flagged current`);
}

// ---- (d) a current status OUTSIDE the vocabulary order is prepended, not dropped ----
{
  const t = statusTargets(VOCABS.word, "Archived");
  eq(t[0], { col: "Archived", current: true, writable: false },
    "(d) an unknown current status is prepended, flagged current, and not writable");
  eq(t.length, VOCABS.word.order.length + 1, "(d) it is added, not substituted");
}

// ---- (e) anti-drift: both surfaces build from statusTargets() ----
{
  const sel = extractBlock(app, "function statusSelectEl(");
  const sheet = extractBlock(app, "function mMoveOpen(");
  if (/statusTargets\(/.test(sel)) ok("(e) statusSelectEl (desktop <select>) builds from statusTargets()");
  else fail("(e) statusSelectEl no longer calls statusTargets() — the desktop dropdown has forked");
  if (/statusTargets\(/.test(sheet)) ok("(e) mMoveOpen (mobile move sheet) builds from statusTargets()");
  else fail("(e) mMoveOpen no longer calls statusTargets() — the mobile sheet has forked");
  // the sheet must hand the pick to the SHARED write entry point, never its own writer
  if (/applyChange\(m\.path, m\.id, "status", target, null\)/.test(extractBlock(app, "function mMovePick(")))
    ok("(e) mMovePick routes to applyChange() — the same confirm + OP-079 write path as the desktop control");
  else fail("(e) mMovePick no longer calls applyChange(path, id, \"status\", target, null) — the mobile write path has forked");
}

// ---- guard: no second breakpoint (EP-031 declares exactly one) ----
{
  const bps = [...html.matchAll(/@media \(max-width: *(\d+)px\)/g)].map((m) => m[1]);
  eq([...new Set(bps)], ["760"], "(f) EP-031 still declares exactly one breakpoint value (760px)");
}

console.log("");
if (failed) { console.log(`${failed} movecheck case(s) FAILED.`); process.exit(1); }
console.log("All movecheck cases passed (shared target derivation + no forked write path).");
