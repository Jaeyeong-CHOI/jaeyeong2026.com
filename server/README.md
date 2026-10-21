# Homepage chat API

Static frontend: `web/chat-widget.js` and `web/chat-widget.css`, deployed by GitHub Pages. Backend: Node 26, built-in HTTP/fetch/SQLite, bound to `127.0.0.1:5212` behind a dedicated Cloudflare Tunnel at `chat-api.jaeyeong2026.com`. No package install required.

## Private runtime files (never commit or place in web/)

- `~/.config/jaeyeong2026-chat/secrets.env`: `OPENAI_API_KEY`, persistent random `CHAT_IDENTITY_SALT` (at least 32 chars), mode 600.
- `~/.config/jaeyeong2026-chat/config.json`: enabled/promptReady flags, port, origin allowlist, promptFile, dbPath. `localTest` must remain false in production.
- `~/.config/jaeyeong2026-chat/system-prompt.md`: final server-side instructions, maximum 16 KB.
- `~/.local/share/jaeyeong2026-chat/usage.sqlite`: counters and conservative cost reservations, mode 600.

Launch with `node --env-file=<private secrets.env> server/server.mjs`. macOS service labels: `ai.openclaw.jaeyeong-chat` and `ai.openclaw.cloudflared.jaeyeong-chat`. Both restart at login or process failure. The Mac must remain running and connected.

## Prompt handoff / kill switch

The initial deployment is **disabled**, displaying Coming soon. After installing the final prompt in the private file, run:

```sh
/opt/homebrew/bin/node server/manage.mjs enable
/opt/homebrew/bin/node server/manage.mjs status
```

`enable` rejects the pending placeholder and restarts the local service. After editing an already-active prompt, rerun `enable` to load it. Immediate stop for new requests:

```sh
/opt/homebrew/bin/node server/manage.mjs disable
```

Do not reset the salt/database to clear limits. There is no public administration endpoint.

## Cost and abuse controls

- Fixed `gpt-6-luna`, reasoning `none`, Standard tier, `store:false`, text only, 400 maximum output tokens; no tools, model override, automatic retry, or expensive fallback.
- Per IP: 5 requests per rolling minute, 20 per day. IPv6 grouped by /64. Shared networks share quota.
- Global: 10/minute, 200/day, 3,000/month; 2 concurrent provider calls, 1 per IP.
- Conservative reserved budget: $0.25/day and $3/month. KST day/month boundaries. All attempts that reach the provider count, including failures/timeouts.
- Uses UTF-8 byte upper bound plus framing and 20% margin, $0.125/1M input (higher cache-write rate), $0.50/1M output. These application estimates are conservative, not an OpenAI account-wide invoice cap. Recheck prices before changing model/tier. Other uses of the shared key are outside this app's limits.
- SQLite transaction reserves cost/quota before sending. Restarting the server, refreshing, or New chat does not reset limits.
- 1,000 characters per message; 6 history messages/6,000 characters; 32 KB body; 8-second body deadline and 45-second upstream timeout.
- Only exact allowed origins. Production uses `CF-Connecting-IP` through a loopback-only Cloudflare Tunnel, never arbitrary X-Forwarded-For. Do not bind the API to a public/LAN interface or add an untrusted local proxy. Origin checks are not authentication; persistent global caps protect against distributed abuse.

Only HMAC network identities, timestamps, reservation costs and token counts are recorded; no prompts/replies or raw IP addresses in this app's usage DB/logs. Records older than 90 days are pruned at server start. Cloudflare/OpenAI have their own processing policies; `store:false` does not imply zero retention.

## Verification

```sh
/opt/homebrew/bin/node --test server/*.test.mjs
/opt/homebrew/bin/node --check web/chat-widget.js
```

`GET /healthz` -> 200. `GET /v1/status` with allowed Origin reports availability and UI limits. `POST /v1/chat` accepts only `{message, history}`; 429 includes Retry-After; disabled returns 503 without contacting OpenAI. Tests use mocks and temporary SQLite files, not paid requests.

Official references (checked 2026-10-21): [model/pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [Cloudflare client IP](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
