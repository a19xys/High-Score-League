const path = require("node:path");
const { validateWindowsReleaseBundle } = require("./lib/windows-release-bundle");

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  validateWindowsReleaseBundle({
    bundleDir: path.resolve(readOption("bundle-dir", path.join(__dirname, "..", "release-bundle"))),
    expectedVersion: readOption("version", process.env.HSL_RELEASE_VERSION),
    sourceCommit: readOption("source-commit", process.env.HSL_SOURCE_COMMIT),
    sourceRef: readOption("source-ref", process.env.HSL_SOURCE_REF),
  }).then((result) => {
    process.stdout.write(`Bundle Windows valido: ${result.manifest.tag}, ${result.assets.length} assets.\n`);
  }).catch((error) => {
    process.stderr.write(`Validacion de bundle fallida: ${error.message}\n`);
    process.exitCode = 1;
  });
}
