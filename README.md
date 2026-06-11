# Plexus Board

A single-file, dependency-free Kanban reader/writer for the **Bucket D** operations layer.
This is the **engine** repo: it hosts the app (one static `index.html` on GitHub Pages) and
contains **no data and no tokens** — ever. All data is fetched at runtime from a private
data repository via an authenticated GitHub API call.

## How it works

- **Hosting:** GitHub Pages, `main` branch root. No build step, no framework, vanilla JS.
- **Auth:** a GitHub **fine-grained Personal Access Token**, scoped to the single data repo
  with **Contents: Read and write** and a **90-day expiry**. The token is stored in the
  browser's `localStorage` behind an explicit consent banner and is sent only to
  `api.github.com` in a request header — never in a URL, a commit, or this repo.
- **Read:** `GET` the contents endpoint per ops file → parse the Markdown ops layer →
  render the swimlane Kanban (full-height cards, multi-select filters, a click-through
  detail drawer, and a derived child-rollup hint on Epic/Bet cards).
- **Write (Write Pattern 1):** parse → mutate one cell → re-serialize the untouched
  remainder byte-for-byte → `PUT` with the cached blob SHA (optimistic locking; a stale
  SHA is refused, never overwritten) → bump the §preamble `Last updated` in the same write.
  Two write types ship: **status flip** and **priority change** — inline on a card, in the
  detail drawer, or by dragging a card between status columns.

## Layout

| Path | Purpose |
|---|---|
| `index.html` | The whole app. The parser/serializer lives in `<script id="plexus-core">` — pure functions, no DOM. |
| `tools/roundtrip.mjs` | Acceptance harness: `node tools/roundtrip.mjs <file.md> …` parses then serializes each file and asserts the bytes are identical. The serializer applies only targeted edits to retained raw text, so a read-only round trip is byte-for-byte. |
| `tools/writecheck.mjs` | Write-fidelity harness: for each write type (status flip + priority change) it applies one change + a `Last updated` bump and asserts **exactly two lines** changed (the row + the date), every other byte identical, and that the re-parsed row lands on the target value. |

## Acceptance gates

Both harnesses extract the core parser from `index.html` (single source of truth) so they
can never drift from the shipped app.

```sh
node tools/roundtrip.mjs path/to/ops_file.md   # serializer reproduces the file byte-for-byte
node tools/writecheck.mjs                       # each write type = minimal 2-line diff
```

## License

MIT © 2026 — see [LICENSE](LICENSE).
