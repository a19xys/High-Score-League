const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  FULL_REPOSITORY,
  assertConfirmation,
  createGitHubClient,
  inspectReleaseState,
  makeProvenance,
  normalizeArtifactDigest,
  publishWindowsRelease,
  renderDraftBody,
  sanitizeErrorText,
  stageWindowsRelease,
  validateBuildIdentity,
  validateLatestReleaseContract,
  validatePrivilegedWorkflowIdentity,
} = require("../scripts/lib/windows-release-github");
const { SOURCE_COMMIT, SOURCE_REF, withReleaseBundle } = require("./windows-release-fixture");

const ARTIFACT_DIGEST = `sha256:${"b".repeat(64)}`;

test("privileged workflow identity accepts the canonical repository on master", () => {
  assert.deepEqual(validatePrivilegedWorkflowIdentity({
    workflowRepository: FULL_REPOSITORY,
    workflowRef: SOURCE_REF,
  }), {
    workflowRepository: FULL_REPOSITORY,
    workflowRef: SOURCE_REF,
  });
});

test("privileged workflow identity rejects a feature branch", () => {
  assert.throws(() => validatePrivilegedWorkflowIdentity({
    workflowRepository: FULL_REPOSITORY,
    workflowRef: "refs/heads/feature/release-test",
  }), /refs\/heads\/master/);
});

test("privileged workflow identity rejects a different repository", () => {
  assert.throws(() => validatePrivilegedWorkflowIdentity({
    workflowRepository: "fork/High-Score-League",
    workflowRef: SOURCE_REF,
  }), /a19xys\/High-Score-League/);
});

function makeFakeGitHub(options = {}) {
  const state = {
    releases: options.releases || [],
    latest: options.latest || null,
    tags: { ...(options.tags || {}) },
    calls: [],
    nextReleaseId: 50,
    artifact: options.artifact || {
      id: 700,
      name: "hsl-windows-release-0.2.0-900",
      digest: ARTIFACT_DIGEST,
      expired: false,
      workflow_run: { id: 900, head_sha: SOURCE_COMMIT, head_branch: "master" },
    },
    stageRun: options.stageRun || {
      id: 900,
      event: "workflow_dispatch",
      path: ".github/workflows/windows-release-stage.yml",
      head_branch: "master",
      head_sha: SOURCE_COMMIT,
      status: "completed",
      conclusion: "success",
      repository: { full_name: FULL_REPOSITORY },
    },
  };

  function releaseById(endpoint) {
    const id = Number(endpoint.match(/\/releases\/(\d+)$/)?.[1]);
    return state.releases.find((release) => release.id === id);
  }

  const client = {
    async listReleases() {
      return state.releases;
    },
    async resolveTag(tag) {
      return state.tags[tag] || null;
    },
    async assetText(asset) {
      return asset.text;
    },
    async assetSha256(asset) {
      return String(asset.digest || "").replace(/^sha256:/, "");
    },
    async uploadAsset(releaseId, asset) {
      state.calls.push({ method: "UPLOAD", releaseId, name: asset.name });
      const release = state.releases.find((entry) => entry.id === releaseId);
      const uploaded = { id: 1000 + release.assets.length, name: asset.name, size: asset.size, state: "uploaded", digest: `sha256:${asset.sha256}` };
      release.assets.push(uploaded);
      return uploaded;
    },
    async request(method, endpoint, requestOptions = {}) {
      state.calls.push({ method, endpoint, json: requestOptions.json });
      if (method === "GET" && endpoint === "/repos/a19xys/High-Score-League") {
        return { full_name: FULL_REPOSITORY, default_branch: "master" };
      }
      if (method === "GET" && endpoint === "/repos/a19xys/High-Score-League/branches/master") {
        return { commit: { sha: options.masterHead || SOURCE_COMMIT } };
      }
      if (method === "GET" && endpoint === "/repos/a19xys/High-Score-League/releases/latest") return state.latest;
      if (method === "GET" && endpoint.includes("/actions/artifacts/")) return state.artifact;
      if (method === "GET" && endpoint.includes("/actions/runs/")) return state.stageRun;
      if (method === "GET" && endpoint.includes("/contents/local/hsl-local-app/package.json?ref=")) {
        return { encoding: "base64", content: Buffer.from(JSON.stringify({ version: "0.2.0" })).toString("base64") };
      }
      if (method === "GET" && endpoint === `/repos/a19xys/High-Score-League/commits/${SOURCE_COMMIT}`) return { sha: SOURCE_COMMIT };
      if (method === "GET" && endpoint.includes("/compare/")) return { status: "ahead" };
      if (method === "GET" && /\/releases\/\d+$/.test(endpoint)) return releaseById(endpoint);
      if (method === "POST" && endpoint === "/repos/a19xys/High-Score-League/releases") {
        const release = {
          id: state.nextReleaseId++,
          tag_name: requestOptions.json.tag_name,
          target_commitish: requestOptions.json.target_commitish,
          name: requestOptions.json.name,
          body: requestOptions.json.body,
          draft: requestOptions.json.draft,
          prerelease: requestOptions.json.prerelease,
          assets: [],
        };
        state.releases.push(release);
        return release;
      }
      if (method === "PATCH" && /\/releases\/\d+$/.test(endpoint)) {
        const release = releaseById(endpoint);
        Object.assign(release, requestOptions.json);
        if (requestOptions.json.draft === false) {
          state.latest = release;
          state.tags[release.tag_name] = release.target_commitish;
        }
        return release;
      }
      throw new Error(`Fake endpoint not implemented: ${method} ${endpoint}`);
    },
  };
  return { client, state };
}

