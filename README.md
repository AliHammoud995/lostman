<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/logo-badge.png">
    <img src="images/logo-light.png" alt="Lostman" width="360">
  </picture>
</p>

# Lostman

A free, offline Postman-style API client for Windows. No login, no account, no cloud sync —
everything is stored locally on your machine.

## Features

- **Requests** — GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS with query params,
  headers, body (raw JSON/text, form-data **with file uploads**, x-www-form-urlencoded)
  and auth (Bearer token, Basic auth, API key).
- **URL ↔ Params sync** — type `?key=value` in the URL bar and the Params table fills in,
  edit the table and the URL updates.
- **Tabs** — work on several requests at once; open tabs are restored on restart.
  Right-click a tab for Rename / Duplicate / Save As / Close Others.
- **Collections & folders** — save and organize requests, drag-and-drop to reorder or
  move between folders, duplicate/rename from the sidebar, all persisted locally.
- **History** — the last 100 requests you sent, one click to re-open.
- **Search everywhere** — filter collections and history from the sidebar; find text in a
  response body with `Ctrl+F`.
- **Environments** — define `{{variables}}` and use them in URLs, params, headers,
  bodies and auth fields; switch environments from the top bar.
- **Responses** — status / time / size, pretty-printed JSON with syntax highlighting,
  raw view, HTML and image preview, response headers, copy to clipboard, and save the
  full body to a file.
- **Settings** — light/dark theme, request timeout, follow-redirects toggle, and an SSL
  verification toggle for local servers with self-signed certificates.
- **Copy as cURL** — export any request as a `curl` command (including form files).
- **No CORS problems** — requests are sent from the app's backend process, not a browser page.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send request |
| `Ctrl+S` | Save request to a collection |
| `Ctrl+Shift+S` | Save request as a copy |
| `Ctrl+F` | Find in response body |
| `Ctrl+T` | New request tab |
| `Ctrl+W` | Close current tab |
| `F12` | Toggle DevTools |

## Run from source

```
npm install
npm start
```

## Build a Windows installer / portable exe

```
npm run dist
```

Outputs an NSIS installer and a portable `.exe` (with the Lostman icon) to the `dist/` folder.

## Where is my data?

Everything (collections, history, environments, open tabs, settings) lives in a single JSON file:

```
%AppData%\Lostman\lostman-data.json
```

Delete that file to reset the app. Copy it to another machine to move your data.

## Notes

- Response bodies over 2 MB are truncated in the viewer; **Save** still writes the complete body.
- Responses are capped at 50 MB.
- See [ROADMAP.md](ROADMAP.md) for what's planned next.
