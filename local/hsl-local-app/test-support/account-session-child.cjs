const fsp = require("node:fs/promises");
const { createAccountSessionRepository } = require("../src/account-session-repository");

async function main() {
  const [configPath, markerPath, resultPath, userId] = process.argv.slice(2);
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  const repository = createAccountSessionRepository({
    config,
    isExpiringSoon: (stored) => Number(stored?.session?.expires_at) <= Math.floor(Date.now() / 1000) + 60,
    lockTimeoutMs: 5000,
    refreshProvider: async ({ storedSession }) => {
      await fsp.appendFile(markerPath, `${process.pid}\n`, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        schemaVersion: 1,
        session: {
          ...storedSession.session,
          access_token: `access-refreshed-${process.pid}`,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `refresh-refreshed-${process.pid}`,
        },
        user: storedSession.user,
      };
    },
  });
  const result = await repository.resolve(userId, { connected: true });
  await fsp.writeFile(resultPath, JSON.stringify({ revision: result.sessionRevision, status: result.status }), "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
