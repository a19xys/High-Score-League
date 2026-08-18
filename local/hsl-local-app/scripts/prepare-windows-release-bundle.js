const path = require("node:path");
const { prepareWindowsReleaseBundle } = require("./lib/windows-release-bundle");

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const appDir = path.resolve(__dirname, "..");
  prepareWindowsReleaseBundle({
    appDir,
    bundleDir: path.join(appDir, "release-bundle"),
    version: readOption("version", process.env.HSL_RELEASE_VERSION),
    sourceCommit: readOption("source-commit", process.env.HSL_SOURCE_COMMIT),
    sourceRef: readOption("source-ref", process.env.HSL_SOURCE_REF),
  }).then((result) => {
    process.stdout.write(`Bundle Windows preparado y validado: ${result.bundleDir}\n`);
  }).catch((error) => {
    process.stderr.write(`Preparacion de bundle fallida: ${error.message}\n`);
    process.exitCode = 1;
  });
}
