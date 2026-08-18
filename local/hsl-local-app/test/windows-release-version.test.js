const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertStableVersion,
  assertVersionIsNewer,
  compareStableVersions,
  tagForVersion,
} = require("../scripts/lib/windows-release-version");

test("stable release versions accept only strict MAJOR.MINOR.PATCH", () => {
  for (const version of ["0.2.0", "0.2.1", "0.3.0", "1.0.0"]) {
    assert.deepEqual(assertStableVersion(version), version.split(".").map(Number));
    assert.equal(tagForVersion(version), `v${version}`);
  }
  for (const version of ["v0.2.0", "0.2", "0.2.0-beta.1", "0.3.0-alpha", "00.2.0", "0.02.0", "0.2.00", " 0.2.0", "0.2.0 "]) {
    assert.throws(() => assertStableVersion(version), /SemVer estable/);
  }
});

test("stable release comparison is numeric and strictly forward-only", () => {
  assert.equal(compareStableVersions("0.2.1", "0.2.0"), 1);
  assert.equal(compareStableVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareStableVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareStableVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareStableVersions("0.1.9", "0.2.0"), -1);
  assert.doesNotThrow(() => assertVersionIsNewer("0.3.0", "0.2.0"));
  assert.throws(() => assertVersionIsNewer("0.2.0", "0.2.0"), /estrictamente superior/);
  assert.throws(() => assertVersionIsNewer("0.1.9", "0.2.0"), /estrictamente superior/);
});
