const path = require("node:path");
const { prepareMame } = require("./prepare-mame");
const { stageProductPlugin } = require("./stage-product-plugin");
const { readProductPublicConfig } = require("../src/product-config");

async function preparePackage() {
  const appDir = path.resolve(__dirname, "..");
  readProductPublicConfig(path.join(appDir, "product-public-config.json"), { required: true });
  await prepareMame();
  await stageProductPlugin();
  process.stdout.write("Entradas de packaging validadas.\n");
}

if (require.main === module) {
  preparePackage().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { preparePackage };