function stageOptions(client, bundleDir, overrides = {}) {
  return {
    client,
    mode: "stage",
    version: "0.2.0",
    packageVersion: "0.2.0",
    workflowRepository: FULL_REPOSITORY,
    sourceRef: SOURCE_REF,
    sourceCommit: SOURCE_COMMIT,
    bundleDir,
    notes: "Release inicial del launcher.",
    stageRunId: 900,
    artifactId: 700,
    artifactName: "hsl-windows-release-0.2.0-900",
    artifactDigest: ARTIFACT_DIGEST,
    ...overrides,
  };
}

test("preflight accepts first/future releases and rejects equal/lower versions", () => {
  assert.doesNotThrow(() => inspectReleaseState({ version: "0.2.0", sourceCommit: SOURCE_COMMIT, releases: [], latestVersion: null, tagCommit: null }));
  assert.doesNotThrow(() => inspectReleaseState({ version: "0.3.0", sourceCommit: SOURCE_COMMIT, releases: [], latestVersion: "0.2.0", tagCommit: null }));
  assert.doesNotThrow(() => inspectReleaseState({ version: "0.2.1", sourceCommit: SOURCE_COMMIT, releases: [], latestVersion: "0.2.0", tagCommit: null }));
  assert.throws(() => inspectReleaseState({ version: "0.2.0", sourceCommit: SOURCE_COMMIT, releases: [], latestVersion: "0.2.0", tagCommit: null }), /estrictamente superior/);
  assert.throws(() => inspectReleaseState({ version: "0.1.9", sourceCommit: SOURCE_COMMIT, releases: [], latestVersion: "0.2.0", tagCommit: null }), /estrictamente superior/);
});

test("build identity rejects package, repository, ref and remote HEAD mismatches", () => {
  const valid = {
    version: "0.2.0",
    packageVersion: "0.2.0",
    workflowRepository: FULL_REPOSITORY,
    repositoryFullName: FULL_REPOSITORY,
    defaultBranch: "master",
    sourceRef: SOURCE_REF,
    sourceCommit: SOURCE_COMMIT,
    masterHead: SOURCE_COMMIT,
  };
  assert.doesNotThrow(() => validateBuildIdentity(valid));
  assert.throws(() => validateBuildIdentity({ ...valid, packageVersion: "0.3.0" }), /package.json/);
  assert.throws(() => validateBuildIdentity({ ...valid, workflowRepository: "fork/repo" }), /Repositorio no autorizado/);
  assert.throws(() => validateBuildIdentity({ ...valid, sourceRef: "refs/heads/feature" }), /refs\/heads\/master/);
  assert.throws(() => validateBuildIdentity({ ...valid, masterHead: "c".repeat(40) }), /HEAD remoto/);
});

test("release and tag conflicts are explicit while same-SHA draft is reusable", () => {
  const base = { version: "0.2.0", sourceCommit: SOURCE_COMMIT, latestVersion: null, tagCommit: null };
  assert.throws(() => inspectReleaseState({ ...base, releases: [{ tag_name: "v0.2.0", draft: false, prerelease: false }] }), /Release publicada/);
  assert.throws(() => inspectReleaseState({ ...base, releases: [{ tag_name: "v0.2.0", draft: false, prerelease: true }] }), /prerelease/);
  const reusable = inspectReleaseState({ ...base, releases: [{ tag_name: "v0.2.0", draft: true, prerelease: false, target_commitish: SOURCE_COMMIT }] });
  assert.equal(reusable.draft.target_commitish, SOURCE_COMMIT);
  assert.throws(() => inspectReleaseState({ ...base, releases: [{ tag_name: "v0.2.0", draft: true, prerelease: false, target_commitish: "c".repeat(40) }] }), /otro commit/);
  assert.throws(() => inspectReleaseState({ ...base, releases: [], tagCommit: "c".repeat(40) }), /tag.*otro commit/i);
});

