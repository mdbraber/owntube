# MNOT Slack → OwnTube memos

An n8n flow (on spiff, `n8n.nedworks.org`) that finds the YouTube videos
shared in the **metnerdsomtafel** Slack and adds each one to OwnTube:

- the video goes into the playlist **MNOT Slack** (created on first use);
- a memo on the video holds the Slack message, converted to Markdown, and
  ends with `[View in Slack](<permalink>)`; its header shows who posted it,
  in which channel, and when.

A message that links several videos gives each of them a memo. OwnTube
stores a (message, video) once, so the flow can re-read overlapping days and
retry failures without duplicates.

## How it works

`Every 30 minutes` → `Slack users` (users.list, for names) → `Config` →
`Search messages` (search.messages for `youtube` and `youtu.be`, 100 per
page, 3.2 s apart for Slack's rate limit) → `Build memos` → `Add memo`
(`POST /api/trpc/memos.add`, one at a time) → `Finish`.

The first run reads everything Slack search can see (on a free Slack plan:
the last 90 days). Later runs search from three days before the previous
successful run (`after:` in workflow static data, which n8n keeps only for
scheduled runs, not manual ones). When a memo fails, `Finish` fails the
execution and keeps the window, so the next run tries again.

Direct messages and group DMs are skipped. Public channels are searched even
when you're not in them; private channels only when you are.

## Setup

1. **Slack app with a user token.** At <https://api.slack.com/apps> →
   *Create New App* → *From a manifest*, workspace **metnerdsomtafel**:

   ```yaml
   display_information:
     name: OwnTube memos
     description: Copies YouTube links shared in Slack into OwnTube.
   oauth_config:
     scopes:
       user:
         - search:read
         - users:read
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

   *Install to Workspace* (a workspace admin may need to approve it), then
   copy the **User OAuth Token** (`xoxp-…`) from *OAuth & Permissions*. It
   reads as you, so it sees what you see.

2. **OwnTube token.** OwnTube → Settings → API tokens → name it
   "n8n MNOT Slack", scope **Add memos** → copy the `ot_…` token.

3. **n8n credentials** (imported empty by the deploy, named below): open each
   in n8n and paste the value.
   - *Slack user token (MNOT memos)* (Slack API): Access Token = `xoxp-…`.
   - *OwnTube memos token (MNOT Slack)* (Header Auth): Name `Authorization`,
     Value `Bearer ot_…`.

4. Open the workflow, run it once by hand to check (a manual run adds the
   memos but doesn't move the search window), then activate it.

## Changing it

Edit `build.py` / `slack-memos.js`, then:

```sh
node --test slack-memos.test.mjs
python3 build.py > workflow.json
```

Deploy on spiff (docker needs root): export the live workflow first and diff
it for edits made in the UI, then `docker cp workflow.json n8n:/tmp/`,
`docker exec n8n n8n import:workflow --input=/tmp/workflow.json`,
`docker exec n8n n8n publish:workflow --id=mnotSlackMemos01` (if it was
active) and `docker restart n8n`. Re-importing never touches credentials.
