// Pure helpers for the "MNOT Slack → OwnTube memos" n8n flow. build.py pastes
// this file into the flow's Code node; slack-memos.test.mjs tests it with Node.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MEMO_TEXT_BUDGET = 4500; // OwnTube accepts 5000; leave room for the link

/**
 * The YouTube video id a URL points at, or null. Parsed by hand: n8n's Code
 * node sandbox has no URL global (new URL() throws there).
 */
function youtubeVideoId(raw) {
  const m = String(raw)
    .replace(/&amp;/g, "&")
    .match(/^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)(\?[^#]*)?/i);
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^(www|m|music)\./, "");
  const path = m[2] ?? "";
  const query = m[3] ?? "";
  let id = null;
  if (host === "youtu.be") {
    id = path.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "watch") {
      const v = query.match(/[?&]v=([^&]+)/);
      id = v ? v[1] : null;
    } else if (["shorts", "live", "embed", "v"].includes(parts[0])) {
      id = parts[1] ?? null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Every distinct video a Slack message links to, in order of appearance. */
function videoIdsInMessage(message) {
  const sources = [message.text ?? ""];
  for (const a of message.attachments ?? []) {
    sources.push(a.from_url ?? "", a.original_url ?? "", a.title_link ?? "");
  }
  const ids = [];
  for (const s of sources) {
    for (const m of s.matchAll(/https?:\/\/[^\s|>]+/g)) {
      const id = youtubeVideoId(m[0]);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** A Slack user's name as people see it. */
function displayName(user) {
  const p = user.profile ?? {};
  return (
    p.display_name || p.real_name || user.real_name || user.name || user.id
  );
}

/**
 * Slack mrkdwn to Markdown: links, mentions, channels, *bold*, ~strike~,
 * entities and line breaks. _italic_, `code`, ```blocks``` and > quotes mean
 * the same in both.
 */
function slackToMarkdown(text, namesById) {
  let t = text ?? "";
  t = t.replace(
    /<(https?:\/\/[^|>]+)\|([^>]+)>/g,
    (_, url, label) => `[${label.replace(/[[\]]/g, "")}](${url})`,
  );
  t = t.replace(/<(https?:\/\/[^|>]+)>/g, "$1");
  t = t.replace(/<mailto:([^|>]+)\|([^>]+)>/g, "[$2](mailto:$1)");
  t = t.replace(
    /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g,
    (_, id, name) => `@${namesById[id] ?? name ?? id}`,
  );
  t = t.replace(/<#C[A-Z0-9]+\|([^>]*)>/g, "#$1");
  t = t.replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1");
  t = t.replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, "$1");
  t = t.replace(
    /(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,;:!?]|$)/gm,
    "$1**$2**",
  );
  t = t.replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=[\s).,;:!?]|$)/gm, "$1~~$2~~");
  t = t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  // Slack keeps single line breaks; Markdown needs them marked.
  return t.replace(/([^\n])\n(?!\n)/g, "$1  \n").trim();
}

/** The memo text: the message as Markdown, then a link to it. */
function memoText(message, namesById) {
  let body = slackToMarkdown(message.text, namesById);
  if (body.length > MEMO_TEXT_BUDGET) {
    body = `${body.slice(0, MEMO_TEXT_BUDGET).trimEnd()}…`;
  }
  const link = `[View in Slack](${message.permalink})`;
  return body ? `${body}\n\n${link}` : link;
}

/**
 * memos.add inputs for search matches: one per (message, video), skipping
 * direct messages, deduplicated by permalink.
 */
function memoInputs(matches, namesById, config) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const ch = m.channel ?? {};
    if (ch.is_im || ch.is_mpim || !m.permalink || seen.has(m.permalink))
      continue;
    seen.add(m.permalink);
    const ids = videoIdsInMessage(m);
    if (ids.length === 0) continue;
    const author = namesById[m.user] ?? m.username ?? undefined;
    for (const videoId of ids) {
      out.push({
        videoId,
        text: memoText(m, namesById),
        occurredAt: String(m.ts),
        source: {
          kind: "slack",
          url: m.permalink,
          ...(ch.name ? { label: `#${ch.name}` } : {}),
          ...(author ? { author } : {}),
          workspace: config.workspace,
        },
        playlistName: config.playlistName,
      });
    }
  }
  return out;
}

/** YYYY-MM-DD, `days` before `iso`: the next run's `after:` search bound. */
function searchAfter(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

if (typeof module !== "undefined") {
  module.exports = {
    youtubeVideoId,
    videoIdsInMessage,
    displayName,
    slackToMarkdown,
    memoText,
    memoInputs,
    searchAfter,
  };
}
