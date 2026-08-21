const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  buildCompetitionManifest,
  verifyCompetitionManifest,
  writeCompetitionManifest,
} = require("../src/competition-manifest");

async function fixture(t) {
  const packRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-competition-manifest-"));
  t.after(() => fsp.rm(packRoot, { recursive: true, force: true }));
  await fsp.mkdir(path.join(packRoot, "scripts"), { recursive: true });
  await fsp.mkdir(path.join(packRoot, "roms"), { recursive: true });
  await fsp.mkdir(path.join(packRoot, "artwork"), { recursive: true });
  await fsp.mkdir(path.join(packRoot, "cfg-competition", "nested"), { recursive: true });
  await fsp.writeFile(path.join(packRoot, "scripts", "invaders.lua"), "return {}\n");
  await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "rom-bytes");
  await fsp.writeFile(path.join(packRoot, "artwork", "invaders.zip"), "layout-with-input-tags");
  await fsp.writeFile(path.join(packRoot, "cfg-competition", "nested", "seed.cfg"), "seed\n");
  await fsp.writeFile(path.join(packRoot, "pack.json"), "{\"packVersion\":2}\n");
  const pack = {
    packId: "space-invaders-test",
    packRoot,
    contract: {
      version: 2,
      capture: { adapter: "scripts/invaders.lua", adapterPath: path.join(packRoot, "scripts", "invaders.lua") },
      mame: {
        artworkDir: path.join(packRoot, "artwork"),
        romDir: path.join(packRoot, "roms"),
        profiles: { competition: { cfgDir: path.join(packRoot, "cfg-competition") } },
      },
    },
  };
  return { pack, packRoot };
}

test("manifest v1 tiene bytes deterministas, rutas canonicas y cobertura derivada", async (t) => {
  const { pack } = await fixture(t);
  const first = await buildCompetitionManifest(pack);
  const second = await buildCompetitionManifest(pack);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.bytes.at(-1), 10);
  assert.deepEqual(first.manifest.files.map((entry) => entry.path), [
    "artwork/invaders.zip",
    "cfg-competition/nested/seed.cfg",
    "pack.json",
    "roms/invaders.zip",
    "scripts/invaders.lua",
  ]);
  assert.equal(first.manifest.files.some((entry) => entry.path === "competition-manifest.json"), false);
  assert.ok(first.manifest.files.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  await writeCompetitionManifest(pack);
  assert.equal((await verifyCompetitionManifest(pack)).manifestSha256, first.manifestSha256);
});

test("verificacion bloquea hash, size, packId, bytes no canonicos y extras relevantes", async (t) => {
  const { pack, packRoot } = await fixture(t);
  const written = await writeCompetitionManifest(pack);
  const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
  const adapterBytes = await fsp.readFile(adapterPath);
  adapterBytes[0] = adapterBytes[0] === 0x72 ? 0x52 : 0x72;
  await fsp.writeFile(adapterPath, adapterBytes);
  await assert.rejects(() => verifyCompetitionManifest(pack), /hash distinto/);

  await fsp.writeFile(path.join(packRoot, "competition-manifest.json"), written.bytes);
  const parsed = JSON.parse(written.bytes);
  parsed.files[0].sizeBytes += 1;
  await fsp.writeFile(path.join(packRoot, "competition-manifest.json"), `${JSON.stringify(parsed, null, 2)}\n`);
  await assert.rejects(() => verifyCompetitionManifest(pack), /tamano distinto|hash distinto/);

  await writeCompetitionManifest(pack);
  const wrongPack = JSON.parse(await fsp.readFile(path.join(packRoot, "competition-manifest.json")));
  wrongPack.packId = "wrong-pack";
  await fsp.writeFile(path.join(packRoot, "competition-manifest.json"), `${JSON.stringify(wrongPack, null, 2)}\n`);
  await assert.rejects(() => verifyCompetitionManifest(pack), /packId no coincide/);

  await writeCompetitionManifest(pack);
  const canonical = await fsp.readFile(path.join(packRoot, "competition-manifest.json"), "utf8");
  await fsp.writeFile(path.join(packRoot, "competition-manifest.json"), canonical.trim());
  await assert.rejects(() => verifyCompetitionManifest(pack), /bytes del manifest no son canonicos/);

  await writeCompetitionManifest(pack);
  await fsp.writeFile(path.join(packRoot, "scripts", "extra.lua"), "return {}\n");
  await assert.rejects(() => verifyCompetitionManifest(pack), /faltan o sobran archivos competitivos/);
});

test("manifest rechaza symlinks y entradas criticas que no son archivos", async (t) => {
  const { pack, packRoot } = await fixture(t);
  const adapter = path.join(packRoot, "scripts", "invaders.lua");
  const target = path.join(packRoot, "adapter-target.lua");
  await fsp.rename(adapter, target);
  try {
    await fsp.symlink(target, adapter, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) return t.skip("symlinks no disponibles en este Windows");
    throw error;
  }
  await assert.rejects(() => buildCompetitionManifest(pack), /symlink no permitido/);
});

test("manifest v1 rechaza extensiones de esquema no declaradas", async (t) => {
  const { pack, packRoot } = await fixture(t);
  await writeCompetitionManifest(pack);
  const manifestPath = path.join(packRoot, "competition-manifest.json");
  const parsed = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  parsed.trusted = true;
  await fsp.writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`);
  await assert.rejects(() => verifyCompetitionManifest(pack), /campos de manifest desconocidos/);
});
