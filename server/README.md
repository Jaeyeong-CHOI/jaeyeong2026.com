# Homepage chat API

Static frontend: `web/chat-widget.js` and `web/chat-widget.css`, deployed by GitHub Pages. Backend: Node 26, built-in HTTP/fetch/SQLite, bound to `127.0.0.1:5212` behind a dedicated Cloudflare Tunnel at `chat-api.jaeyeong2026.com`. No package install required.

## Private runtime files (never commit or place in web/)

- `~/.config/jaeyeong2026-chat/secrets.env`: `OPENAI_API_KEY`, mode 600. A legacy `CHAT_IDENTITY_SALT` may remain but is no longer used.
- `~/.config/jaeyeong2026-chat/config.json`: enabled/promptReady flags, port, origin allowlist, promptFile, dbPath.
- `~/.config/jaeyeong2026-chat/system-prompt.md`: final server-side instructions, maximum 32 KiB of UTF-8 text (32,768 bytes, including separators and whitespace). Runtime and activation checks share this bound in `server/constants.mjs`.
- `~/.local/share/jaeyeong2026-chat/usage.sqlite`: counters and conservative cost reservations, mode 600.

Launch with `node --env-file=<private secrets.env> server/server.mjs`. macOS service labels: `ai.openclaw.jaeyeong-chat` and `ai.openclaw.cloudflared.jaeyeong-chat`. Both restart at login or process failure. The Mac must remain running and connected.

## Prompt handoff / kill switch

Production was activated on 2026-10-21 with the owner-supplied three-module prompt. `manage.mjs status` reports the current state; disabling displays Coming soon. Combine the final role/rules, public profile and response examples into the private prompt file, in that order; do not place these source files in `web/`. After installing the final prompt, run:

```sh
/opt/homebrew/bin/node server/manage.mjs enable
/opt/homebrew/bin/node server/manage.mjs status
```

`enable` rejects the pending placeholder and restarts the local service. After editing an already-active prompt, rerun `enable` to load it. Immediate stop for new requests:

```sh
/opt/homebrew/bin/node server/manage.mjs disable
```

Do not reset the database to clear limits. There is no public administration endpoint.

## Cost and abuse controls

- Fixed `gpt-6-luna`, reasoning `none`, Standard tier, `store:false`, text only, 400 maximum output tokens; no tools, model override, automatic retry, or expensive fallback.
- One site-wide limit: **5 requests per rolling 60 seconds**, shared by all visitors. No user/IP, daily, monthly, budget, or separate in-flight admission caps.
- All attempts that reach the provider count, including failures/timeouts. Conservative cost estimates are recorded for diagnostics only; they do not block requests.
- Uses UTF-8 byte upper bound plus framing and 20% margin, $0.125/1M input (higher cache-write rate), $0.50/1M output. These application estimates are conservative diagnostics, not a spending cap. Recheck prices before changing model/tier.
- SQLite transaction reserves cost/quota before sending. Restarting the server, refreshing, or New chat does not reset limits.
- 1,000 characters per message; 6 history messages/6,000 characters; 32 KB body; 8-second body deadline and 45-second upstream timeout.
- Only exact allowed origins, through a loopback-only Cloudflare Tunnel. No client IP/cookie identity is used for quotas. Do not bind the API to a public/LAN interface or add an untrusted local proxy. Origin checks are not authentication; the persistent shared minute cap applies regardless of identity headers.

New records use a fixed `global` marker, timestamps, reservation costs and token counts; legacy HMAC identity rows are retained until normal expiry and count in the same minute window; no prompts/replies or raw IP addresses in this app's usage DB/logs. Records older than 90 days are pruned at server start. Cloudflare/OpenAI have their own processing policies; `store:false` does not imply zero retention.

## Verification

```sh
/opt/homebrew/bin/node --test server/*.test.mjs
/opt/homebrew/bin/node --check web/chat-widget.js
```

The minimal widget uses text controls without decorative icons, avatars or gradients. `web/chat-format.js` renders only bold text and approved profile links using DOM text nodes, never raw response HTML.

`GET /healthz` -> 200. `GET /v1/status` with allowed Origin reports availability and UI limits. `POST /v1/chat` accepts only `{message, history}`; 429 includes Retry-After; disabled returns 503 without contacting OpenAI. Tests use mocks and temporary SQLite files, not paid requests.

Official references (checked 2026-10-21): [model/pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).
