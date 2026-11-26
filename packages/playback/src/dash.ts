import { xmlEscape } from "./text.ts";
import {
  type AudioTrack,
  type Presentation,
  type PresentationUrls,
  rangeText,
  type VideoTrack,
} from "./tracks.ts";

/**
 * A static, on-demand MPD: one file per representation, read by byte range
 * through `SegmentBase`, so the player uses each file's own index (sidx for
 * MP4, Cues for WebM) and no segment list is needed here.
 */
export function buildMpd(
  presentation: Presentation,
  urls: PresentationUrls,
): string {
  const duration = `PT${presentation.durationSec.toFixed(3)}S`;
  const sets: string[] = [];
  const byMime = groupBy(
    presentation.video,
    (t) => `${t.mimeType}|${t.family}`,
  );
  for (const tracks of byMime.values()) sets.push(videoSet(tracks, urls));
  const byLanguage = groupBy(
    presentation.audio,
    (t) => `${t.language ?? "und"}|${t.mimeType}`,
  );
  for (const tracks of byLanguage.values()) sets.push(audioSet(tracks, urls));
  for (const caption of presentation.captions) {
    sets.push(
      [
        `    <AdaptationSet contentType="text" mimeType="text/vtt" lang="${xmlEscape(caption.language)}">`,
        `      <Label>${xmlEscape(caption.label)}</Label>`,
        `      <Representation id="${xmlEscape(caption.id)}" bandwidth="256">`,
        `        <BaseURL>${xmlEscape(urls.caption(caption))}</BaseURL>`,
        "      </Representation>",
        "    </AdaptationSet>",
      ].join("\n"),
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S" mediaPresentationDuration="${duration}">`,
    `  <Period duration="${duration}">`,
    ...sets,
    "  </Period>",
    "</MPD>",
    "",
  ].join("\n");
}

function videoSet(tracks: VideoTrack[], urls: PresentationUrls): string {
  const first = tracks[0] as VideoTrack;
  return [
    `    <AdaptationSet contentType="video" mimeType="${first.mimeType}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">`,
    ...[...tracks]
      .sort((a, b) => a.bitrate - b.bitrate)
      .map((t) =>
        representation(
          t,
          urls,
          `width="${t.width}" height="${t.height}" frameRate="${t.fps}"`,
        ),
      ),
    "    </AdaptationSet>",
  ].join("\n");
}

function audioSet(tracks: AudioTrack[], urls: PresentationUrls): string {
  const first = tracks[0] as AudioTrack;
  const lang = first.language ? ` lang="${xmlEscape(first.language)}"` : "";
  return [
    `    <AdaptationSet contentType="audio" mimeType="${first.mimeType}"${lang} subsegmentAlignment="true" subsegmentStartsWithSAP="1">`,
    `      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="${first.isOriginal ? "main" : "dub"}"/>`,
    `      <Label>${xmlEscape(first.label)}</Label>`,
    ...[...tracks]
      .sort((a, b) => a.bitrate - b.bitrate)
      .map((t) =>
        representation(t, urls, `audioSamplingRate="${t.sampleRate}"`, [
          `        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${t.channels}"/>`,
        ]),
      ),
    "    </AdaptationSet>",
  ].join("\n");
}

function representation(
  t: VideoTrack | AudioTrack,
  urls: PresentationUrls,
  attributes: string,
  children: string[] = [],
): string {
  return [
    `      <Representation id="${xmlEscape(t.id)}" codecs="${xmlEscape(t.codecs)}" bandwidth="${t.bitrate}" ${attributes}>`,
    ...children,
    `        <BaseURL>${xmlEscape(urls.media(t))}</BaseURL>`,
    `        <SegmentBase indexRange="${rangeText(t.index)}">`,
    `          <Initialization range="${rangeText(t.init)}"/>`,
    "        </SegmentBase>",
    "      </Representation>",
  ].join("\n");
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items)
    out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}
