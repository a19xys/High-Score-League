const path = require("node:path");
const { loadPackFromDir } = require("../src/pack");
const { writeCompetitionManifest } = require("../src/competition-manifest");

async function main(argv = process.argv.slice(2)) {
  const packRoot = path.resolve(argv[0] || ".");
  const loaded = loadPackFromDir(packRoot);
  if (!loaded.loaded) throw new Error(`No se encontro pack.json en ${packRoot}`);
  if (loaded.errors.length > 0) throw new Error(`pack.json invalido: ${loaded.errors.join(" ")}`);
  if (!loaded.pack?.contract?.mame?.profiles?.competition?.integrity) {
    throw new Error("El pack no declara mame.profiles.competition.integrity v1.");
  }
  const result = await writeCompetitionManifest(loaded.pack);
  process.stdout.write(`${result.manifestPath}\n${result.manifestSha256}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
