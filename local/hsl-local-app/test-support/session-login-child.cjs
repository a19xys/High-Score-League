const fsp = require("node:fs/promises");
const { createAccountSessionRepository } = require("../src/account-session-repository");

async function main() {
  const [configPath, resultPath, suffix] = process.argv.slice(2);
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  const repository = createAccountSessionRepository({
    config,
    isExpiringSoon: () => false,
    refreshProvider: async () => { throw new Error("unused"); },
  });
  const saved = await repository.saveLogin({
    session: {
      access_token: `access-${suffix}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh-${suffix}`,
    },
    supabaseUrl: config.supabaseUrl,
    user: { email: `${suffix}@example.com`, id: "user-1" },
  });
  await fsp.writeFile(resultPath, JSON.stringify({ revision: saved.sessionRevision }), "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
