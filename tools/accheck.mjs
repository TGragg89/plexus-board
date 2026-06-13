// Acceptance-criteria checklist harness (OP-038 — Phase 1 §0 Rider 5). Offline,
// against the live ops files + the shipped core (extracted from index.html). Covers:
//   (1) migration losslessness — every parsed criterion list, joined by " / ",
//       byte-equals the item's original freetext AC, and every criterion seeds 🟥;
//   (2) box-click write — cycleCriterion flips ONE criterion's emoji + its updated
//       date, bumpLastUpdated bumps ONE line, the rest is byte-identical (the same
//       2-line minimal diff as a status flip), and the new state re-parses;
//   (3) the 🟥→🟨→🟩→🟥 cycle order;
//   (4) typed-note + link parsing (Proposed solution / How it's met / Links).
//
//   node tools/accheck.mjs

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
const NEW_DATE = "2026-06-30"; // must differ from either file's current Last updated so the bump is a real edit
let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };
const ok = (msg) => console.log("PASS  " + msg);

// ---- (1) migration losslessness: criteria.join(" / ") === original freetext ----
const LOSSLESS = [
  { file: "plexus_operations.md", id: "EP-001", n: 1, orig: "Phase 1 schema ratified and OP-001 unblocked." },
  { file: "plexus_operations.md", id: "BT-001", n: 3, orig: "Pages-deployed board renders live Plexus + Laser work items; status / priority / intake writes land as minimal-diff commits that survive reload; round-trip byte-compare green on both ops files; MVP declared operational against ≥2 standardized projects (flipped 2026-06-11). Split-brain exit = remaining-four ops-file migration (OP-032)." },
  { file: "plexus_operations.md", id: "OP-034", n: 3, orig: "New work items identified and captured via the board. / Live board shows all new work items and real field data. / Bugs and missing features found are logged as work items." },
  { file: "plexus_operations.md", id: "OP-035", n: 5, orig: "Claude CI cards render on the live board with real field data. / Round-trip byte-compare green on the new ops file. / EP_Register rows allocated and bumped. / Drive pointer stub + both registries updated. / Master-Template change work is captured as board work items." },
  { file: "plexus_operations.md", id: "OP-036", n: 6, orig: "Clicking any listed work item opens its sidebar. / Sidebar look matches the current drawer. / Parent + child links replace the sidebar in place; never more than one open. / Click outside the sidebar (in-app) closes it; clicking outside Plexus leaves it open. / A Status edit from a child's sidebar lands as a commit and survives reload. / Mockup approved by Tim before rollout." },
  { file: "laser_cutting_operations.md", id: "EP-004", n: 1, orig: "Instructions bumped to v1.7; reference v1.0 retired; backlog A13/B1 closed." },
];
const models = {};
const modelFor = (file) => (models[file] = models[file] || P.parse(readFileSync(join(DATA, file), "utf8")));
for (const c of LOSSLESS) {
  const list = modelFor(c.file).acDetail[c.id];
  if (!list) { fail(`${c.id}: no AC block parsed`); continue; }
  if (list.length !== c.n) { fail(`${c.id}: ${list.length} criteria, want ${c.n}`); continue; }
  const joined = list.map((x) => x.text).join(" / ");
  if (joined !== c.orig) { fail(`${c.id}: lossy migration\n   got: ${JSON.stringify(joined)}\n   exp: ${JSON.stringify(c.orig)}`); continue; }
  if (!list.every((x) => x.state === "red")) { fail(`${c.id}: not all seeded 🟥`); continue; }
  ok(`${c.id}: ${c.n} criteria, all 🟥, join(" / ") === original freetext (lossless)`);
}

// ---- (2) box-click write: cycle one criterion, exactly 2 lines change, re-parse ----
{
  const orig = readFileSync(join(DATA, "plexus_operations.md"), "utf8");
  const model = P.parse(orig);
  const res = P.cycleCriterion(model, "BT-001", 1, NEW_DATE);
  if (!res || res.from !== "red" || res.to !== "yellow") { fail(`cycleCriterion BT-001/AC-1 = ${JSON.stringify(res)}`); }
  else {
    P.bumpLastUpdated(model, NEW_DATE);
    const a = orig.split("\n"), b = P.serialize(model).split("\n");
    const changed = a.length === b.length ? a.reduce((acc, _, i) => (a[i] !== b[i] ? acc.concat(i) : acc), []) : null;
    if (!changed) fail(`AC write changed the line count`);
    else if (changed.length !== 2) { fail(`AC write changed ${changed.length} lines (want 2)`); changed.forEach((i) => console.log(`     L${i + 1}: ${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`)); }
    else if (!changed.some((i) => b[i].includes("AC-1") && b[i].includes("🟨") && b[i].includes(NEW_DATE))) fail(`AC write: bullet line missing 🟨/${NEW_DATE}`);
    else if (!changed.some((i) => /Last updated/.test(b[i]) && b[i].includes(NEW_DATE))) fail(`AC write: Last updated not bumped`);
    else {
      const rec = P.parse(b.join("\n")).acDetail["BT-001"][0];
      if (rec.state !== "yellow" || rec.updated !== NEW_DATE) fail(`AC write re-parse: state=${rec.state} updated=${rec.updated}`);
      else ok(`box-click BT-001/AC-1 🟥→🟨: exactly 2 lines changed (bullet + Last updated), re-parses yellow @ ${NEW_DATE}`);
    }
  }
}

// ---- (3) cycle order 🟥→🟨→🟩→🟥 ----
{
  const seq = ["red", "yellow", "green", "red"];
  let cur = "red", good = true;
  for (let i = 1; i < seq.length; i++) { cur = P.AC_NEXT[cur]; if (cur !== seq[i]) good = false; }
  good ? ok("AC_NEXT cycles 🟥→🟨→🟩→🟥") : fail("AC_NEXT cycle order wrong");
}

// ---- (4) typed-note + link parsing (synthetic block) ----
{
  const syn = [
    "## 3. x", "", "### Acceptance criteria detail", "", "#### OP-999",
    "- 🟩 AC-1 Done thing _(updated 2026-06-12)_",
    "  - How it's met: shipped in commit abc.",
    "  - Links: [Live Board](https://example.com), [root](file:///C:/x/y)",
    "- 🟨 AC-2 In-flight thing _(updated 2026-06-12)_",
    "  - Proposed solution: do the thing.", "", "---", ""
  ].join("\n");
  const L = P.parse(syn).acDetail["OP-999"];
  if (!L || L.length !== 2) fail(`note parse: got ${L && L.length} criteria`);
  else if (L[0].state !== "green" || !/shipped in commit/.test(L[0].met) || !/Live Board/.test(L[0].links)) fail(`note parse: AC-1 met/links wrong: ${JSON.stringify(L[0])}`);
  else if (L[1].state !== "yellow" || !/do the thing/.test(L[1].proposed)) fail(`note parse: AC-2 proposed wrong: ${JSON.stringify(L[1])}`);
  else ok("typed notes parse: How it's met + Links (done) and Proposed solution (in-progress) extracted");
}

console.log(failed ? `\n${failed} AC case(s) FAILED` : `\nAll AC-checklist cases passed (lossless migration + minimal-diff box-click + cycle + note parsing)`);
process.exit(failed ? 1 : 0);
