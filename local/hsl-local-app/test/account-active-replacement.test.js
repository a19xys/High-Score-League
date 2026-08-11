const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { selectReplacementAccount } = require("../gui/launcher-service");
const {
  readKnownAccounts,
  rememberAccount,
  removeKnownAccount,
  setActiveAccount,
} = require("../src/account-store");
const { createSessionResult } = require("../src/session-result");

async function withTempDir(operation) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-account-replacement-"));
  try { return await operation({ userDataDir }); }
  finally { await fsp.rm(userDataDir, { force: true, recursive: true }); }
}

async function prepareAccounts(config) {
  await rememberAccount(config, { email: "c@example.test", userId: "C" }, { setActive: false });
  await rememberAccount(config, { email: "b@example.test", userId: "B" }, { setActive: false });
  await rememberAccount(config, { email: "a@example.test", userId: "A" });
  await removeKnownAccount(config, "A", { deleteSession: false });
}

function localResult(userId, status = "valid") {
  return createSessionResult({
    remoteUsable: status === "valid",
    status,
    storedSession: { user: { id: userId }, session: { expires_at: 1 } },
  });
}

test("forgetting active account chooses the first canonical locally usable remainder", async () => {
  const cases = [
    {
      expected: "B",
      name: "B and C valid",
      results: { B: localResult("B"), C: localResult("C") },
    },
    {
      expected: "C",
      name: "B missing and C valid",
      results: { B: createSessionResult({ status: "missing" }), C: localResult("C") },
    },
    {
      expected: "B",
      name: "B deferred offline with stored session",
      results: { B: localResult("B", "deferred"), C: localResult("C") },
    },
    {
      expected: null,
      name: "only revoked or corrupt accounts remain",
      results: {
        B: createSessionResult({ status: "revoked" }),
        C: createSessionResult({ status: "corrupt" }),
      },
    },
  ];

  for (const fixture of cases) {
    await withTempDir(async (config) => {
      await prepareAccounts(config);
      const activations = [];
      const repository = {
        read: async (userId) => fixture.results[userId],
        setActive: async (userId) => {
          activations.push(userId);
          return setActiveAccount(config, userId);
        },
      };
      const replacement = await selectReplacementAccount(config, repository);
      const state = await readKnownAccounts(config);
      assert.equal(replacement?.account.userId || null, fixture.expected, fixture.name);
      assert.equal(state.lastActiveUserId, fixture.expected, fixture.name);
      assert.deepEqual(activations, fixture.expected ? [fixture.expected] : [], fixture.name);
    });
  }
});

test("forgetting a non-active account leaves the canonical active pointer intact", async () => {
  await withTempDir(async (config) => {
    await rememberAccount(config, { userId: "B" }, { setActive: false });
    await rememberAccount(config, { userId: "A" });
    await removeKnownAccount(config, "B", { deleteSession: false });
    assert.equal((await readKnownAccounts(config)).lastActiveUserId, "A");
  });
});

test("launcher replacement path is gated by the removed account being active and uses repository setActive", async () => {
  const source = await fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8");
  assert.match(source, /const wasActive = accountsBefore\.lastActiveUserId === userId/);
  assert.match(source, /result\.removed && wasActive[\s\S]*selectReplacementAccount\(config, repository\)/);
  assert.match(source, /await repository\.setActive\(account\.userId\)/);
});
