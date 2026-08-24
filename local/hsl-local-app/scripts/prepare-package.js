const path = require("node:path");
const { stageProductMame } = require("./prepare-mame");
const { stageProductPlugin } = require("./stage-product-plugin");
const { readProductPublicConfig } = require("../src/product-config");
const {
  PRODUCT_INTEGRITY_ROOT_FILENAME,
  writeProductIntegrityRoot,
} = require("../src/product-runtime-integrity");

async function preparePackage() {
  const appDir = path.resolve(__dirname, "..");
  readProductPublicConfig(path.join(appDir, "product-public-config.json"), { required: true });
  const mame = await stageProductMame();
  const plugin = await stageProductPlugin();
  const productRootPath = path.join(appDir, ".cache", "product", PRODUCT_INTEGRITY_ROOT_FILENAME);
  await writeProductIntegrityRoot(productRootPath, {
    mameVersion: mame.manifest.version,
    pluginVersion: plugin.pluginVersion,
    runtimeManifestPath: mame.integrity.manifestPath,
    pluginManifestPath: plugin.integrity.manifestPath,
  });
  process.stdout.write("Entradas de packaging validadas.\n");
}

if (require.main === module) {
  preparePackage().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { preparePackage };
