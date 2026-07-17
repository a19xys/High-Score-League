const fsp = require("node:fs/promises");
const { rememberAccount } = require("../src/account-store");

async function main() {
  const [configPath, userId] = process.argv.slice(2);
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  await rememberAccount(config, { email: `${userId}@example.com`, userId });
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
