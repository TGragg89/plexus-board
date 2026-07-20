// Graceful stale-SHA (409) recovery harness — OP-079 (EP-031 "Mobile-friendly Plexus").
// Offline, against the live repo ops data + the REAL shipped recovery loop (extracted
// verbatim from index.html — one source of truth, no drift).
//
// The board's write is optimistically locked on the blob SHA cached at load. A
// backgrounded mobile tab is suspended, so the first write after refocus commits with a
// stale SHA and GitHub answers 409/422. reconcileWrite() refetches the latest SHA,
// re-applies the pending edit onto the fresh bytes, and retries (max 3) instead of
// hard-refusing. This harness drives that exact function with a stubbed GitHub layer:
//
//   (a) 409 → refetch → retry SUCCEEDS: a stale first write reconciles and lands, with
//       the user's edit intact in the committed bytes (AC-1);
//   (b) 409 on EVERY attempt → edit PRESERVED + exhausted error state: the loop rejects
//       (never resolves, never overwrites), and the last re-applied text still carries the
//       user's change — it is not dropped (AC-3);
//   (c) the retry counter increments 1 → 2 → 3 (AC-1/AC-2).
//
//   node tools/conflictcheck.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// ---- core (same extraction the other harnesses use) — for the REAL parser ----
const coreM = html.match(/<script id="plexus-core">([\s\S]*?)<\/script>/);
if (!coreM) { console.error("FAIL: no plexus-core block in index.html"); process.exit(1); }
const sandbox = { module: { exports: {} }, globalThis: {} };
new Function("module", "globalThis", coreM[1])(sandbox.module, sandbox.globalThis);
const P = sandbox.module.exports.parse ? sandbox.module.exports : sandbox.globalThis.Plexus;
if (!P || !P.parse) { console.error("FAIL: core did not export parse"); process.exit(1); }

// ---- pull the REAL reconcileWrite out of the app <script> block (no drift) ----
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
let reconcileWrite;
try {
  reconcileWrite = new Function(extractFn(app, "reconcileWrite") + "\nreturn reconcileWrite;")();
} catch (e) {
  console.error("FAIL: extracting reconcileWrite — " + e.message);
  process.exit(1);
}

let failed = 0;
const fail = (msg) => { failed++; console.log("FAIL  " + msg); };
const ok = (msg) => console.log("PASS  " + msg);

// ---- a real edit re-applied onto real repo bytes (the exact commitWithRecovery shape) ----
const DATA = join(root, "..", "plexus-bucket-d", "ops");
const OPS = join(DATA, "plexus_operations.md");
const ORIG = readFileSync(OPS, "utf8");
const ID = "EP-001", TOKEN = "`complete`", EXPECT = "Done";
function reapply(raw) {
  const m2 = P.parse(raw);
  if (!P.setStatus(m2, ID, TOKEN)) return null;
  P.bumpLastUpdated(m2, "2026-07-20");
  return P.serialize(m2);
}
// sanity: the base edit lands a real change (else the whole harness is vacuous)
{
  const t = reapply(ORIG);
  const rec = t && P.findRecord(P.parse(t), ID);
  if (!rec || rec.status !== EXPECT) { console.error("FAIL: base reapply did not set " + ID + " -> " + EXPECT); process.exit(1); }
}

// A stubbed GitHub layer. server.sha is what a PUT must match; `raceEveryGet` models a
// pathological concurrent writer that advances the server SHA again on every refetch, so
// every retry still conflicts (drives cases b + c). retriesLog records io.onRetry(n).
function makeIo({ startSha, serverSha, alwaysConflict, succeedAfter, raceEveryGet }) {
  const io = { retriesLog: [], rebuildCount: 0, lastRebuiltText: null };
  const server = { sha: serverSha, body: ORIG };
  let seq = 0;
  io.first = { text: reapply(ORIG), sha: startSha };
  io.put = (text, sha) => {
    io.lastPutText = text;
    const stale = sha !== server.sha;
    const forced = alwaysConflict || (succeedAfter != null && io.retriesLog.length < succeedAfter);
    if (stale || forced) {
      const e = new Error("Stale SHA (409)"); e.conflict = true; return Promise.reject(e);
    }
    server.body = text; server.sha = "committed-" + (++seq);
    return Promise.resolve({ content: { sha: server.sha }, commit: { sha: "abc1234deadbeef" } });
  };
  io.rebuild = () => {
    io.rebuildCount++;
    if (raceEveryGet) server.sha = "fresh-" + (++seq);   // the file changed again under us
    const text = reapply(server.body);                    // re-apply the SAME edit onto fresh bytes
    io.lastRebuiltText = text;
    return Promise.resolve({ text, sha: server.sha });
  };
  io.onRetry = (n /*, total */) => { io.retriesLog.push(n); };
  return io;
}
const editPresent = (text) => {
  const rec = text && P.findRecord(P.parse(text), ID);
  return !!rec && rec.status === EXPECT;
};

