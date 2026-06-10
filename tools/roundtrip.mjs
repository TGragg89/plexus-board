// Round-trip fidelity harness (Path B design contract §3.4 / §6 / §7 risk 1).
//
//   node tools/roundtrip.mjs <file.md> [<file2.md> ...]
//
// For each file: read bytes -> decode UTF-8 -> Plexus.parse -> Plexus.serialize
// -> re-encode UTF-8 -> assert the byte buffer is identical to the original.
// The serializer applies only targeted edits to retained raw text, so a
// read-only round trip MUST be byte-for-byte identical. Exit 1 on any mismatch.
//
// The Plexus core is extracted from index.html so there is ONE source of truth
// (the shipped single-file app) — no duplicated parser to drift.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

const m = html.match(/<script id="plexus-core">([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: could not find <script id=\"plexus-core\"> in index.html"); process.exit(1); }

const sandbox = { module: { exports: {} }, globalThis: {} };
new Function("module", "globalThis", m[1])(sandbox.module, sandbox.globalThis);
const P = sandbox.module.exports.parse ? sandbox.module.exports : sandbox.globalThis.Plexus;
if (!P || !P.parse) { console.error("FAIL: core did not export parse/serialize"); process.exit(1); }

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node tools/roundtrip.mjs <file.md> [...]"); process.exit(2); }

let failed = 0;
for (const f of files) {
  const orig = readFileSync(f);                  // Buffer
  const text = orig.toString("utf8");            // decode
  const model = P.parse(text);                   // parse (retains raw)
  const out = P.serialize(model);                // serialize (no edits -> raw)
  const outBuf = Buffer.from(out, "utf8");       // re-encode
  const ok = outBuf.equals(orig);
  const tl = model.topLevel.length, ops = model.ops.length, pd = model.decisions.length, r = model.resolved.length;
  if (ok) {
    console.log(`PASS  ${f}`);
    console.log(`      bytes=${orig.length}  top-level=${tl}  ops/backlog=${ops}  PD=${pd}  R=${r}  warnings=${model.warnings.length}`);
  } else {
    failed++;
    console.log(`FAIL  ${f}  (byte mismatch: orig=${orig.length} out=${outBuf.length})`);
    // locate first differing byte
    const n = Math.min(orig.length, outBuf.length);
    let i = 0; while (i < n && orig[i] === outBuf[i]) i++;
    const ctx = (b, p) => JSON.stringify(b.slice(Math.max(0, p - 30), p + 30).toString("utf8"));
    console.log(`      first diff at byte ${i}`);
    console.log(`      orig: ${ctx(orig, i)}`);
    console.log(`      out : ${ctx(outBuf, i)}`);
  }
}
console.log(failed ? `\n${failed} file(s) FAILED round-trip` : `\nAll ${files.length} file(s) passed byte-for-byte round trip`);
process.exit(failed ? 1 : 0);
