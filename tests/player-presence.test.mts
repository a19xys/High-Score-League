import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  derivePlayerPresence,
  PRESENCE_TTL_MS,
  type PlayerPresenceSession,
} from "../lib/player-presence.ts";
import {
  validateLauncherPresencePayload,
  validateWebPresencePayload,
} from "../lib/presence-contract.ts";

const now = new Date("2026-08-11T12:00:00.000Z");
const liveAt = new Date(now.getTime() - PRESENCE_TTL_MS).toISOString();
const staleAt = new Date(now.getTime() - PRESENCE_TTL_MS - 1).toISOString();
const session = (overrides: Partial<PlayerPresenceSession> = {}): PlayerPresenceSession => ({
  activity: "connected",
  clientId: "11111111-1111-4111-8111-111111111111",
  game: null,
  lastSeenAt: liveAt,
  mode: null,
  source: "web",
  ...overrides,
});

test("private Presence wins over absent, connected and playing sessions", () => {
  for (const sessions of [
    [],
    [session()],
    [session({ activity: "playing", source: "launcher", mode: "practice" })],
  ]) {
    assert.deepEqual(derivePlayerPresence({ now, presencePublic: false, sessions }), {
      visibility: "private",
    });
  }
});

test("public Presence treats no live session and stale sessions as offline at the exact TTL boundary", () => {
  assert.deepEqual(derivePlayerPresence({ now, presencePublic: true, sessions: [] }), {
    visibility: "visible", status: "offline",
  });
  assert.deepEqual(derivePlayerPresence({ now, presencePublic: true, sessions: [session({ lastSeenAt: staleAt })] }), {
    visibility: "visible", status: "offline",
  });
  assert.deepEqual(derivePlayerPresence({ now, presencePublic: true, sessions: [session()] }), {
    visibility: "visible", status: "connected", sources: ["web"],
  });
});

test("connected sources aggregate web, launcher and both in stable order", () => {
  assert.deepEqual(
    derivePlayerPresence({ now, presencePublic: true, sessions: [session({ source: "launcher" })] }),
    { visibility: "visible", status: "connected", sources: ["launcher"] },
  );
  assert.deepEqual(
    derivePlayerPresence({ now, presencePublic: true, sessions: [session({ source: "launcher" }), session()] }),
    { visibility: "visible", status: "connected", sources: ["web", "launcher"] },
  );
});

test("playing wins over connected and the newest playing session supplies one canonical game", () => {
  const oldGame = { id: "g-old", title: "Pac-Man" };
  const newGame = { id: "g-new", title: "Space Invaders" };
  const result = derivePlayerPresence({
    now,
    presencePublic: true,
    sessions: [
      session(),
      session({ activity: "playing", source: "launcher", mode: "practice", game: oldGame }),
      session({
        activity: "playing",
        clientId: "22222222-2222-4222-8222-222222222222",
        game: newGame,
        lastSeenAt: new Date(now.getTime() - 1_000).toISOString(),
        mode: "competition",
        source: "launcher",
      }),
    ],
  });
  assert.deepEqual(result, { visibility: "visible", status: "playing", game: newGame });
  assert.deepEqual(
    derivePlayerPresence({
      now,
      presencePublic: true,
      sessions: [session({ activity: "playing", source: "launcher", mode: "practice" })],
    }),
    { visibility: "visible", status: "playing", game: null },
  );
});

test("Presence payload contracts reject spoofed authority, arbitrary browser activity and malformed IDs", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  assert.equal(validateWebPresencePayload({ version: 1, clientId }).ok, true);
  assert.equal(validateWebPresencePayload({ version: 1, clientId, playerId: clientId }).ok, false);
  assert.equal(validateWebPresencePayload({ version: 1, clientId, activity: "playing" }).ok, false);
  assert.equal(validateWebPresencePayload({ version: 1, clientId: "bad" }).ok, false);
  assert.equal(validateLauncherPresencePayload({
    version: 1, clientId, activity: "connected", weekId: null, mode: null,
  }).ok, true);
  assert.equal(validateLauncherPresencePayload({
    version: 1, clientId, activity: "playing", weekId: null, mode: "practice",
  }).ok, true);
  assert.equal(validateLauncherPresencePayload({
    version: 1, clientId, activity: "connected", weekId: clientId, mode: "competition",
  }).ok, false);
  assert.equal(validateLauncherPresencePayload({
    version: 1, clientId, activity: "playing", weekId: null, mode: "ranked",
  }).ok, false);
});

test("0028 keeps its historical default and 0029 changes only new profiles without backfill", async () => {
  const [sql, defaults] = await Promise.all([
    readFile(join(process.cwd(), "supabase/migrations/0028_player_presence.sql"), "utf8"),
    readFile(join(process.cwd(), "supabase/migrations/0029_profile_privacy_defaults.sql"), "utf8"),
  ]);
  assert.match(sql, /presence_public boolean not null default false/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles[\s\S]*play_time_public/i);
  assert.match(sql, /primary key \(player_id, source, client_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.player_presence_sessions from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /create policy[\s\S]*player_presence_sessions/i);
  assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/i);
  assert.match(sql, /old\.presence_public and not new\.presence_public[\s\S]*delete from public\.player_presence_sessions/i);
  assert.match(sql, /new\.anonymized_at is not null[\s\S]*new\.presence_public := false/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /clock_timestamp\(\)/i);
  assert.match(sql, /last_seen_at < clock_timestamp\(\) - interval '24 hours'/i);
  assert.match(defaults, /alter column presence_public set default true/i);
  assert.doesNotMatch(defaults, /update\s+public\.profiles/i);
});