// ---- (a) 409 → refetch → retry SUCCEEDS (AC-1) ----
await (async () => {
  // first write is stale (startSha != serverSha); the refetch picks up the real sha and the
  // retry lands. No pathological racing writer, so retry 1 succeeds.
  const io = makeIo({ startSha: "stale", serverSha: "v1" });
  try {
    const out = await reconcileWrite(io, 3);
    if (out.retries !== 1) fail(`(a) expected exactly 1 retry to recover, got ${out.retries}`);
    else if (!editPresent(io.lastPutText)) fail("(a) committed bytes lost the user's edit");
    else if (!out.resp || !out.resp.content) fail("(a) missing commit response");
    else ok("(a) stale first write reconciled and landed on retry 1, edit intact");
  } catch (e) {
    fail("(a) recovery rejected unexpectedly: " + (e && e.message));
  }
})();

// ---- (b) 409 on every attempt → edit PRESERVED + exhausted (AC-3) ----
await (async () => {
  const io = makeIo({ startSha: "stale", serverSha: "v1", alwaysConflict: true, raceEveryGet: true });
  try {
    await reconcileWrite(io, 3);
    fail("(b) reconcileWrite RESOLVED under permanent conflict — it must reject, never overwrite");
  } catch (e) {
    if (!e || !e.exhausted) fail("(b) rejection is not the exhausted error state: " + (e && e.message));
    else if (e.retries !== 3) fail(`(b) exhausted after ${e.retries} retries, expected 3`);
    else if (io.rebuildCount !== 3) fail(`(b) refetch/re-apply ran ${io.rebuildCount} times, expected 3`);
    else if (!editPresent(io.lastRebuiltText)) fail("(b) the user's edit was DROPPED on reconcile — AC-3 violated");
    else ok("(b) permanent 409 → rejected (exhausted), edit preserved across all 3 reconciles");
  }
})();

// ---- (c) retry counter increments 1 → 2 → 3 (AC-1/AC-2) ----
await (async () => {
  const io = makeIo({ startSha: "stale", serverSha: "v1", alwaysConflict: true, raceEveryGet: true });
  try { await reconcileWrite(io, 3); } catch (e) { /* expected exhaustion */ }
  const seen = JSON.stringify(io.retriesLog);
  if (seen !== JSON.stringify([1, 2, 3])) fail(`(c) retry counter was ${seen}, expected [1,2,3]`);
  else ok("(c) retry counter incremented 1 → 2 → 3");
})();

// ---- (d) guard: first write succeeds → zero retries, no visible sync state (quiet path) ----
await (async () => {
  const io = makeIo({ startSha: "v1", serverSha: "v1" });   // cached sha already current
  try {
    const out = await reconcileWrite(io, 3);
    if (out.retries !== 0) fail(`(d) clean first write should take 0 retries, got ${out.retries}`);
    else if (io.retriesLog.length !== 0) fail("(d) onRetry fired on a clean first write — desktop would see noise");
    else if (!editPresent(io.lastPutText)) fail("(d) committed bytes lost the edit");
    else ok("(d) clean first write commits with 0 retries and no sync-state noise");
  } catch (e) { fail("(d) clean write rejected: " + (e && e.message)); }
})();

// ---- (e) guard: a non-conflict error bubbles unchanged (no silent retry/swallow) ----
await (async () => {
  const io = makeIo({ startSha: "v1", serverSha: "v1" });
  io.put = () => { const e = new Error("boom 500"); return Promise.reject(e); }; // not a conflict
  try {
    await reconcileWrite(io, 3);
    fail("(e) non-conflict error was swallowed");
  } catch (e) {
    if (e && e.conflict) fail("(e) wrong error surfaced");
    else if (e && e.exhausted) fail("(e) non-conflict error was mis-labeled exhausted");
    else if (io.rebuildCount !== 0) fail("(e) retried on a non-conflict error");
    else ok("(e) non-conflict error bubbles unchanged, no retry");
  }
})();

if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log("\nAll conflictcheck cases passed.");
