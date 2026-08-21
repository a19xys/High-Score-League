const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { createVerifiedCompetitionSnapshot } = require("../src/competition-snapshot");
const { loadPackFromDir } = require("../src/pack");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-competition-snapshot-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const packRoot = path.join(root, "library", "Space Invaders");
  await fsp.mkdir(path.join(packRoot, "roms"), { recursive: true });
  await fsp.mkdir(path.join(packRoot, "artwork"), { recursive: true });
  await fsp.mkdir(path.join(packRoot, "scripts"), { recursive: true });
  await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "ROM-ORIGINAL", "utf8");
  await fsp.writeFile(path.join(packRoot, "artwork", "invaders.zip"), "ARTWORK-ORIGINAL", "utf8");
  await fsp.writeFile(path.join(packRoot, "scripts", "invaders.lua"), "return {}\n", "utf8");
  await fsp.writeFile(path.join(packRoot, "pack.json"), `${JSON.stringify({
    packVersion: 2,
    packId: "space-invaders-snapshot-test",
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-snapshot-test",
    webBaseUrl: "https://high-score-league.vercel.app",
    runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
    mame: {
      romPath: "roms",
      artworkPath: "artwork",
      launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
      profiles: {
        practice: { launchArgs: [] },
        competition: { launchArgs: [], integrity: { version: 1, mameVersion: "0.287", dips: [] } },
      },
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/invaders.lua",
      automatic: { version: 1, strategy: "invaders-game-mode-final-v1" },
    },
  }, null, 2)}\n`, "utf8");
  const loaded = loadPackFromDir(packRoot);
  assert.equal(loaded.loaded, true, loaded.errors.join("\n"));
  await writeCompetitionManifest(loaded.pack);
  return { pack: loadPackFromDir(packRoot).pack, packRoot, root };
}

test("fresh reload copies verified bytes and MAME-facing paths resolve only inside the run snapshot", async (t) => {
  const { pack, packRoot, root } = await fixture(t);
  pack.contract.mame.launchArgs = [];
  const snapshotRoot = path.join(root, "run", "pack");
  const result = await createVerifiedCompetitionSnapshot(pack, snapshotRoot);
  assert.equal(result.snapshotPack.packRoot, snapshotRoot);
  assert.equal(result.snapshotPack.contract.mame.romDir, path.join(snapshotRoot, "roms"));
  assert.equal(result.snapshotPack.contract.mame.artworkDir, path.join(snapshotRoot, "artwork"));
  assert.equal(result.snapshotPack.contract.capture.adapterPath, path.join(snapshotRoot, "scripts", "invaders.lua"));
  assert.deepEqual(result.snapshotPack.contract.mame.launchArgs, ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"]);
  assert.equal(await fsp.readFile(path.join(snapshotRoot, "roms", "invaders.zip"), "utf8"), "ROM-ORIGINAL");
  assert.equal(await fsp.readFile(path.join(snapshotRoot, "artwork", "invaders.zip"), "utf8"), "ARTWORK-ORIGINAL");

  await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "LIBRARY-MUTATED-AFTER-SNAPSHOT", "utf8");
  assert.equal(await fsp.readFile(path.join(snapshotRoot, "roms", "invaders.zip"), "utf8"), "ROM-ORIGINAL");
});

test("fresh reload rejects a cached identity that no longer matches pack.json", async (t) => {
  const { pack, root } = await fixture(t);
  pack.weekId = "stale-week";
  await assert.rejects(
    () => createVerifiedCompetitionSnapshot(pack, path.join(root, "run-stale", "pack")),
    /El pack ha cambiado mientras se preparaba la partida/,
  );
});

test("TOCTOU mutation between manifest load and copy fails before a usable snapshot exists", async (t) => {
  const { pack, packRoot, root } = await fixture(t);
  const snapshotRoot = path.join(root, "run-raced", "pack");
  let sabotaged = false;
  await assert.rejects(() => createVerifiedCompetitionSnapshot(pack, snapshotRoot, {
    async beforeCopy({ entry }) {
      if (!sabotaged && entry.path === "roms/invaders.zip") {
        sabotaged = true;
        await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "RACED-ROM", "utf8");
      }
    },
  }), /hash distinto|tamano distinto/);
  assert.equal(sabotaged, true);
  await assert.rejects(() => fsp.access(path.join(snapshotRoot, "roms", "invaders.zip")));
});
