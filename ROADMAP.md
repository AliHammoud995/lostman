# Lostman Roadmap

Ideas for future versions, roughly ordered by value vs. effort. Check items off as they ship.

## Tier 1 — Quick wins  ✅ shipped in v1.1

- [x] **Custom app icon** — generated from `images/logo-icon.png` (taskbar, window, installer).
- [x] **File uploads in form-data** — per-row Text/File toggle with a native file picker.
- [x] **Request settings** — Settings screen with timeout, follow-redirects toggle and
      SSL-verification toggle (for self-signed dev servers).
- [x] **Search / filter** — filter box for collections and history in the sidebar.
- [x] **Duplicate & rename** — row actions on saved requests; right-click a tab for
      Rename / Duplicate / Save As / Close Others.
- [x] **URL ↔ Params sync** — typing `?key=value` in the URL populates the Params table and vice versa.
- [x] **Folders inside collections** — one folder level, drag-and-drop to reorder and move requests.
- [x] **Response search & download** — find-in-body (Ctrl+F) and "Save response to file".
- [x] **Light theme** — theme toggle in Settings.

## Tier 2 — Interoperability

- [ ] **Import Postman collections** (v2.1 JSON) — the killer migration feature.
- [ ] **Export to Postman format** — so nobody is locked in.
- [ ] **Import from cURL** — paste a `curl` command, get a filled-in request (we already export).
- [ ] **Import OpenAPI / Swagger** — generate a collection from a spec file.
- [ ] **Full backup / restore** — one-click export & import of the entire data file.
- [ ] **Code generation** — snippet generator for JavaScript fetch/axios, Python requests,
      PowerShell, C#, Go, etc.

## Tier 3 — Power features

- [ ] **Cookie manager** — view/edit cookies per domain, toggle automatic cookie handling.
- [ ] **More auth types** — OAuth 2.0 flows (authorization code + client credentials), Digest, AWS Signature v4.
- [ ] **Environment upgrades** — global variables, `{{variable}}` autocomplete while typing,
      secret values masked in the UI, import variables from `.env` files.
- [ ] **Request chaining** — reference values from a previous response
      (e.g. `{{login.response.body.token}}`) in the next request.
- [ ] **Pre-request & test scripts** — sandboxed JS hooks with simple assertions
      (`expect(status).toBe(200)`), pass/fail shown per request.
- [ ] **Collection runner** — run a whole collection in order, optionally iterating over a CSV/JSON data file, with a results report.
- [ ] **GraphQL mode** — query editor with variables panel.
- [ ] **WebSocket & SSE client** — connect, send frames, view a live message stream.
- [ ] **Response diffing** — compare two responses side by side.
- [ ] **History with snapshots** — store the response alongside each history entry so old results can be reviewed.

## Tier 4 — Polish & distribution

- [ ] **Proxy support** — manual proxy config plus use-system-proxy option.
- [ ] **Client certificates** — mTLS support per domain.
- [ ] **Streamed large responses** — handle 100 MB+ bodies without loading them fully into memory.
- [ ] **Portable data mode** — optionally store `lostman-data.json` next to the .exe (USB-stick friendly).
- [ ] **Auto-updates** — electron-updater + GitHub Releases.
- [ ] **CI release pipeline** — GitHub Actions workflow that builds the installer/portable exe on every tagged release.
- [ ] **Command palette** — Ctrl+K to jump to any saved request or action.
- [ ] **Multi-window** — open a second Lostman window.
- [ ] **Tests & linting** — unit tests for request building/env substitution, ESLint + Prettier.
- [ ] **Localization** — extract UI strings so translations are possible.
