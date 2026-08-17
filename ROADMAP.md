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

- [x] **Linux builds** — AppImage + .deb targets (`npm run dist:linux`); the app itself is
      fully cross-platform. *(shipped in v1.3.1)*
- [x] **CI release pipeline** — GitHub Actions builds Windows + Linux packages on every
      `v*` tag and attaches them to a GitHub Release. *(shipped in v1.3.1)*

- [x] **Proxy support** — none / system proxy / manual URL (with auth) + bypass list;
      HTTP requests go via the proxy, HTTPS through a CONNECT tunnel. *(v1.4)*
- [x] **Client certificates** — per-hostname mTLS (PFX or PEM cert+key, wildcard hosts),
      managed in Settings. *(v1.4)*
- [x] **Streamed large responses** — bodies over 5 MB stream to disk (up to 500 MB) with a
      2 MB preview in the viewer; Save writes the exact full bytes. *(v1.4)*
- [x] **Portable data mode** — Settings can move `lostman-data.json` next to the app
      (auto-detected on launch; USB-stick friendly). *(v1.4)*
- [x] **Auto-updates** — electron-updater checks GitHub Releases on startup (installer and
      AppImage builds) and offers a restart when an update is downloaded. *(v1.4)*
- [x] **Command palette** — Ctrl+K fuzzy-searches saved requests, tabs and actions. *(v1.4)*
- [x] **Multi-window** — Ctrl+Shift+N or the palette; shared data syncs between windows. *(v1.4)*
- [x] **Tests & linting** — 63 unit tests (`npm test`) + ESLint/Prettier, enforced by a CI
      workflow on every push. *(v1.4)*
- [x] **Localization** — full i18n system (English keys with graceful fallback) shipping
      English, العربية (RTL), Français, Español and Deutsch; language picker in Settings;
      a CI test fails if any new string is left untranslated. *(v1.5)*
