#!/usr/bin/env python3
"""Build workflow.json: MNOT Slack YouTube links -> OwnTube memos + playlist.

Every 30 minutes the flow searches the metnerdsomtafel Slack (as the user,
search.messages) for messages linking YouTube videos and adds each (message,
video) to OwnTube with memos.add: the message as a Markdown memo ending in a
link to it, and the video in the "MNOT Slack" playlist. OwnTube stores a
(message, video) once, so re-reading overlapping days is harmless: the first
run reads everything search can see, later runs the last 3 days.

    python3 build.py > workflow.json
"""

import json
import uuid
from pathlib import Path

HERE = Path(__file__).parent

CONFIG = {
    "workspace": "metnerdsomtafel",
    "playlistName": "MNOT Slack",
    # OwnTube as n8n on spiff reaches it (home tier).
    "owntube": "https://owntube.home.nedworks.org",
    # Slack search has no OR: one query per spelling, merged by permalink.
    "queries": ["youtube", "youtu.be"],
}

SLACK_CREDENTIAL = {"id": "mnotSlackUser01", "name": "Slack user token (MNOT memos)"}
OWNTUBE_CREDENTIAL = {
    "id": "owntubeMemosToken01",
    "name": "OwnTube memos token (MNOT Slack)",
}

LIB = (HERE / "slack-memos.js").read_text()
LIB = LIB[: LIB.index('if (typeof module !== "undefined")')].rstrip()


def node_id(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mnot-slack-memos/{name}"))


def node(name, type_, version, position, parameters, **extra):
    return {
        "id": node_id(name),
        "name": name,
        "type": type_,
        "typeVersion": version,
        "position": position,
        "parameters": parameters,
        **extra,
    }


CONFIG_CODE = f"""// What to read and where to put it.
const config = {json.dumps(CONFIG, indent=2)};
const state = $getWorkflowStaticData('global');
const startedAt = new Date().toISOString();
// First run: everything search can see; then from a few days back.
const after = state.after ? ` after:${{state.after}}` : '';
return config.queries.map((q) => ({{ json: {{ ...config, startedAt, query: `${{q}}${{after}}` }} }}));
"""

BUILD_CODE = f"""{LIB}

const config = $('Config').first().json;
const names = {{}};
for (const page of $('Slack users').all()) {{
  if (page.json.ok !== true) throw new Error(`Slack users.list: ${{page.json.error}}`);
  for (const u of page.json.members ?? []) names[u.id] = displayName(u);
}}
const matches = [];
for (const page of $input.all()) {{
  if (page.json.ok !== true) throw new Error(`Slack search.messages: ${{page.json.error}}`);
  matches.push(...(page.json.messages?.matches ?? []));
}}
const inputs = memoInputs(matches, names, config);
if (inputs.length === 0) {{
  // Nothing to add, so nothing can fail: move the search window on.
  $getWorkflowStaticData('global').after = searchAfter(config.startedAt, 3);
}}
return inputs.map((payload) => ({{ json: {{ payload }} }}));
"""

FINISH_CODE = f"""{LIB}

const results = $input.all();
const failed = results.filter((r) => r.json.error);
const created = results.filter((r) => r.json.result?.data?.json?.created).length;
if (failed.length > 0) {{
  // Keep the search window, so the next run tries these again.
  const sample = failed.slice(0, 3).map((r) => JSON.stringify(r.json.error).slice(0, 300));
  throw new Error(`${{failed.length}} of ${{results.length}} memos failed: ${{sample.join(' | ')}}`);
}}
const config = $('Config').first().json;
const after = searchAfter(config.startedAt, 3);
$getWorkflowStaticData('global').after = after;
return [{{ json: {{ memos: results.length, created, nextSearchAfter: after }} }}];
"""

nodes = [
    node(
        "Every 30 minutes",
        "n8n-nodes-base.scheduleTrigger",
        1.2,
        [0, 0],
        {"rule": {"interval": [{"field": "minutes", "minutesInterval": 30}]}},
    ),
    node(
        "Slack users",
        "n8n-nodes-base.httpRequest",
        4.2,
        [220, 0],
        {
            "url": "https://slack.com/api/users.list",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "slackApi",
            "sendQuery": True,
            "queryParameters": {"parameters": [{"name": "limit", "value": "200"}]},
            "options": {
                "pagination": {
                    "pagination": {
                        "parameters": {
                            "parameters": [
                                {
                                    "name": "cursor",
                                    "value": "={{ $response.body.response_metadata.next_cursor }}",
                                }
                            ]
                        },
                        "paginationCompleteWhen": "other",
                        "completeExpression": "={{ $response.body.ok !== true || !$response.body.response_metadata?.next_cursor }}",
                        "limitPagesFetched": True,
                        "maxRequests": 50,
                        "requestInterval": 1500,
                    }
                }
            },
        },
        credentials={"slackApi": SLACK_CREDENTIAL},
    ),
    node(
        "Config",
        "n8n-nodes-base.code",
        2,
        [440, 0],
        {"jsCode": CONFIG_CODE},
    ),
    node(
        "Search messages",
        "n8n-nodes-base.httpRequest",
        4.2,
        [660, 0],
        {
            "url": "https://slack.com/api/search.messages",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "slackApi",
            "sendQuery": True,
            "queryParameters": {
                "parameters": [
                    {"name": "query", "value": "={{ $json.query }}"},
                    {"name": "count", "value": "100"},
                    {"name": "sort", "value": "timestamp"},
                    {"name": "sort_dir", "value": "asc"},
                ]
            },
            "options": {
                "pagination": {
                    "pagination": {
                        "parameters": {
                            "parameters": [
                                {"name": "page", "value": "={{ $pageCount + 1 }}"}
                            ]
                        },
                        "paginationCompleteWhen": "other",
                        "completeExpression": "={{ $response.body.ok !== true || $response.body.messages.paging.page >= $response.body.messages.paging.pages }}",
                        "limitPagesFetched": True,
                        "maxRequests": 100,
                        # search.messages is Slack rate tier 2 (20 a minute).
                        "requestInterval": 3200,
                    }
                }
            },
        },
        credentials={"slackApi": SLACK_CREDENTIAL},
    ),
    node(
        "Build memos",
        "n8n-nodes-base.code",
        2,
        [880, 0],
        {"jsCode": BUILD_CODE},
    ),
    node(
        "Add memo",
        "n8n-nodes-base.httpRequest",
        4.2,
        [1100, 0],
        {
            "method": "POST",
            "url": "={{ $('Config').first().json.owntube }}/api/trpc/memos.add",
            "authentication": "genericCredentialType",
            "genericAuthType": "httpHeaderAuth",
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify({ json: $json.payload }) }}",
            "options": {
                "batching": {"batch": {"batchSize": 1, "batchInterval": 200}},
                "timeout": 30000,
            },
        },
        credentials={"httpHeaderAuth": OWNTUBE_CREDENTIAL},
        onError="continueRegularOutput",
    ),
    node(
        "Finish",
        "n8n-nodes-base.code",
        2,
        [1320, 0],
        {"jsCode": FINISH_CODE},
    ),
]

order = [n["name"] for n in nodes]
connections = {
    a: {"main": [[{"node": b, "type": "main", "index": 0}]]}
    for a, b in zip(order, order[1:])
}

workflow = {
    "id": "mnotSlackMemos01",
    "name": "OwnTube: MNOT Slack YouTube links → memos",
    "active": False,
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": "Europe/Amsterdam"},
    "pinData": {},
}

print(json.dumps(workflow, indent=2, ensure_ascii=False))
