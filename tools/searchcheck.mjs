// Global-search harness (OP-041 / EP-012). Offline, against the live repo ops data +
// the shipped engine functions (extracted verbatim from index.html — one source of
// truth, no drift). Search is UI-only, so this covers the parts that CAN break
// headlessly: the index projection, the match predicate, and routing resolvability.
//
//   (1) index — gsBuildIndex(), run against the real ops/ tree, yields a non-empty
//       group for all five surfaces (work / captures / pie / cb / ep) and every row
//       carries the fields the renderer reads (id|title, desc, type);
//   (2) match — gsHit() is case-insensitive substring over title + ID + description,
//       including a DESCRIPTION-ONLY hit (AC-2's third field, the easy one to drop);
//   (3) coverage — one query reaches every group at once (AC-1);
//   (4) scope+project filtering narrows as the chips/Project filter do (AC-6);
//   (5) routing — every work-item hit resolves through the SAME lookup gsRoute() uses
//       (STATE.files[path] -> findRecord -> decorate), so no hit is a dead link (AC-3);
//       capture / CB / EP hits carry the ID their surface row is keyed by.
//
//   node tools/searchcheck.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// ---- core (same extraction the other harnesses use) ----
const coreM = html.match(/<script id="plexus-core">([\s\S]*?)<\/script>/);
if (!coreM) { console.error("FAIL: no plexus-core block in index.html"); process.exit(1); }
const sandbox = { module: { exports: {} }, globalThis: {} };
new Function("module", "globalThis", coreM[1])(sandbox.module, sandbox.globalThis);
const P = sandbox.module.exports.parse ? sandbox.module.exports : sandbox.globalThis.Plexus;
if (!P || !P.parse) { console.error("FAIL: core did not export parse"); process.exit(1); }

// ---- pull the app-side search functions out of the second <script> block ----
const appM = html.match(/<script>\s*\n\(function \(\) \{([\s\S]*)\}\)\(\);\s*<\/script>/);
if (!appM) { console.error("FAIL: could not locate the app script block in index.html"); process.exit(1); }
const app = appM[1];

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error(`could not find function ${name}() in index.html`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}
function extractVar(src, name) {
  const re = new RegExp("var " + name + "\\s*=\\s*\\{[\\s\\S]*?\\};", "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find var ${name} in index.html`);
  return m[0];
}

let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };
const ok = (msg) => console.log("PASS  " + msg);

// Build a tiny module holding the REAL shipped functions, with the DOM-bound world
// (STATE, PROJECT_COLORS) injected rather than stubbed-out logic.
let build, hit, parsePie, decorate;
try {
  const src = [
    extractVar(app, "PROJECT_COLORS"),
    extractFn(app, "decorate"),
    extractFn(app, "parsePie"),
    extractFn(app, "gsBuildIndex"),
    extractFn(app, "gsHit"),
    "var GS_INDEX = null;",
    "return { build: gsBuildIndex, hit: gsHit, parsePie: parsePie, decorate: decorate };"
  ].join("\n");
  ({ build, hit, parsePie, decorate } = new Function("STATE", "P", src)(globalThis.__STATE = {}, P));
} catch (e) {
  console.error("FAIL: extracting search functions — " + e.message);
  process.exit(1);
}

// ---- load the real repo data into a STATE shaped like the engine's ----
const DATA = join(root, "..", "plexus-bucket-d", "ops");
const SKIP = new Set(["captures.md", "pie.md", "cb_register.md", "EP_Register.md"]);
const opsFiles = readdirSync(DATA).filter((f) => f.endsWith(".md") && !SKIP.has(f));

const STATE = { files: {}, cbByEpic: {} };
for (const f of opsFiles) {
  const path = "ops/" + f;
  const project = f.replace(/_operations\.md$/, "").replace(/_/g, " ");
  STATE.files[path] = { meta: { path, project, tag: project, vocab: "word", root: "" }, model: P.parse(readFileSync(join(DATA, f), "utf8")) };
}
STATE.captures = { model: P.parse(readFileSync(join(DATA, "captures.md"), "utf8")) };
STATE.pie = { raw: readFileSync(join(DATA, "pie.md"), "utf8") };
STATE.cbRegRaw = readFileSync(join(DATA, "cb_register.md"), "utf8");
STATE.epRegRaw = readFileSync(join(DATA, "EP_Register.md"), "utf8");
STATE.cbByEpic = P.parseCbRegister(STATE.cbRegRaw).cbByEpic;

// re-bind the injected STATE (the factory captured the object identity above)
Object.assign(globalThis.__STATE, STATE);

