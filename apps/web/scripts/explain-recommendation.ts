/**
 * Explains why a given video is (or is not) recommended for a user by replaying
 * the full home-feed pool pipeline (engine.ts): collect tagged candidates, drop
 * keyword spam, score + discount, expand with related candidates, then locate
 * the target and dump its provenance, score breakdown, matched taste terms and
 * rank. Diversity (MMR) re-ordering is the only step skipped — it answers "why
 * this is in the pool and at what score", not the exact on-screen slot.
 *
 * Usage: pnpm exec tsx scripts/explain-recommendation.ts <videoId> [userId]
 */
import { stripRestrictedListVideos } from "../src/lib/feed-exclude-restricted";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
} from "../src/lib/published-sort-key";
import { getDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import {
  expandScoredPoolWithRelatedCandidates,
  HOME_RELATED_LIMITS,
} from "../src/server/recommendation/collect-related-candidates";
import { collectTaggedVideoCandidates } from "../src/server/recommendation/collect-tagged-candidates";
import { dailyExploreSeed } from "../src/server/recommendation/deterministic-jitter";
import { deriveRecommendationReason } from "../src/server/recommendation/reason";
import {
  isUnvettedKeywordSpam,
  keywordDiscoveryScorePenalty,
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "../src/server/recommendation/scoring";
import {
  collectUserSignals,
  dislikeCorpusVideoIds,
} from "../src/server/recommendation/signals";
import {
  buildKeywordCorpus,
  buildTasteCorpusTitles,
  readCachedDetailTitlesForVideos,
  readCachedDislikeTitlesOrdered,
} from "../src/server/recommendation/taste-corpus";
import {
  buildTfidfModel,
  termFrequencyVector,
} from "../src/server/recommendation/tfidf";
import type { ScoredVideo } from "../src/server/recommendation/types";
import { fetchVideoDetail } from "../src/server/services/proxy";
import type { UnifiedVideo } from "../src/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
} from "../src/server/settings/profile";

async function main() {
  const videoId = process.argv[2]?.trim();
  if (!videoId) {
    console.error(
      "Usage: pnpm exec tsx scripts/explain-recommendation.ts <videoId> [userId]",
    );
    process.exit(1);
  }
  const db = getDb();

  const userIdArg = process.argv[3]?.trim();
  const userId = userIdArg
    ? Number.parseInt(userIdArg, 10)
    : db
        .select({ id: users.id })
        .from(users)
        .orderBy(users.id)
        .limit(1)
        .all()[0]?.id;
  if (!userId) {
    console.error("No user found in the database (pass a userId explicitly).");
    process.exit(1);
  }
  console.log(
    `\n=== Explain recommendation: ${videoId} (userId=${userId}) ===\n`,
  );

  const userSettings = getUserSettings(db, userId);
  const region = userSettings.trendingRegion ?? "US";
  const overrides = getUserProxyOverrides(db, userId);
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Collect the tagged candidate pool (history channels, subs, trending,
  //    keyword searches) exactly like the engine.
  const signals = collectUserSignals(db, userId, { excludeShorts: true });
  const { tagged, recentCoverageByChannel, coldStart } =
    await collectTaggedVideoCandidates(db, userId, {
      region,
      overrides,
      signals,
      tasteKeywords: userSettings.tasteKeywords,
    });

  const { byId, sourceByVideoId } = mergeVideosByIdPreferNewer(tagged, nowSec);
  const blocked = new Set(userSettings.blockedRecommendationChannels);
  const watchedEver = new Set(signals.watchedVideoIds);

  const uniqueRaw = pickNewestVideoPerChannel(
    stripRestrictedListVideos(
      [...byId.values()].filter(
        (v) =>
          !watchedEver.has(v.videoId) &&
          !(v.channelId && blocked.has(v.channelId)),
      ),
    ),
    { nowSec, maxPerChannel: 1 },
  );

  // 2. Build the exact taste / dislike models the engine uses.
  const tasteVideoIds = Array.from(
    new Set([...signals.likedVideoIds, ...signals.savedVideoIds]),
  );
  const tasteTitles = readCachedDetailTitlesForVideos(db, tasteVideoIds, 72);
  const keywordCorpus = buildKeywordCorpus(userSettings.tasteKeywords);
  const poolTitles = uniqueRaw.map((v) => v.title).slice(0, 200);
  const corpusTitles = buildTasteCorpusTitles([
    keywordCorpus,
    tasteTitles,
    poolTitles,
  ]);
  const tasteModel = buildTfidfModel(corpusTitles, {
    groups: [keywordCorpus, tasteTitles],
  });
  const dislikeModel = buildTfidfModel(
    readCachedDislikeTitlesOrdered(db, dislikeCorpusVideoIds(signals), 48),
  );
  const maxCh = Math.max(1, ...signals.channelWeights.values());
  const scoreContext: RecommendationScoreContext = {
    recentCoverageByChannel,
    exploreSeed: dailyExploreSeed(userId, Math.floor(Date.now() / 1000)),
  };
  const interestChannelIds = new Set([
    ...signals.historyChannelIds,
    ...signals.interactionInterestChannelIds,
  ]);

  // 3. Score the vetted pool (drop keyword spam, apply the keyword discount),
  //    then expand with related candidates — same order as the engine.
  const droppedAsSpamIds = new Set<string>();
  const vetted = uniqueRaw.filter((v) => {
    const spam = isUnvettedKeywordSpam(
      v,
      signals,
      tasteModel,
      sourceByVideoId.get(v.videoId),
      interestChannelIds,
    );
    if (spam) droppedAsSpamIds.add(v.videoId);
    return !spam;
  });
  let scored: ScoredVideo[] = vetted.map((v) => {
    const d = scoreCandidateDetail(
      v,
      signals,
      tasteModel,
      maxCh,
      scoreContext,
      dislikeModel,
    );
    const source = sourceByVideoId.get(v.videoId);
    const penalty = keywordDiscoveryScorePenalty(
      v,
      signals,
      tasteModel,
      source,
      interestChannelIds,
    );
    return {
      ...v,
      recommendationReason: deriveRecommendationReason(
        d.breakdown,
        v,
        tasteModel,
        source,
      ),
      rawScore: d.score - penalty,
      scoreBreakdown: d.breakdown,
      candidateSource: source,
      titleVector: termFrequencyVector(v.title),
    };
  });
  scored.sort((a, b) => b.rawScore - a.rawScore);

  const { scored: expandedScored } =
    await expandScoredPoolWithRelatedCandidates({
      db,
      scored,
      coldStart,
      limits: HOME_RELATED_LIMITS,
      overrides,
      excludeVideoIds: watchedEver,
      signals,
      tasteModel,
      dislikeModel,
      maxCh,
      scoreContext,
    });
  scored = expandedScored;
  scored.sort((a, b) => b.rawScore - a.rawScore);

  // 4. Locate the target in the final pool; fall back to a standalone fetch.
  const pooled = scored.find((s) => s.videoId === videoId);
  const rank = scored.findIndex((s) => s.videoId === videoId);
  let target: UnifiedVideo | undefined = pooled;
  let candidateSource = pooled?.candidateSource;

  if (!target) {
    if (droppedAsSpamIds.has(videoId)) {
      console.log(
        "Video was collected but DROPPED as keyword spam (stuffed title + unknown channel) — it no longer reaches the feed.\n",
      );
    } else {
      console.log(
        "Video is NOT in the current pool (not even via related expansion) — fetching detail to score it standalone.\n",
      );
    }
    candidateSource = sourceByVideoId.get(videoId);
    try {
      const detail = await fetchVideoDetail(db, { videoId }, overrides);
      target = {
        videoId: detail.videoId,
        title: detail.title,
        channelId: detail.channelId,
        channelName: detail.channelName,
        channelAvatarUrl: detail.channelAvatarUrl,
        thumbnailUrl: detail.thumbnailUrl,
        durationSeconds: detail.durationSeconds,
        viewCount: detail.viewCount,
        publishedText: detail.publishedText,
        publishedAt: detail.publishedAt,
        isLive: detail.isLive,
        isUpcoming: detail.isUpcoming,
      };
    } catch (e) {
      console.log(
        `Could not fetch this video's detail upstream: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      console.log(
        "=> The video is likely deleted, private, age/region-restricted, or the upstream is momentarily down.",
      );
      console.log(
        "   It is not currently in your recommendation pool, so the engine would not surface it now.\n",
      );
      return;
    }
  }

  const detail = scoreCandidateDetail(
    target,
    signals,
    tasteModel,
    maxCh,
    scoreContext,
    dislikeModel,
  );
  const reason =
    pooled?.recommendationReason ??
    deriveRecommendationReason(
      detail.breakdown,
      target,
      tasteModel,
      candidateSource,
    );
  const keywordPenalty = keywordDiscoveryScorePenalty(
    target,
    signals,
    tasteModel,
    candidateSource,
    interestChannelIds,
  );
  const finalScore = pooled?.rawScore ?? detail.score - keywordPenalty;

  console.log("Title:        ", target.title);
  console.log(
    "Channel:      ",
    target.channelName ?? "(unknown)",
    target.channelId ? `(${target.channelId})` : "",
  );
  console.log("Views:        ", target.viewCount ?? "(unknown)");
  console.log(
    "Published:    ",
    target.publishedText ?? target.publishedAt ?? "(unknown)",
  );
  console.log("In pool:      ", Boolean(pooled));
  console.log(
    "Source:       ",
    candidateSource ?? "(not collected — standalone scoring)",
  );
  console.log(
    "Dropped as keyword spam:",
    droppedAsSpamIds.has(videoId) ? "YES — removed from pool entirely" : "no",
  );
  console.log("Keyword penalty:", keywordPenalty.toFixed(4));
  console.log("Final score:  ", finalScore.toFixed(4));
  console.log(
    "Final rank:   ",
    rank >= 0
      ? `#${rank + 1} of ${scored.length} (pre-MMR)`
      : "n/a (not in pool)",
  );
  console.log("Already watched:", watchedEver.has(videoId));
  console.log("\n--- Final reason shown in UI ---");
  console.log(JSON.stringify(reason ?? null, null, 2));

  console.log("\n--- Score components (raw, pre keyword discount) ---");
  const c = detail.breakdown.components;
  const sorted = Object.entries(c).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  for (const [name, value] of sorted) {
    const bar =
      value === 0
        ? ""
        : value > 0
          ? "+".repeat(Math.min(40, Math.round(value * 80)))
          : "-".repeat(Math.min(40, Math.round(-value * 80)));
    console.log(
      `  ${name.padEnd(18)} ${value >= 0 ? " " : ""}${value.toFixed(4)}  ${bar}`,
    );
  }

  console.log("\n--- Matched taste terms (TF-IDF) ---");
  const terms = tasteModel.explain(target.title, 8);
  console.log(
    terms.length > 0
      ? terms.join(", ")
      : "(none — title shares no terms with your taste corpus)",
  );

  console.log("\n--- Channel affinity ---");
  const chWeight = target.channelId
    ? (signals.channelWeights.get(target.channelId) ?? 0)
    : 0;
  console.log(
    `  raw weight: ${chWeight}  /  max channel weight: ${maxCh}  =>  normalized ${detail.breakdown.inputs.channelAffinityNorm.toFixed(4)}`,
  );
  console.log(
    `  configured keywords: ${userSettings.tasteKeywords.length > 0 ? userSettings.tasteKeywords.join(", ") : "(none)"}`,
  );

  console.log("\n--- Pool top 25 (final score, pre-MMR) ---");
  for (const [i, r] of scored.slice(0, 25).entries()) {
    const mark = r.videoId === videoId ? " <==" : "";
    console.log(
      `  ${String(i + 1).padStart(2)}. ${r.rawScore.toFixed(3)}  [${(r.candidateSource ?? "?").padEnd(22)}] ${r.title.slice(0, 54)}${mark}`,
    );
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
