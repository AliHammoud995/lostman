# Lostman 🧭

A free, offline Postman-style API client for Windows. No login, no account, no cloud sync —
everything is stored locally on your machine.

## Features

- **Requests** — GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS with query params,
  headers, body (raw JSON/text, form-data, x-www-form-urlencoded) and auth
  (Bearer token, Basic auth, API key).
- **Tabs** — work on several requests at once; open tabs are restored on restart.
- **Collections** — save and organize requests, all persisted locally.
- **History** — the last 100 requests you sent, one click to re-open.
- **Environments** — define `{{variables}}` and use them in URLs, params, headers,
  bodies and auth fields; switch environments from the top bar.
- **Responses** — status / time / size, pretty-printed JSON with syntax highlighting,
  raw view, HTML and image preview, response headers, copy to clipboard.
- **Copy as cURL** — export any request as a `curl` command.
- **No CORS problems** — requests are sent from the app's backend process, not a browser page.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send request |
| `Ctrl+S` | Save request to a collection |
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

Outputs an NSIS installer and a portable `.exe` to the `dist/` folder.

## Where is my data?

Everything (collections, history, environments, open tabs) lives in a single JSON file:

```
%AppData%\Lostman\lostman-data.json
```

Delete that file to reset the app. Copy it to another machine to move your data.

## Notes

- File uploads in `form-data` bodies are not supported yet (text fields only).
- Response bodies over 2 MB are truncated in the viewer (the full size is still reported).