test("server read checks privacy before sessions and public DTOs omit internal identity/timestamps", async () => {
  const source = await readFile(join(process.cwd(), "lib/data/player-presence.ts"), "utf8");
  const privacy = source.indexOf("if (!profileResult.data.presence_public)");
  const sessions = source.indexOf('.from("player_presence_sessions")');
  assert.ok(privacy >= 0 && privacy < sessions);
  const model = await readFile(join(process.cwd(), "lib/player-presence.ts"), "utf8");
  const dto = model.slice(model.indexOf("export type PlayerPresence ="), model.indexOf("export type PlayerPresenceSession"));
  assert.doesNotMatch(dto, /clientId|lastSeenAt|playerId|sessionCount/);
});

test("profile reuses the fifth Estado cell with a shared status indicator, polling and privacy preference", async () => {
  const [stats, presenceStat, indicator, editor, layout, ownerPage, publicPage] = await Promise.all([
    readFile(join(process.cwd(), "components/profile/profile-stats.tsx"), "utf8"),
    readFile(join(process.cwd(), "components/profile/profile-presence-stat.tsx"), "utf8"),
    readFile(join(process.cwd(), "components/player-presence-indicator.tsx"), "utf8"),
    readFile(join(process.cwd(), "components/profile/profile-editor.tsx"), "utf8"),
    readFile(join(process.cwd(), "app/layout.tsx"), "utf8"),
    readFile(join(process.cwd(), "app/profile/page.tsx"), "utf8"),
    readFile(join(process.cwd(), "app/players/[username]/page.tsx"), "utf8"),
  ]);
  assert.match(stats, /lg:grid-cols-5/);
  assert.match(stats, /ProfilePresenceStat/);
  assert.match(presenceStat, /PlayerPresenceIndicator/);
  assert.match(indicator, /whitespace-nowrap/);
  assert.doesNotMatch(presenceStat, /Web y launcher|· Launcher/);
  assert.match(presenceStat, /POLL_INTERVAL_MS = 15_000/);
  assert.match(presenceStat, /visibilityState === "hidden"/);
  assert.match(presenceStat, /Keep the last valid state/);
  assert.match(editor, /presence_public: !hidePresence/);
  assert.match(editor, /profile\?\.presence_public === false/);
  assert.match(editor, /Ocultar mi estado en línea y juego actual/);
  assert.match(editor, /auth\.profile\?\.presence_public !== true[\s\S]*hsl:presence-preference-changed/);
  assert.match(layout, /WebPresenceHeartbeat/);
  assert.match(ownerPage, /getPlayerPresence/);
  assert.match(publicPage, /getPlayerPresence/);
});

test("heartbeat and read routes authenticate canonically, are no-store and never accept player authority", async () => {
  const [webRoute, launcherRoute, readRoute, webHeartbeat] = await Promise.all([
    readFile(join(process.cwd(), "app/api/presence/web/route.ts"), "utf8"),
    readFile(join(process.cwd(), "app/api/launcher/presence/route.ts"), "utf8"),
    readFile(join(process.cwd(), "app/api/players/[username]/presence/route.ts"), "utf8"),
    readFile(join(process.cwd(), "components/presence/web-presence-heartbeat.tsx"), "utf8"),
  ]);
  assert.match(webRoute, /createCookieAuthenticatedClient/);
  assert.match(webRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(webRoute, /source: "web"/);
  assert.match(webRoute, /activity: "connected"/);
  assert.match(webRoute, /Cache-Control[\s\S]*no-store/);
  assert.doesNotMatch(webRoute, /playerId:\s*validation/);
  assert.match(launcherRoute, /createBearerAuthenticatedClient/);
  assert.match(launcherRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(launcherRoute, /export async function DELETE/);
  assert.doesNotMatch(launcherRoute, /payload\.playerId|validation\.value\.playerId|gameTitle/);
  assert.match(readRoute, /hasActiveProfile/);
  assert.match(readRoute, /usernamePattern/);
  assert.match(readRoute, /getPlayerPresence/);
  assert.match(readRoute, /Cache-Control[\s\S]*no-store/);
  assert.match(webHeartbeat, /hsl\.presence\.web\.clientId/);
  assert.match(webHeartbeat, /PRESENCE_HEARTBEAT_INTERVAL_MS/);
  assert.match(webHeartbeat, /window\.addEventListener\("focus"/);
  assert.match(webHeartbeat, /window\.addEventListener\("online"/);
  assert.match(webHeartbeat, /visibilitychange/);
  assert.doesNotMatch(webHeartbeat, /beforeunload/);
});
