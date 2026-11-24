import { describe, expect, it } from "vitest";
import { channelTags, users } from "@/server/db/schema";
import { upsertUserSettings } from "@/server/settings/profile";
import { filterChannelIdsByTags } from "@/server/subscriptions/tag-filter";
import { createTestDb } from "@/test/db";

function setup() {
  const { db, sqlite } = createTestDb();
  const ts = Math.floor(Date.now() / 1000);
  const user = db
    .insert(users)
    .values({
      email: "tags@example.com",
      passwordHash: "x",
      createdAt: ts,
      updatedAt: ts,
    })
    .returning({ id: users.id })
    .get();
  const tag = (channelId: string, ...tags: string[]) => {
    for (const t of tags) {
      db.insert(channelTags)
        .values({ userId: user.id, channelId, tag: t, createdAt: ts })
        .run();
    }
  };
  tag("UCa", "music", "live");
  tag("UCb", "music");
  tag("UCc", "news", "favorite");
  tag("UCd", "music", "favorite");
  return { db, sqlite, userId: user.id };
}

const ALL = ["UCa", "UCb", "UCc", "UCd", "UCe"];

describe("filterChannelIdsByTags", () => {
  it("keeps every channel without a filter", () => {
    const { db, sqlite, userId } = setup();
    expect(filterChannelIdsByTags(db, userId, ALL, {})).toEqual(ALL);
    sqlite.close();
  });

  it("matches any included tag by default", () => {
    const { db, sqlite, userId } = setup();
    expect(
      filterChannelIdsByTags(db, userId, ALL, {
        includeTags: ["live", "news"],
      }),
    ).toEqual(["UCa", "UCc"]);
    sqlite.close();
  });

  it("needs every included tag with tagMatch all", () => {
    const { db, sqlite, userId } = setup();
    expect(
      filterChannelIdsByTags(db, userId, ALL, {
        includeTags: ["music", "live"],
        tagMatch: "all",
      }),
    ).toEqual(["UCa"]);
    sqlite.close();
  });

  it("drops excluded tags", () => {
    const { db, sqlite, userId } = setup();
    expect(
      filterChannelIdsByTags(db, userId, ALL, {
        includeTags: ["music"],
        excludeTags: ["live"],
      }),
    ).toEqual(["UCb", "UCd"]);
    sqlite.close();
  });

  it("resolves favorites to the configured favorite tag", () => {
    const { db, sqlite, userId } = setup();
    expect(
      filterChannelIdsByTags(db, userId, ALL, { favorites: true }),
    ).toEqual(["UCc", "UCd"]);
    upsertUserSettings(db, userId, { favoriteTag: "#Music" });
    expect(
      filterChannelIdsByTags(db, userId, ALL, { favorites: true }),
    ).toEqual(["UCa", "UCb", "UCd"]);
    sqlite.close();
  });

  it("narrows favorites by other included tags", () => {
    const { db, sqlite, userId } = setup();
    expect(
      filterChannelIdsByTags(db, userId, ALL, {
        favorites: true,
        includeTags: ["music"],
      }),
    ).toEqual(["UCd"]);
    sqlite.close();
  });
});
