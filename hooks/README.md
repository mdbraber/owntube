# OwnTube playback hooks

OwnTube reports watch events and runs local scripts when they happen. The
server stays generic: it provides the event with enough context to identify
the video, and each script decides whether it cares. Credentials for other
services live in the scripts' environment, never in OwnTube.

## How it works

Every write to watch history (the player's tracker, external reporters —
anything going through `history.upsertEvent`) fires one event through every
executable in `OWNTUBE_HOOKS_DIR`, in lexical order. Shorts are excluded.
The in-app feed publisher additionally re-fires the last 48h of history once
per publish interval with `OT_SOURCE=replay` — the outage-recovery sweep — so **hooks
must be idempotent**: over-delivery has to be harmless.

## The hook contract

Each executable runs once per event with the event as environment variables
and as JSON on stdin:

```
OT_EVENT             watched | progress
OT_VIDEO_ID          the YouTube id
OT_CHANNEL_ID
OT_POSITION_SECONDS
OT_DURATION_SECONDS  0 = unknown
OT_COMPLETED         true | false
OT_VIDEO_TITLE       may be empty
OT_CHANNEL_NAME      may be empty
OT_SOURCE            live | replay
OT_AT                unix seconds
```

Exit status is logged; a failing or slow hook (default timeout 30s,
`OWNTUBE_HOOK_TIMEOUT_MS`) never blocks other hooks or playback.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OWNTUBE_HOOKS_DIR` | *(unset — hooks off)* | Directory of executables (bind-mounted, e.g. `data/hooks`) |
| `OWNTUBE_HOOK_TIMEOUT_MS` | `30000` | Per-hook time limit (also the webhook POST timeout) |
| `OWNTUBE_WEBHOOK_URLS` | *(unset)* | Comma-separated webhook sinks: every event is POSTed as JSON — receivers such as n8n flows subscribe by URL; replays re-deliver, so receivers must be idempotent |
| `OWNTUBE_WEBHOOK_TOKEN` | *(unset)* | Sent as `X-Webhook-Token` so receivers can verify the sender |

Set on the app container; it fires both live events and the replay sweep. Deploy never touches the hooks directory — copy
scripts there and `chmod +x` yourself.

## pcs.sh

Reports watch state to a pocket-sessions server, which maps the video to a
Pocket Casts episode and writes the state through (see pocket-sessions'
`ARCHITECTURE.md` §4). Needs `PCS_PLAYBACK_URL` and `PCS_PLAYBACK_TOKEN` in
the container env. PCS's ahead-only guard makes both live and replay
deliveries idempotent; the hook logs only when a report was actually
applied.
