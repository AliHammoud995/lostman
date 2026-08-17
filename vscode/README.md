# Lostman — API Client for VS Code

The free, offline Postman alternative — right inside VS Code. No login, no account,
no cloud sync: everything stays on your machine.

Open it with **Ctrl+Shift+P → "Lostman: Open API Client"**.

## Features

- REST requests (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) with params, headers, raw/JSON,
  form-data (file uploads) and x-www-form-urlencoded bodies
- **GraphQL** query + variables editor, **WebSocket** and **SSE** live consoles
- Auth: Bearer, Basic, API key, **OAuth 2.0** (client credentials & authorization code with
  PKCE via your browser), **Digest**, **AWS Signature v4**
- Collections with folders, tabs, history with response snapshots
- Environments & globals with `{{variable}}` autocomplete, secret masking, `.env` import
- Request chaining (`{{res.Login.body.token}}`), pre-request & test scripts, collection runner
  with CSV/JSON data files
- Import/export Postman collections, import OpenAPI/Swagger specs and cURL commands
- Code generation: cURL, fetch, axios, Python, PowerShell, C#, Go
- Proxy support, client certificates (mTLS), streamed large responses, cookie manager
- 5 languages: English, العربية, Français, Español, Deutsch

Also available as a standalone desktop app for Windows and Linux:
[github.com/AliHammoud995/lostman](https://github.com/AliHammoud995/lostman)
