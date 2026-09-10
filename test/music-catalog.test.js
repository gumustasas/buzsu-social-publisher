import test from "node:test";
import assert from "node:assert/strict";
import { MUSIC_CATALOG, MUSIC_CATEGORIES, pickMusicTrack } from "../src/lib/music-catalog.js";

test("MUSIC_CATALOG has exactly the 5 expected categories, each non-empty, totalling 30 tracks", () => {
  assert.deepEqual(Object.keys(MUSIC_CATALOG).sort(), [...MUSIC_CATEGORIES].sort());
  let total = 0;
  for (const category of MUSIC_CATEGORIES) {
    assert.ok(Array.isArray(MUSIC_CATALOG[category]) && MUSIC_CATALOG[category].length > 0, `${category} boş olmamalı`);
    total += MUSIC_CATALOG[category].length;
  }
  assert.equal(total, 30);
});

test("every track has a title and an HTTPS audioUrl", () => {
  for (const tracks of Object.values(MUSIC_CATALOG)) {
    for (const track of tracks) {
      assert.ok(track.title && typeof track.title === "string");
      assert.match(track.audioUrl, /^https:\/\//);
    }
  }
});

test("pickMusicTrack honors an explicit mood and stays within that category", () => {
  const track = pickMusicTrack({ mood: "sinematik", randomImpl: () => 0 });
  assert.equal(track.category, "sinematik");
  assert.ok(MUSIC_CATALOG.sinematik.some((t) => t.audioUrl === track.audioUrl));
});

test("pickMusicTrack ignores an unknown mood and falls back to a random category", () => {
  const track = pickMusicTrack({ mood: "nope", randomImpl: () => 0 });
  assert.equal(track.category, MUSIC_CATEGORIES[0]);
});

test("pickMusicTrack picks a random category when no mood is given, using randomImpl", () => {
  const first = pickMusicTrack({ randomImpl: () => 0 });
  assert.equal(first.category, MUSIC_CATEGORIES[0]);
  const last = pickMusicTrack({ randomImpl: () => 0.999 });
  assert.equal(last.category, MUSIC_CATEGORIES[MUSIC_CATEGORIES.length - 1]);
});

test("pickMusicTrack selects different tracks within a category based on randomImpl", () => {
  const firstTrack = pickMusicTrack({ mood: "sinematik", randomImpl: () => 0 });
  const lastTrack = pickMusicTrack({ mood: "sinematik", randomImpl: () => 0.999 });
  assert.notEqual(firstTrack.audioUrl, lastTrack.audioUrl);
});
