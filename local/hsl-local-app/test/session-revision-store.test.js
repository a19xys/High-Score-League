const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  commitSessionRevision,
  readSessionRevision,
  reserveSessionRevision,
  sessionRevisionPath,
} = require("../src/session-revision-store");

async function withTempDir(operation) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-session-revision-"));
  try { return await operation(root); } finally { await fsp.rm(root, { force: true, recursive: true }); }
}

test("revision ledger survives tombstones and never stores the user id", async () => {
  await withTempDir(async (root) => {
    const config = { userDataDir: root };
    const first = await reserveSessionRevision(config, "private-user", { disposition: "session", reason: "login" });
    await commitSessionRevision(config, "private-user", first.lastRevision, { disposition: "session", reason: "login" });
    const tombstone = await reserveSessionRevision(config, "private-user", { disposition: "tombstone", reason: "logout" });
    await commitSessionRevision(config, "private-user", tombstone.lastRevision, { disposition: "tombstone", reason: "logout" });
    const relogin = await reserveSessionRevision(config, "private-user", { disposition: "session", reason: "login" });

    assert.deepEqual([first.lastRevision, tombstone.lastRevision, relogin.lastRevision], [1, 2, 3]);
    const raw = await fsp.readFile(sessionRevisionPath(config, "private-user"), "utf8");
    assert.equal(raw.includes("private-user"), false);
    assert.equal(raw.includes("token"), false);
  });
});

test("reservation uses the maximum observed revision and gaps remain monotonic", async () => {
  await withTempDir(async (root) => {
    const config = { userDataDir: root };
    assert.equal((await reserveSessionRevision(config, "user-1", { observedRevisions: [9, 4] })).lastRevision, 10);
    assert.equal((await reserveSessionRevision(config, "user-1", { observedRevisions: [2] })).lastRevision, 11);
    assert.equal((await readSessionRevision(config, "user-1")).lastRevision, 11);
  });
});

test("a corrupt ledger is preserved unless explicit recovery is requested", async () => {
  await withTempDir(async (root) => {
    const config = { userDataDir: root };
    const filePath = sessionRevisionPath(config, "user-1");
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{broken", "utf8");
    await assert.rejects(() => reserveSessionRevision(config, "user-1"), (error) => error.code === "SESSION_REVISION_LEDGER_CORRUPT");
    assert.equal(await fsp.readFile(filePath, "utf8"), "{broken");
    assert.equal((await reserveSessionRevision(config, "user-1", { allowRecovery: true, observedRevisions: [7] })).lastRevision, 8);
  });
});
