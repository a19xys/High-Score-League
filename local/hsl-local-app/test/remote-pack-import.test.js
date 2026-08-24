const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const yazl = require("yazl");
const { createSessionResult } = require("../src/session-result");
const {
  MAX_PACK_DESCRIPTOR_BYTES,
  cleanupDownloadedArtifact,
  downloadPackArtifact,
  executeRemotePackImport,
  recoverAlreadyInstalledProvenance,
  requestPackDescriptor,
  validatePackDescriptor,
} = require("../src/remote-pack-import");
const { importPackFromZip } = require("../src/pack-importer");
const { setPackDirectory } = require("../src/pack-directory");
const { loadPackFromDir } = require("../src/pack");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { readPackProvenanceReceipt } = require("../src/pack-provenance");

const PACK_ID = "space-invaders-week-1";
const HSL_ORIGIN = "https://high-score-league.example";
const ARTIFACT_URL = "https://objects.example/packs/temporary.zip?signature=secret";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function descriptor(bytes) {
  return {
    artifact: {
      downloadUrl: ARTIFACT_URL,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    },
    packId: PACK_ID,
    version: 1,
  };
}

function storedSession(token) {
  return {
    providerFingerprint: null,
    schemaVersion: 1,
    session: { access_token: token, expires_at: 2_000_000_000, refresh_token: `refresh-${token}` },
    supabaseUrl: "https://example.supabase.co",
    user: { id: "user-1" },
  };
}

function session(status = "valid", token = "token", revision = 1) {
  return createSessionResult({
    reason: status,
    sessionRevision: revision,
    status,
    storedSession: token ? storedSession(token) : null,
  });
}

function streamResponse(chunks, options = {}) {
  const body = new ReadableStream({
    pull(controller) {
      if (chunks.length === 0) {
        controller.close();
        return;
      }
      controller.enqueue(chunks.shift());
    },
  });
  return new Response(body, {
    headers: options.headers,
    status: options.status || 200,
  });
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-remote-pack-test-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function zipDirectory(sourceDir, zipPath) {
  const zip = new yazl.ZipFile();
  async function add(current, relative = "") {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, entry.name);
      const target = path.posix.join("Official Pack", relative, entry.name);
      if (entry.isDirectory()) await add(sourcePath, path.posix.join(relative, entry.name));
      else zip.addFile(sourcePath, target);
    }
  }
  await add(sourceDir);
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(zipPath)).on("close", resolve).on("error", reject);
    zip.end();
  });
}

