const assert = require("node:assert/strict");
const test = require("node:test");
const {
  playerPreferenceScope,
  preferenceScopeFromAccounts,
} = require("../src/preference-scope");

test("PreferenceScope sigue la cuenta local activa aunque la sesión remota no gobierne", () => {
  const accounts = {
    accounts: [
      { requiresLogin: true, userId: "A" },
      { remoteUsable: true, userId: "B" },
    ],
    lastActiveUserId: "A",
  };
  assert.deepEqual(preferenceScopeFromAccounts(accounts), {
    playerKey: "user_a",
    scope: "player",
    scopeKey: "player:user_a",
  });
});

test("PreferenceScope global cubre ausencia o puntero local corrupto", () => {
  assert.equal(preferenceScopeFromAccounts({ accounts: [], lastActiveUserId: null }).scopeKey, "global");
  assert.equal(preferenceScopeFromAccounts({ accounts: [{ userId: "A" }], lastActiveUserId: "missing" }).scopeKey, "global");
});

test("player keys son estables, distintos y no contienen email ni paths", () => {
  const a = playerPreferenceScope("Player A");
  const b = playerPreferenceScope("Player B");
  assert.equal(a.scopeKey, "player:user_player-a");
  assert.equal(b.scopeKey, "player:user_player-b");
  assert.notEqual(a.playerKey, b.playerKey);
  assert.doesNotMatch(JSON.stringify(a), /@|\\|\//);
});
