import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePlayerPlayTimeApi } from "../lib/api/player-playtime.ts";
import { getPlayerPlayTime } from "../lib/data/player-playtime.ts";

type Scenario = {
  configured?: boolean;
  viewerId?: string | null;
  viewerError?: boolean;
  viewerActive?: boolean;
  target?: { id: string; playTimePublic: boolean } | null;
  targetError?: boolean;
  total?: number | string | null;
  totalError?: unknown;
};

function scenario(overrides: Scenario = {}) {
  const settings = {
    configured: true,
    viewerId: "viewer",
    viewerError: false,
    viewerActive: true,
    target: { id: "target", playTimePublic: true },
    targetError: false,
    total: 12240,
    totalError: null,
    ...overrides,
  };
  let aggregateQueries = 0;
  let targetQueries = 0;
  const aggregateQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      aggregateQueries += 1;
      return {
        data: settings.total === null
          ? null
          : { total_seconds: settings.total },
        error: settings.totalError,
      };
    },
  };
  const client = { from: () => aggregateQuery };
  const dependencies = {
    createClient: async () => settings.configured ? client : null,
    getViewer: async () => settings.viewerError
      ? { status: "error" as const }
      : settings.viewerId
        ? { status: "signed-in" as const, userId: settings.viewerId }
        : { status: "signed-out" as const },
    hasActiveProfile: async () => ({ active: settings.viewerActive, error: null }),
    isValidUsername: (username: string) => /^[a-z0-9_-]{3,24}$/i.test(username),
    findTarget: async () => {
      targetQueries += 1;
      if (settings.targetError) return { status: "error" as const };
      return settings.target
        ? {
            status: "ok" as const,
            id: settings.target.id,
            playTimePublic: settings.target.playTimePublic,
          }
        : { status: "not-found" as const };
    },
    readPlayTime: (
      value: typeof client,
      playerId: string,
      access: { isOwner: boolean; playTimePublic: boolean },
    ) => getPlayerPlayTime(value as never, playerId, access),
  };

  return {
    dependencies,
    get aggregateQueries() { return aggregateQueries; },
    get targetQueries() { return targetQueries; },
  };
}

test("Playtime API rejects missing configuration, session and invalid usernames", async () => {
  const notConfigured = scenario({ configured: false });
  assert.equal((await resolvePlayerPlayTimeApi("target", notConfigured.dependencies)).status, 503);

  const signedOut = scenario({ viewerId: null });
  assert.equal((await resolvePlayerPlayTimeApi("target", signedOut.dependencies)).status, 401);

  const invalid = scenario();
  assert.equal((await resolvePlayerPlayTimeApi("!", invalid.dependencies)).status, 400);
  assert.equal(invalid.targetQueries, 0);
});

test("Playtime API returns 404 for an absent active player", async () => {
  const missing = scenario({ target: null });
  const result = await resolvePlayerPlayTimeApi("missing", missing.dependencies);
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, error: "Jugador no encontrado." });
});

test("private owner still receives the visible aggregate", async () => {
  const owner = scenario({
    viewerId: "target",
    target: { id: "target", playTimePublic: false },
  });
  const result = await resolvePlayerPlayTimeApi("target", owner.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    playTime: { visibility: "visible", totalSeconds: 12240 },
  });
  assert.equal(owner.aggregateQueries, 1);
});

test("private third-party response omits the total and skips its aggregate query", async () => {
  const hidden = scenario({
    viewerId: "visitor",
    target: { id: "target", playTimePublic: false },
  });
  const result = await resolvePlayerPlayTimeApi("target", hidden.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    playTime: { visibility: "private" },
  });
  assert.equal(hidden.aggregateQueries, 0);
});

test("public third-party and legitimately absent aggregates return visible totals", async () => {
  const visible = scenario({ viewerId: "visitor" });
  assert.deepEqual(
    (await resolvePlayerPlayTimeApi("target", visible.dependencies)).body,
    { ok: true, playTime: { visibility: "visible", totalSeconds: 12240 } },
  );

  const absent = scenario({ total: null });
  assert.deepEqual(
    (await resolvePlayerPlayTimeApi("target", absent.dependencies)).body,
    { ok: true, playTime: { visibility: "visible", totalSeconds: 0 } },
  );
});

test("aggregate query errors become 503 and never a visible zero", async () => {
  const failed = scenario({ total: null, totalError: { message: "secret detail" } });
  const result = await resolvePlayerPlayTimeApi("target", failed.dependencies);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, error: "Playtime no está disponible." });
  assert.doesNotMatch(JSON.stringify(result.body), /secret detail|totalSeconds/);
});

test("Playtime read route is dynamic, no-store, authenticated and does not use admin authority", async () => {
  const route = await readFile(
    join(process.cwd(), "app/api/players/[username]/playtime/route.ts"),
    "utf8",
  );
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /hasActiveProfile/);
  assert.match(route, /usernamePattern/);
  assert.match(route, /\.is\("anonymized_at", null\)/);
  assert.match(route, /getPlayerPlayTime/);
  assert.doesNotMatch(route, /Admin|service.role|service_role/i);
});