// ---- (1) index: every surface populated, every row renderable ----
const idx = build();
const GROUPS = ["work", "captures", "pie", "cb", "ep"];
for (const g of GROUPS) {
  const rows = idx[g] || [];
  if (!rows.length) { fail(`index group "${g}" is empty — global search would show no ${g} hits`); continue; }
  const broken = rows.filter((r) => (!r.id && !r.title) || typeof r.desc !== "string" || !r.type);
  if (broken.length) fail(`index group "${g}": ${broken.length} row(s) missing id/title, desc or type (first: ${JSON.stringify(broken[0])})`);
  else ok(`index group "${g}": ${rows.length} row(s), all carry id|title + desc + type`);
}

// ---- (2) match predicate: title / ID / description, case-insensitive ----
const probe = { title: "Collapsible left navigation", id: "OP-083", desc: "hamburger toggle for the side nav" };
const cases = [
  ["title match", "collapsible", true],
  ["title match (mixed case)", "COLLAPSIBLE", true],
  ["ID match", "op-083", true],
  ["description-only match (AC-2)", "hamburger", true],
  ["non-match", "zzzznotpresent", false]
];
for (const [label, q, want] of cases) {
  const got = hit(probe, q.toLowerCase());
  if (got === want) ok(`match: ${label} -> ${got}`);
  else fail(`match: ${label} expected ${want}, got ${got}`);
}
// a description-only hit must survive against REAL data too (not just the probe)
const descOnly = idx.work.filter((r) => {
  const d = String(r.desc).toLowerCase();
  if (!d) return false;
  const word = "rollup";
  return d.indexOf(word) >= 0 && String(r.title).toLowerCase().indexOf(word) < 0 && String(r.id).toLowerCase().indexOf(word) < 0;
});
if (descOnly.length) ok(`description-only hits exist in live data: ${descOnly.length} work item(s) match "rollup" on description alone`);
else fail(`no live description-only match for "rollup" — AC-2's description field may not be indexed`);

// ---- (3) coverage: one query reaching all five groups (AC-1) ----
const COVER = "s";
const covered = GROUPS.filter((g) => idx[g].some((it) => hit(it, COVER)));
if (covered.length === GROUPS.length) ok(`coverage: query "${COVER}" hits all five groups (${GROUPS.join(", ")})`);
else fail(`coverage: query "${COVER}" reached only ${covered.join(", ") || "no groups"}`);

// ---- (4) filtering: scope + project narrowing (AC-6) ----
const q41 = "search";
const allHits = GROUPS.reduce((n, g) => n + idx[g].filter((it) => hit(it, q41)).length, 0);
const scoped = idx.work.filter((it) => hit(it, q41)).length;
if (allHits >= scoped && scoped > 0) ok(`scope filter: "${q41}" -> ${allHits} total, ${scoped} when scoped to Work Items only`);
else fail(`scope filter: "${q41}" gave ${allHits} total / ${scoped} work — expected work-only to be a non-empty subset`);
const projects = [...new Set(idx.work.map((r) => r.project))];
const oneProj = projects[0];
const projHits = idx.work.filter((it) => hit(it, COVER) && it.project === oneProj).length;
const anyHits = idx.work.filter((it) => hit(it, COVER)).length;
if (projects.length > 1 && projHits < anyHits && projHits > 0) ok(`project filter: "${COVER}" -> ${anyHits} across ${projects.length} projects, ${projHits} narrowed to "${oneProj}"`);
else fail(`project filter did not narrow (${projHits}/${anyHits} across ${projects.length} project(s))`);

// ---- (5) routing: every hit resolves the way gsRoute() resolves it (AC-3) ----
let dead = 0;
for (const it of idx.work) {
  const f = STATE.files[it.path];
  if (!f) { dead++; continue; }
  const rec = P.findRecord(f.model, it.id);
  if (!rec) { dead++; continue; }
  const card = decorate(rec, f.meta);
  if (!card || card.id !== it.id) dead++;
}
if (!dead) ok(`routing: all ${idx.work.length} work-item hits resolve via files[path] -> findRecord -> decorate (no dead links)`);
else fail(`routing: ${dead}/${idx.work.length} work-item hits do NOT resolve — those rows would open nothing`);

for (const [g, label] of [["captures", "capture"], ["cb", "CB"], ["ep", "EP"]]) {
  const missing = idx[g].filter((r) => !r.id).length;
  if (!missing) ok(`routing: every ${label} hit carries the ID its surface row is keyed by`);
  else fail(`routing: ${missing} ${label} hit(s) have no ID — the row highlight could not find them`);
}
const pieNoTitle = idx.pie.filter((r) => !r.title).length;
if (!pieNoTitle) ok(`routing: every Pie hit carries a title (Pie ideas have no ID — the highlight keys on title)`);
else fail(`routing: ${pieNoTitle} Pie hit(s) have no title — the row highlight could not find them`);

console.log(failed
  ? `\n${failed} global-search check(s) FAILED`
  : `\nAll global-search checks passed (index projection + substring match incl. description-only + five-group coverage + scope/project narrowing + routing resolvability)`);
process.exit(failed ? 1 : 0);
