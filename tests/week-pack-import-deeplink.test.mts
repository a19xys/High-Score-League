import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LAUNCHER_PACK_AVAILABILITY_WARNING,
  resolveWeekLauncherPack,
  type LauncherPackCatalogClient,
} from "../lib/launcher-week-pack.ts";

const PACK_ID = "space-invaders-s1-w1-r1";
const WEEK_ID = "11111111-1111-4111-8111-111111111111";
const read = (...parts: string[]) => readFile(join(process.cwd(), ...parts), "utf8");

function createCatalog(status: "published" | "draft" | "disabled" | "missing") {
  const calls: string[] = [];
  const filters = new Map<string, unknown>();
  const query = {
    eq(column: string, value: unknown) {
      calls.push(`eq:${column}:${String(value)}`);
      filters.set(column, value);
      return query;
    },
    async maybeSingle() {
      calls.push("maybeSingle");
      const visible = status === "published" &&
        filters.get("week_id") === WEEK_ID &&
        filters.get("status") === "published";
      return {
        data: visible ? { pack_id: PACK_ID } : null,
        error: null,
      };
    },
  };
  const client: LauncherPackCatalogClient = {
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select(columns: string) {
          calls.push(`select:${columns}`);
          return query;
        },
      };
    },
  };

  return { calls, client };
}

test("public week resolves only its published canonical pack_id", async () => {
  const catalog = createCatalog("published");
  const result = await resolveWeekLauncherPack({
    createAdminClient: () => catalog.client,
    isSecret: false,
    weekId: WEEK_ID,
  });

  assert.deepEqual(result, { launcherPackId: PACK_ID, warning: null });
  assert.deepEqual(catalog.calls, [
    "from:launcher_packs",
    "select:pack_id",
    `eq:week_id:${WEEK_ID}`,
    "eq:status:published",
    "maybeSingle",
  ]);
});

test("secret week returns no identity without creating or querying the admin catalog", async () => {
  let adminCreations = 0;
  const result = await resolveWeekLauncherPack({
    createAdminClient: () => {
      adminCreations += 1;
      return createCatalog("published").client;
    },
    isSecret: true,
    weekId: WEEK_ID,
  });

  assert.deepEqual(result, { launcherPackId: null, warning: null });
  assert.equal(adminCreations, 0);
});

test("missing, draft and disabled packs are indistinguishable and produce no deep-link identity", async () => {
  for (const status of ["missing", "draft", "disabled"] as const) {
    const catalog = createCatalog(status);
    const result = await resolveWeekLauncherPack({
      createAdminClient: () => catalog.client,
      isSecret: false,
      weekId: WEEK_ID,
    });
    assert.deepEqual(result, { launcherPackId: null, warning: null }, status);
    assert.equal(catalog.calls.includes("eq:status:published"), true, status);
  }
});

test("catalog configuration, query and invalid identity failures close with one generic warning", async () => {
  const scenarios: Array<() => LauncherPackCatalogClient | null> = [
    () => null,
    () => ({
      from: () => ({
        select: () => ({
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: { message: "private detail" } }),
        }),
      }),
    }),
    () => ({
      from: () => ({
        select: () => ({
          eq() { return this; },
          maybeSingle: async () => ({ data: { pack_id: "INVALID/PACK" }, error: null }),
        }),
      }),
    }),
  ];

  for (const createAdminClient of scenarios) {
    const result = await resolveWeekLauncherPack({
      createAdminClient,
      isSecret: false,
      weekId: WEEK_ID,
    });
    assert.deepEqual(result, {
      launcherPackId: null,
      warning: LAUNCHER_PACK_AVAILABILITY_WARNING,
    });
    assert.doesNotMatch(JSON.stringify(result), /service.role|sql|rls|private detail|INVALID/i);
  }
});

test("admin client factory exceptions fail closed without leaking private details", async () => {
  const result = await resolveWeekLauncherPack({
    createAdminClient: () => {
      throw new Error("private configuration detail");
    },
    isSecret: false,
    weekId: WEEK_ID,
  });

  assert.deepEqual(result, {
    launcherPackId: null,
    warning: LAUNCHER_PACK_AVAILABILITY_WARNING,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /private configuration detail|Supabase URL|service role|SQL|RLS|stack/i,
  );
});

test("weekly UI exposes only the canonical deep link and no legacy or storage capability", async () => {
  const [view, detail, page, serverLookup, query, migration] = await Promise.all([
    read("components", "week-detail-view.tsx"),
    read("lib", "data", "week-detail.ts"),
    read("app", "weeks", "[weekId]", "page.tsx"),
    read("lib", "data", "week-launcher-pack.ts"),
    read("lib", "launcher-week-pack.ts"),
    read("supabase", "migrations", "0031_launcher_packs.sql"),
  ]);

  assert.doesNotMatch(view, /Descargar juego|Ver manual|downloadUrl|manualUrl/);
  assert.match(view, />\s*Importar pack\s*</);
  assert.match(view, /`highscoreleague:\/\/import-pack\/\$\{launcherPackId\}`/);
  assert.match(view, /isLauncherPackId\(launcherPackId\)/);
  assert.match(view, /<a[\s\S]*href=\{packImportHref\}[\s\S]*Importar pack/);
  assert.doesNotMatch(view, /next\/link|target="_blank"|window\.open|router\.push|fetch\(/);
  assert.match(view, /aria-disabled="true"[\s\S]*Pack no disponible/);

  assert.match(detail, /resolvePublicRankingCapability/);
  assert.match(detail, /getWeekLauncherPack\(isSecret, weekRow\.id\)/);
  assert.match(detail, /launcherPackId: launcherPack\.launcherPackId/);
  assert.match(detail, /hidePackImport: isSecret/);
  assert.doesNotMatch(`${detail}\n${page}\n${view}`, /hideDownloads/);
  assert.match(page, /launcherPackId=\{detail\.launcherPackId\}/);
  assert.match(page, /hidePackImport=\{detail\.hidePackImport\}/);
  assert.doesNotMatch(page, /launcher_packs|object_key|sha256|sizeBytes|downloadUrl/);

  assert.match(serverLookup, /import "server-only"/);
  assert.match(serverLookup, /createSupabaseAdminClient/);
  assert.match(query, /\.from\("launcher_packs"\)[\s\S]*\.select\("pack_id"\)[\s\S]*\.eq\("week_id", options\.weekId\)[\s\S]*\.eq\("status", "published"\)[\s\S]*\.maybeSingle\(\)/);
  assert.doesNotMatch(`${query}\n${detail}\n${page}\n${view}`, /object_key|sha256|size_bytes|presign|signed.url|R2_HEAD/);

  assert.match(migration, /enable row level security/);
  assert.match(migration, /launcher_packs_admin_all[\s\S]*public\.is_admin\(\)/);
  assert.doesNotMatch(migration, /authenticated[\s\S]*for select[\s\S]*using \(true\)/i);
});
