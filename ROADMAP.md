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

## Tier 2 — Interoperability  ✅ shipped in v1.2

- [x] **Import Postman collections** (v2.x JSON) — sidebar Import button; folders, bodies,
      auth and disabled rows all mapped; collection variables become an environment.
- [x] **Export to Postman format** — ⇩ action on each collection exports v2.1 JSON.
- [x] **Import Postman environments** — recognized automatically by the Import dialog.
- [x] **Import from cURL** — paste a `curl` command in the Import dialog, get a filled-in tab.
- [x] **Import OpenAPI / Swagger** — OpenAPI 3 & Swagger 2 (JSON); tags become folders,
      `$ref` schemas resolved into JSON body skeletons, path params become `{{variables}}`.
- [x] **Full backup / restore** — Settings → Export/Restore backup.
- [x] **Code generation** — `</>` button: cURL, JavaScript fetch/axios, Python requests,
      PowerShell, C# HttpClient, Go net/http.

## Tier 3 — Power features  ✅ shipped in v1.3

- [x] **Cookie manager** — automatic Set-Cookie capture with domain/path/expiry matching,
      per-domain viewer, on/off toggle (Cookies button in the top bar).
- [x] **More auth types** — OAuth 2.0 (client credentials + authorization code with PKCE in a
      popup window), Digest (MD5/SHA-256, verified against RFC 2617), AWS Signature v4.
- [x] **Environment upgrades** — Globals entry in the environment manager, `{{` autocomplete
      in inputs, 👁 secret masking per variable, Import .env button.
- [x] **Request chaining** — `{{res.<RequestName>.body.<path>}}`, `{{res.last.status}}`,
      `{{res.Login.headers.content-type}}` resolve from earlier responses.
- [x] **Pre-request & test scripts** — Scripts tab with a `pm` API and `expect()` assertions;
      results shown in a Tests tab on the response.
- [x] **Collection runner** — ▶ on a collection; optional CSV/JSON data file iterations,
      per-request delay, live results with test counts.
- [x] **GraphQL mode** — body type with query + variables editors, sent as JSON.
- [x] **WebSocket & SSE client** — WS/SSE methods in the dropdown, Connect/Disconnect,
      live message console with send box for WS.
- [x] **Response diffing** — Pin a response, then the Diff view shows added/removed lines
      against the next response.
- [x] **History with snapshots** — the last 25 history entries store the response (up to 64 KB);
      clicking them restores both request and response.

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
