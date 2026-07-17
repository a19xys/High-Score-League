const fsp = require("node:fs/promises");
const { createAccountSessionRepository } = require("../src/account-session-repository");

async function main() {
  const [configPath, resultPath] = process.argv.slice(2);
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  const repository = createAccountSessionRepository({
    config,
    isExpiringSoon: () => false,
    refreshProvider: async () => { throw new Error("unused"); },
  });
  const result = await repository.migrateLegacy();
  await fsp.writeFile(resultPath, JSON.stringify({ status: result.status }), "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