test("latest stable release must expose metadata, referenced installer and blockmap", () => {
  const metadata = [
    "version: 0.2.0",
    "files:",
    "  - url: installer.exe",
    `    sha512: ${Buffer.alloc(64).toString("base64")}`,
    "    size: 10",
  ].join("\n");
  const base = { tag_name: "v0.2.0", draft: false, prerelease: false };
  assert.throws(() => validateLatestReleaseContract({ ...base, assets: [] }, metadata), /latest.yml/);
  assert.throws(() => validateLatestReleaseContract({ ...base, assets: [{ name: "latest.yml" }] }, metadata), /installer.exe/);
  assert.throws(() => validateLatestReleaseContract({ ...base, assets: [{ name: "latest.yml" }, { name: "installer.exe" }] }, metadata), /blockmap/);
  assert.equal(validateLatestReleaseContract({ ...base, assets: [{ name: "latest.yml" }, { name: "installer.exe" }, { name: "installer.exe.blockmap" }] }, metadata), "0.2.0");
});

test("stage creates an exact draft, streams missing assets and never publishes", async () => {
  await withReleaseBundle(async ({ bundle }) => {
    const { client, state } = makeFakeGitHub();
    const result = await stageWindowsRelease(stageOptions(client, bundle.bundleDir));
    const create = state.calls.find((call) => call.method === "POST" && call.endpoint.endsWith("/releases"));
    assert.deepEqual(create.json, {
      tag_name: "v0.2.0",
      target_commitish: SOURCE_COMMIT,
      name: "High Score League v0.2.0",
      body: renderDraftBody("Release inicial del launcher.", makeProvenance(stageOptions(client, bundle.bundleDir))),
      draft: true,
      prerelease: false,
      make_latest: "false",
    });
    assert.equal(result.release.draft, true);
    assert.equal(state.calls.filter((call) => call.method === "UPLOAD").length, 4);
    assert.equal(state.calls.some((call) => call.method === "DELETE"), false);
    assert.equal(state.calls.some((call) => call.method === "PATCH" && call.json?.draft === false), false);
  });
});

test("stage reuses identical assets, rejects different bytes and dry-run cannot mutate", async () => {
  await withReleaseBundle(async ({ bundle }) => {
    const provenance = makeProvenance(stageOptions({}, bundle.bundleDir));
    const release = {
      id: 41,
      tag_name: "v0.2.0",
      target_commitish: SOURCE_COMMIT,
      body: renderDraftBody("Release inicial del launcher.", provenance),
      draft: true,
      prerelease: false,
      assets: bundle.assets.map((asset, index) => ({ id: index + 1, name: asset.name, size: asset.size, state: "uploaded", digest: `sha256:${asset.sha256}` })),
    };
    const identical = makeFakeGitHub({ releases: [release] });
    await stageWindowsRelease(stageOptions(identical.client, bundle.bundleDir));
    assert.equal(identical.state.calls.some((call) => call.method === "UPLOAD"), false);

    release.assets[0].digest = `sha256:${"c".repeat(64)}`;
    const conflict = makeFakeGitHub({ releases: [release] });
    await assert.rejects(() => stageWindowsRelease(stageOptions(conflict.client, bundle.bundleDir)), /hash diferente/);
    assert.equal(conflict.state.calls.some((call) => call.method === "DELETE"), false);

    const dry = makeFakeGitHub();
    const result = await stageWindowsRelease(stageOptions(dry.client, "does-not-exist", { mode: "dry-run" }));
    assert.equal(result.mode, "dry-run");
    assert.equal(dry.state.calls.some((call) => ["POST", "PATCH", "DELETE", "UPLOAD"].includes(call.method)), false);
  });
});