test("descriptor v1 válido conserva query HTTPS y aplica límites estrictos", () => {
  const bytes = Buffer.from("zip-data");
  const valid = validatePackDescriptor(descriptor(bytes), PACK_ID);
  assert.equal(valid.artifact.downloadUrl.search, "?signature=secret");
  assert.equal(valid.artifact.sizeBytes, bytes.length);

  const mutations = [
    (value) => { value.version = 2; },
    (value) => { value.packId = "other-pack"; },
    (value) => { value.objectKey = "secret/object.zip"; },
    (value) => { delete value.artifact; },
    (value) => { value.artifact.bucket = "secret"; },
    (value) => { value.artifact.sizeBytes = 0; },
    (value) => { value.artifact.sizeBytes = 1.5; },
    (value) => { value.artifact.sizeBytes = Number.MAX_SAFE_INTEGER; },
    (value) => { value.artifact.sha256 = "abc"; },
    (value) => { value.artifact.downloadUrl = "http://objects.example/a.zip"; },
    (value) => { value.artifact.downloadUrl = "file:///C:/a.zip"; },
    (value) => { value.artifact.downloadUrl = "https://user:secret@objects.example/a.zip"; },
    (value) => { value.artifact.downloadUrl = "https://objects.example/a.zip#secret"; },
    (value) => { value.artifact.downloadUrl = "https://localhost/a.zip"; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(descriptor(bytes));
    mutate(value);
    assert.throws(() => validatePackDescriptor(value, PACK_ID), { code: "invalid_descriptor" });
  }
});

test("descriptor usa bearer sólo en HSL y refresca canónicamente tras 401", async () => {
  const bytes = Buffer.from("zip-data");
  const authorizations = [];
  let refreshes = 0;
  const result = await requestPackDescriptor({
    config: { supabaseUrl: "https://example.supabase.co" },
    fetchImpl: async (_url, init) => {
      authorizations.push(init.headers.Authorization);
      return authorizations.length === 1
        ? new Response("", { status: 401 })
        : new Response(JSON.stringify(descriptor(bytes)), { status: 200 });
    },
    hslOrigin: HSL_ORIGIN,
    packId: PACK_ID,
    resolveSession: async ({ force }) => {
      if (!force) return session("valid", "old-token");
      refreshes += 1;
      return session("refreshed", "new-token", 2);
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(refreshes, 1);
  assert.deepEqual(authorizations, ["Bearer old-token", "Bearer new-token"]);
});

test("descriptor 403 conserva la autoridad de sesión y requiere login", async () => {
  const result = await requestPackDescriptor({
    config: { supabaseUrl: "https://example.supabase.co" },
    fetchImpl: async () => new Response("", { status: 403 }),
    hslOrigin: HSL_ORIGIN,
    packId: PACK_ID,
    resolveSession: async () => session(),
  });
  assert.equal(result.status, "requires-login");
});

test("descriptor sobredimensionado, 404 y sesión ausente fallan sin artefacto", async () => {
  const base = {
    config: { supabaseUrl: "https://example.supabase.co" },
    hslOrigin: HSL_ORIGIN,
    packId: PACK_ID,
    resolveSession: async () => session(),
  };
  const oversized = await requestPackDescriptor({
    ...base,
    fetchImpl: async () => new Response(Buffer.alloc(MAX_PACK_DESCRIPTOR_BYTES + 1), { status: 200 }),
  });
  const missing = await requestPackDescriptor({
    ...base,
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  let fetches = 0;
  const login = await requestPackDescriptor({
    ...base,
    fetchImpl: async () => { fetches += 1; return new Response("", { status: 200 }); },
    resolveSession: async () => createSessionResult({ status: "missing" }),
  });
  assert.equal(oversized.status, "remote-error");
  assert.equal(missing.status, "pack-unavailable");
  assert.equal(login.status, "requires-login");
  assert.equal(fetches, 0);
});

test("downloader escribe múltiples chunks, verifica bytes/hash y no usa arrayBuffer", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("a streamed fake zip split across chunks");
    let receivedAuthorization = false;
    const download = await downloadPackArtifact({
      descriptor: validatePackDescriptor(descriptor(bytes), PACK_ID),
      fetchImpl: async (_url, init) => {
        receivedAuthorization = Object.keys(init.headers || {}).some((name) => name.toLowerCase() === "authorization");
        const response = streamResponse([
          bytes.subarray(0, 3),
          bytes.subarray(3, 12),
          bytes.subarray(12),
        ], { headers: { "content-length": String(bytes.length) } });
        response.arrayBuffer = () => { throw new Error("whole artifact must not be materialized"); };
        return response;
      },
      tempBaseDir,
    });
    assert.equal(receivedAuthorization, false);
    assert.equal(download.bytes, bytes.length);
    assert.deepEqual(await fsp.readFile(download.filePath), bytes);
    await cleanupDownloadedArtifact(download);
    assert.deepEqual(await fsp.readdir(tempBaseDir), []);
  });
});

test("downloader rechaza tamaño corto/largo, hash, HTTP y redirect y limpia temporales", async () => {
  await withTempDir(async (tempBaseDir) => {
    const expected = Buffer.from("expected zip bytes");
    const cases = [
      {
        expected: descriptor(expected),
        response: () => streamResponse([expected.subarray(0, expected.length - 1)]),
      },
      {
        expected: descriptor(expected),
        response: () => streamResponse([Buffer.concat([expected, Buffer.from("x")])]),
      },
      {
        expected: { ...descriptor(expected), artifact: { ...descriptor(expected).artifact, sha256: "0".repeat(64) } },
        response: () => streamResponse([expected]),
      },
      {
        expected: descriptor(expected),
        response: () => new Response("missing", { status: 404 }),
      },
      {
        expected: descriptor(expected),
        response: () => new Response("redirect", { headers: { location: ARTIFACT_URL }, status: 302 }),
      },
    ];
    for (const entry of cases) {
      await assert.rejects(() => downloadPackArtifact({
        descriptor: validatePackDescriptor(entry.expected, PACK_ID),
        fetchImpl: async () => entry.response(),
        tempBaseDir,
      }));
      assert.deepEqual(await fsp.readdir(tempBaseDir), []);
    }
  });
});

test("artifact 401/403 es remote-error y nunca se atribuye a la sesión HSL", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("fake zip");
    for (const artifactStatus of [401, 403]) {
      let fetches = 0;
      const result = await executeRemotePackImport({
        config: { supabaseUrl: "https://example.supabase.co" },
        fetchImpl: async () => {
          fetches += 1;
          return fetches === 1
            ? new Response(JSON.stringify(descriptor(bytes)), { status: 200 })
            : new Response("", { status: artifactStatus });
        },
        hslOrigin: HSL_ORIGIN,
        importZip: async () => { throw new Error("importer must not run"); },
        packId: PACK_ID,
        resolveSession: async () => session(),
        tempBaseDir,
      });
      assert.notEqual(result.status, "requires-login", String(artifactStatus));
      assert.equal(result.status, "remote-error", String(artifactStatus));
      assert.deepEqual(await fsp.readdir(tempBaseDir), []);
    }
  });
});

