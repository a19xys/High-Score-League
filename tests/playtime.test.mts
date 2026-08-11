import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPlayerPlayTime } from "../lib/data/player-playtime.ts";
import { formatPlayTime } from "../lib/playtime.ts";
import { validatePlayTimePayload } from "../lib/playtime-contract.ts";

const validEvent = {
  schemaVersion: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  weekId: "22222222-2222-4222-8222-222222222222",
  gameKey: "space-invaders",
  rom: "invaders",
  mode: "practice",
  startedAt: "2026-08-11T10:00:00.000Z",
  endedAt: "2026-08-11T10:01:00.000Z",
  durationSeconds: 60,
  clientVersion: "0.1.0",
};

test("web formatter matches the launcher Playtime contract", () => {
  assert.deepEqual(
    [0, 30, 60, 480, 6600, 7199, 7200, 12240, 46080].map(formatPlayTime),
    ["0 min", "0 min", "1 min", "8 min", "110 min", "119 min", "2,0 h", "3,4 h", "12,8 h"],
  );
});

test("launcher payload validation rejects authority and malformed fields", () => {
  assert.equal(validatePlayTimePayload(validEvent).ok, true);
  const authority = validatePlayTimePayload({ ...validEvent, playerId: validEvent.eventId });
  assert.equal(authority.ok, false);
  if (!authority.ok) assert.match(authority.error, /no se acepta/);
  for (const patch of [
    { schemaVersion: 2 }, { eventId: "bad" }, { weekId: "bad" }, { gameKey: "" },
    { mode: "ranked" }, { durationSeconds: 0 }, { durationSeconds: 604801 },
    { startedAt: "2026-08-11" }, { endedAt: "2020-01-01T00:00:00Z" },
  ]) assert.equal(validatePlayTimePayload({ ...validEvent, ...patch }).ok, false);
});

function supabaseTotal(total: number | string | null) {
  let queries = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { queries += 1; return { data: total === null ? null : { total_seconds: total } }; },
  };
  return { client: { from: () => query }, get queries() { return queries; } };
}

test("Playtime privacy never queries or returns a private value to another player", async () => {
  const hidden = supabaseTotal(46080);
  const result = await getPlayerPlayTime(hidden.client as never, "player", { isOwner: false, playTimePublic: false });
  assert.deepEqual(result, { visibility: "private" });
  assert.equal(hidden.queries, 0);
  assert.equal("totalSeconds" in result, false);

  const legacyTrue = await getPlayerPlayTime(hidden.client as never, "player", { isOwner: false, playTimePublic: false });
  assert.deepEqual(legacyTrue, { visibility: "private" }, "legacy track_play_time=true is intentionally irrelevant");
});

test("owner and public readers see RLS-backed totals; absent aggregate is zero", async () => {
  const owner = supabaseTotal("12240");
  assert.deepEqual(await getPlayerPlayTime(owner.client as never, "player", { isOwner: true, playTimePublic: false }), {
    visibility: "visible", totalSeconds: 12240,
  });
  const visible = supabaseTotal(7200);
  assert.deepEqual(await getPlayerPlayTime(visible.client as never, "player", { isOwner: false, playTimePublic: true }), {
    visibility: "visible", totalSeconds: 7200,
  });
  const empty = supabaseTotal(null);
  assert.deepEqual(await getPlayerPlayTime(empty.client as never, "player", { isOwner: true, playTimePublic: false }), {
    visibility: "visible", totalSeconds: 0,
  });
});

test("migrations keep Playtime transactional and idempotent while changing only the new-profile default", async () => {
  const [sql, defaults] = await Promise.all([
    readFile(join(process.cwd(), "supabase/migrations/0025_play_time.sql"), "utf8"),
    readFile(join(process.cwd(), "supabase/migrations/0029_profile_privacy_defaults.sql"), "utf8"),
  ]);
  assert.match(sql, /play_time_public boolean not null default false/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles[\s\S]*track_play_time/i);
  assert.match(sql, /primary key \(player_id, event_id\)/i);
  assert.match(sql, /from public\.weeks week[\s\S]*week\.id = p_week_id/i);
  assert.doesNotMatch(sql, /season_memberships/i);
  assert.doesNotMatch(sql, /week\.status/i);
  assert.match(sql, /on conflict \(player_id, event_id\) do nothing/i);
  assert.match(sql, /player_game_play_time\.total_seconds \+ excluded\.total_seconds/i);
  assert.match(sql, /player_play_time_totals\.total_seconds \+ excluded\.total_seconds/i);
  assert.match(sql, /player_id = auth\.uid\(\)[\s\S]*play_time_public = true/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(defaults, /alter column play_time_public set default true/i);
  assert.doesNotMatch(defaults, /update\s+public\.profiles/i);
});

test("profile UI has a fifth card and persists only the new visibility preference", async () => {
  const [stats, editor, route] = await Promise.all([
    readFile(join(process.cwd(), "components/profile/profile-stats.tsx"), "utf8"),
    readFile(join(process.cwd(), "components/profile/profile-editor.tsx"), "utf8"),
    readFile(join(process.cwd(), "app/api/launcher/playtime/ingest/route.ts"), "utf8"),
  ]);
  assert.match(stats, /lg:grid-cols-5/);
  assert.match(stats, /Esta información no se muestra al resto/);
  assert.match(editor, /play_time_public: !hidePlayTime/);
  assert.match(editor, /profile\?\.play_time_public === false/);
  assert.match(editor, /Ocultar mi tiempo de juego/);
  assert.doesNotMatch(editor, /track_play_time:\s*trackPlayTime/);
  assert.match(route, /supabase\.rpc\("ingest_play_time_event"/);
  assert.doesNotMatch(route, /season_memberships|weekly_results|submissions/);
});

test("launcher integration uses existing lifecycle triggers without Playtime polling or score queue coupling", async () => {
  const [main, service, mame, sync, store] = await Promise.all([
    readFile(join(process.cwd(), "local/hsl-local-app/gui/main.js"), "utf8"),
    readFile(join(process.cwd(), "local/hsl-local-app/gui/launcher-service.js"), "utf8"),
    readFile(join(process.cwd(), "local/hsl-local-app/src/mame-launcher.js"), "utf8"),
    readFile(join(process.cwd(), "local/hsl-local-app/src/playtime-sync-service.js"), "utf8"),
    readFile(join(process.cwd(), "local/hsl-local-app/src/playtime-store.js"), "utf8"),
  ]);
  assert.match(mame, /child\.on\("spawn"/);
  assert.match(mame, /child\.on\("close"/);
  assert.match(service, /createMamePlayTimeLifecycle\(context, mode\)/);
  assert.match(service, /createMameOperationLifecycle\(context, "practice"\)/);
  assert.match(service, /createMameOperationLifecycle\(context, "competition"\)/);
  assert.match(service, /playTime: formatPlayTime\(totalSeconds\)/);
  assert.match(main, /service\.pausePlayTime\(\)/);
  assert.match(main, /service\.resumePlayTime\(\)/);
  assert.match(main, /service\.shutdownPlayTime\(\)/);
  assert.doesNotMatch(main, /setInterval\([^)]*playtime/is);
  assert.doesNotMatch(`${sync}\n${store}`, /eventsPendingDir|submission|membership/i);
  assert.match(sync, /readKnownAccounts/);
  assert.match(sync, /for \(const account of accounts\.accounts/);
});
