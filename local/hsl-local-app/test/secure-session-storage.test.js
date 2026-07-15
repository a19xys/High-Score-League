const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  configureSessionProtection,
  readStoredSession,
  writeStoredSession,
} = require("../src/secure-session-storage");

function stored(userId = "user-1") {
  return {
    schemaVersion: 1,
    user: { id: userId, email: `${userId}@example.com` },
    session: { access_token: "access-secret", refresh_token: "refresh-secret", expires_at: 2000 },
  };
}

function provider() {
  return {
    encryptionAvailable: true,
    provider: "test-keychain",
    encryptString: (value) => Buffer.from(value, "utf8").toString("base64").split("").reverse().join(""),
    decryptString: (value) => Buffer.from(value.split("").reverse().join(""), "base64").toString("utf8"),
  };
}

test("secure envelope round-trips without plaintext tokens", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-secure-session-"));
  const file = path.join(dir, "session.json");
  configureSessionProtection(provider());
  try {
    await writeStoredSession(file, stored());
    const raw = await fsp.readFile(file, "utf8");
    const read = await readStoredSession(file);
    assert.doesNotMatch(raw, /access-secret|refresh-secret/);
    assert.match(raw, /test-keychain/);
    assert.equal(read.storedSession.user.id, "user-1");
    assert.equal(read.revision, 1);
  } finally {
    configureSessionProtection(null);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("legacy plaintext migrates only after protected write verifies", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-session-migration-"));
  const file = path.join(dir, "session.json");
  await fsp.writeFile(file, JSON.stringify(stored()));
  configureSessionProtection(provider());
  try {
    const read = await readStoredSession(file);
    const raw = await fsp.readFile(file, "utf8");
    assert.equal(read.status, "valid");
    assert.doesNotMatch(raw, /access-secret|refresh-secret/);
  } finally {
    configureSessionProtection(null);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("failed migration preserves the original plaintext file", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-session-migration-fail-"));
  const file = path.join(dir, "session.json");
  const original = JSON.stringify(stored());
  await fsp.writeFile(file, original);
  configureSessionProtection({ ...provider(), encryptString() { throw new Error("keychain unavailable"); } });
  try {
    await assert.rejects(() => readStoredSession(file));
    assert.equal(await fsp.readFile(file, "utf8"), original);
  } finally {
    configureSessionProtection(null);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