test("artifact 404/410/503 conserva pack-unavailable", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("fake zip");
    for (const artifactStatus of [404, 410, 503]) {
      let fetches = 0;
      const result = await executeRemotePackImport({
        config: { supabaseUrl: "https://example.supabase.co" },
        fetchImpl: async () => {
          fetches += 1;
          return fetches === 1
            ? new Response(JSON.stringify(descriptor(bytes)), { status: 200 })
            : new Response("", { status: artifactStatus });
        },
        hslOrigin: HSL_ORIGIN,
        importZip: async () => { throw new Error("importer must not run"); },
        packId: PACK_ID,
        resolveSession: async () => session(),
        tempBaseDir,
      });
      assert.equal(result.status, "pack-unavailable", String(artifactStatus));
      assert.deepEqual(await fsp.readdir(tempBaseDir), []);
    }
  });
});

test("fallo filesystem preparando el temporal es remote-error y no invalid-pack", async () => {
  await withTempDir(async (root) => {
    const bytes = Buffer.from("fake zip");
    const notDirectory = path.join(root, "not-a-directory");
    await fsp.writeFile(notDirectory, "fixture", "utf8");
    let fetches = 0;
    const result = await executeRemotePackImport({
      config: { supabaseUrl: "https://example.supabase.co" },
      fetchImpl: async () => {
        fetches += 1;
        return new Response(JSON.stringify(descriptor(bytes)), { status: 200 });
      },
      hslOrigin: HSL_ORIGIN,
      importZip: async () => { throw new Error("importer must not run"); },
      packId: PACK_ID,
      resolveSession: async () => session(),
      tempBaseDir: path.join(notDirectory, "nested"),
    });
    assert.notEqual(result.status, "invalid-pack");
    assert.equal(result.status, "remote-error");
    assert.equal(fetches, 1);
    assert.deepEqual(await fsp.readdir(root), ["not-a-directory"]);
  });
});

test("downloader respeta abort y timeout y limpia temporales", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("zip");
    const waitForAbort = async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    const external = new AbortController();
    external.abort("shutdown");
    await assert.rejects(() => downloadPackArtifact({
      descriptor: validatePackDescriptor(descriptor(bytes), PACK_ID),
      fetchImpl: waitForAbort,
      signal: external.signal,
      tempBaseDir,
    }), { code: "cancelled" });

    let markFetchStarted;
    const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
    const waitForInFlightAbort = async (_url, init) => {
      markFetchStarted();
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    };
    const inFlightExternal = new AbortController();
    const inFlightDownload = downloadPackArtifact({
      descriptor: validatePackDescriptor(descriptor(bytes), PACK_ID),
      fetchImpl: waitForInFlightAbort,
      signal: inFlightExternal.signal,
      tempBaseDir,
      timeoutMs: 1000,
    });
    await fetchStarted;
    inFlightExternal.abort("shutdown");
    await assert.rejects(inFlightDownload, { code: "cancelled" });
    assert.deepEqual(await fsp.readdir(tempBaseDir), []);

    await assert.rejects(() => downloadPackArtifact({
      descriptor: validatePackDescriptor(descriptor(bytes), PACK_ID),
      fetchImpl: waitForAbort,
      tempBaseDir,
      timeoutMs: 20,
    }), { code: "offline" });
    assert.deepEqual(await fsp.readdir(tempBaseDir), []);
  });
});

test("product path descriptor→stream→import limpia el ZIP incluso con éxito", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("fake zip streamed into importer");
    const phases = [];
    let fetchCount = 0;
    let importedPath = null;
    const result = await executeRemotePackImport({
      config: { supabaseUrl: "https://example.supabase.co" },
      fetchImpl: async (_url, init) => {
        fetchCount += 1;
        if (fetchCount === 1) return new Response(JSON.stringify(descriptor(bytes)), { status: 200 });
        assert.equal(init.headers.Authorization, undefined);
        return streamResponse([bytes.subarray(0, 5), bytes.subarray(5)]);
      },
      hslOrigin: HSL_ORIGIN,
      importZip: async (zipPath, options) => {
        importedPath = zipPath;
        assert.equal(options.expectedPackId, PACK_ID);
        assert.deepEqual(await fsp.readFile(zipPath), bytes);
        return { ok: true, state: { selected: PACK_ID } };
      },
      onPhase: (phase) => phases.push(phase),
      packId: PACK_ID,
      resolveSession: async () => session(),
      tempBaseDir,
    });
    assert.equal(result.status, "imported");
    assert.deepEqual(result.importResult.state, { selected: PACK_ID });
    await assert.rejects(fsp.stat(importedPath), /ENOENT/);
    assert.deepEqual(await fsp.readdir(tempBaseDir), []);
    assert.deepEqual(phases, ["Preparando pack", "Descargando pack", "Verificando pack", "Importando pack"]);
  });
});