test("publish requires confirmation, original provenance/assets and explicit latest PATCH", async () => {
  await withReleaseBundle(async ({ bundle }) => {
    const fake = makeFakeGitHub();
    await stageWindowsRelease(stageOptions(fake.client, bundle.bundleDir));
    await assert.rejects(() => publishWindowsRelease({
      client: fake.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.1",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    }), /Confirmacion incorrecta/);
    const result = await publishWindowsRelease({
      client: fake.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.0",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    });
    const publishCall = fake.state.calls.find((call) => call.method === "PATCH" && call.json?.draft === false);
    assert.deepEqual(publishCall.json, { draft: false, prerelease: false, make_latest: "true" });
    assert.equal(result.latest.id, result.release.id);
    assert.equal(fake.state.tags["v0.2.0"], SOURCE_COMMIT);
  });
});

test("publish refuses a missing or mutated asset before the publication PATCH", async () => {
  await withReleaseBundle(async ({ bundle }) => {
    const fake = makeFakeGitHub();
    await stageWindowsRelease(stageOptions(fake.client, bundle.bundleDir));
    fake.state.releases[0].assets[0].digest = `sha256:${"d".repeat(64)}`;
    await assert.rejects(() => publishWindowsRelease({
      client: fake.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.0",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    }), /SHA-256 remoto distinto/);
    assert.equal(fake.state.calls.some((call) => call.method === "PATCH" && call.json?.draft === false), false);

    const missing = makeFakeGitHub();
    await stageWindowsRelease(stageOptions(missing.client, bundle.bundleDir));
    missing.state.releases[0].assets.pop();
    await assert.rejects(() => publishWindowsRelease({
      client: missing.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.0",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    }), /Assets remotos distintos/);
    assert.equal(missing.state.calls.some((call) => call.method === "PATCH" && call.json?.draft === false), false);
  });
});

test("publish refuses an expired original artifact or a newly obsolete candidate", async () => {
  await withReleaseBundle(async ({ bundle }) => {
    const expired = makeFakeGitHub();
    await stageWindowsRelease(stageOptions(expired.client, bundle.bundleDir));
    expired.state.artifact.expired = true;
    await assert.rejects(() => publishWindowsRelease({
      client: expired.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.0",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    }), /ha expirado/);

    const obsolete = makeFakeGitHub();
    await stageWindowsRelease(stageOptions(obsolete.client, bundle.bundleDir));
    const latestMetadata = [
      "version: 0.3.0",
      "files:",
      "  - url: Future.exe",
      `    sha512: ${Buffer.alloc(64).toString("base64")}`,
      "    size: 10",
    ].join("\n");
    const latest = {
      id: 99,
      tag_name: "v0.3.0",
      target_commitish: "f".repeat(40),
      draft: false,
      prerelease: false,
      assets: [
        { name: "latest.yml", text: latestMetadata },
        { name: "Future.exe" },
        { name: "Future.exe.blockmap" },
      ],
    };
    obsolete.state.releases.push(latest);
    obsolete.state.latest = latest;
    await assert.rejects(() => publishWindowsRelease({
      client: obsolete.client,
      version: "0.2.0",
      confirmation: "PUBLICAR v0.2.0",
      packageVersion: "0.2.0",
      bundleDir: bundle.bundleDir,
    }), /estrictamente superior/);
    assert.equal(obsolete.state.calls.some((call) => call.method === "PATCH" && call.json?.draft === false), false);
  });
});

test("confirmation and error sanitization never expose tokens", () => {
  assert.doesNotThrow(() => assertConfirmation("0.2.0", "PUBLICAR v0.2.0"));
  assert.throws(() => assertConfirmation("0.2.0", "yes"), /exactamente/);
  const token = "ghs_super_secret_value";
  const sanitized = sanitizeErrorText(`Authorization: Bearer ${token} ?token=${token}`, token);
  assert.equal(sanitized.includes(token), false);
  assert.match(sanitized, /REDACTED/);
  assert.equal(normalizeArtifactDigest("e".repeat(64)), `sha256:${"e".repeat(64)}`);
});

test("GitHub client uses injected fetch, sanitizes failures and hashes asset fallback bytes", async () => {
  const token = "ghs_injected_secret";
  const failing = createGitHubClient({
    token,
    fetchImpl: async () => new Response(JSON.stringify({ message: `Bearer ${token}` }), {
      status: 500,
      headers: { "content-type": "application/json", "x-github-request-id": "request-1" },
    }),
  });
  await assert.rejects(async () => failing.request("GET", "/repos/a19xys/High-Score-League"), (error) => {
    assert.equal(error.message.includes(token), false);
    assert.match(error.message, /REDACTED/);
    assert.match(error.message, /request-1/);
    return true;
  });

  const bytes = Buffer.from("authenticated release asset fallback");
  const hashing = createGitHubClient({ token, fetchImpl: async () => new Response(bytes, { status: 200 }) });
  assert.equal(
    await hashing.assetSha256({ name: "asset.exe", url: "https://api.github.com/assets/1", digest: null }),
    crypto.createHash("sha256").update(bytes).digest("hex"),
  );
});