test("product path traduce carreras, identidad y ZIP inválido sin excepciones crudas", async () => {
  await withTempDir(async (tempBaseDir) => {
    const bytes = Buffer.from("fake zip");
    const expected = new Map([
      ["duplicate_pack_id", "remote-error"],
      ["destination_collision", "installation-conflict"],
      ["unexpected_pack_id", "unexpected-pack-id"],
      ["invalid_pack", "invalid-pack"],
    ]);
    for (const [code, status] of expected) {
      let fetches = 0;
      const result = await executeRemotePackImport({
        config: { supabaseUrl: "https://example.supabase.co" },
        fetchImpl: async () => {
          fetches += 1;
          return fetches === 1
            ? new Response(JSON.stringify(descriptor(bytes)), { status: 200 })
            : streamResponse([bytes]);
        },
        hslOrigin: HSL_ORIGIN,
        importZip: async () => ({ code, ok: false }),
        packId: PACK_ID,
        resolveSession: async () => session(),
        tempBaseDir,
      });
      assert.equal(result.status, status);
      assert.deepEqual(await fsp.readdir(tempBaseDir), []);
    }
  });
});

test("real importer recovers install-to-receipt crash only after re-verifying the official artifact", async (t) => {
  await withTempDir(async (root) => {
    const packId = "space-invaders-recovery-r2";
    const source = path.join(root, "source-pack");
    await fsp.mkdir(path.join(source, "roms"), { recursive: true });
    await fsp.mkdir(path.join(source, "scripts"), { recursive: true });
    await fsp.writeFile(path.join(source, "roms", "invaders.zip"), "rom", "utf8");
    await fsp.writeFile(path.join(source, "scripts", "invaders.lua"), "return { observe_capture = function() end }", "utf8");
    await fsp.writeFile(path.join(source, "pack.json"), `${JSON.stringify({
      packVersion: 2,
      packId,
      gameId: "space-invaders",
      rom: "invaders",
      seasonId: "season-1",
      seasonSlug: "season-1",
      seasonName: "Season 1",
      weekId: "week-1",
      weekNumber: 1,
      webBaseUrl: HSL_ORIGIN,
      runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
      mame: {
        romPath: "roms",
        launchArgs: [],
        profiles: { practice: { launchArgs: [] }, competition: { launchArgs: [], integrity: { version: 1, mameVersion: "0.287", dips: [] } } },
      },
      capture: { mode: "plugin", pluginName: "hsl-score", adapter: "scripts/invaders.lua", automatic: { version: 1, strategy: "fixture-v1" } },
    }, null, 2)}\n`, "utf8");
    const loaded = loadPackFromDir(source);
    assert.equal(loaded.loaded, true);
    await writeCompetitionManifest(loaded.pack);
    const artifactPath = path.join(root, "official.zip");
    await zipDirectory(source, artifactPath);
    const artifactBytes = await fsp.readFile(artifactPath);
    const config = { userDataDir: path.join(root, "userData") };
    const library = path.join(root, "library");
    await fsp.mkdir(library, { recursive: true });
    await setPackDirectory(config, library);
    const descriptorValue = {
      version: 1,
      packId,
      artifact: { downloadUrl: ARTIFACT_URL, sha256: sha256(artifactBytes), sizeBytes: artifactBytes.length },
    };
    const fetchForAttempt = () => {
      let count = 0;
      return async () => (++count === 1
        ? new Response(JSON.stringify(descriptorValue), { status: 200 })
        : streamResponse([artifactBytes]));
    };
    const common = {
      config,
      hslOrigin: HSL_ORIGIN,
      importZip: (zipPath, importOptions) => importPackFromZip(zipPath, config, importOptions),
      packId,
      resolveSession: async () => session(),
      tempBaseDir: path.join(root, "downloads"),
    };
    await fsp.mkdir(common.tempBaseDir, { recursive: true });
    const crashed = await executeRemotePackImport({
      ...common,
      fetchImpl: fetchForAttempt(),
      writePackProvenanceReceiptImpl: async () => { throw new Error("simulated-crash-after-install"); },
    });
    assert.equal(crashed.status, "remote-error");
    assert.equal(readPackProvenanceReceipt(config, packId).ok, false);

    await recoverAlreadyInstalledProvenance(common, descriptorValue, {
      bytes: artifactBytes.length,
      filePath: artifactPath,
    });
    await fsp.rm(readPackProvenanceReceipt(config, packId).receiptPath);

    const recovered = await executeRemotePackImport({ ...common, fetchImpl: fetchForAttempt() });
    assert.equal(recovered.status, "already-installed", JSON.stringify(recovered));
    assert.equal(recovered.provenance.receipt.packId, packId);
    assert.equal(readPackProvenanceReceipt(config, packId).ok, true);
  });
});
