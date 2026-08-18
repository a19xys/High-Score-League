const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { parseLatestMetadata, validateWindowsReleaseBundle, SOURCE_REF } = require("./windows-release-bundle");
const {
  assertStableVersion,
  assertVersionIsNewer,
  compareStableVersions,
  tagForVersion,
  versionFromTag,
} = require("./windows-release-version");

const OWNER = "a19xys";
const REPO = "High-Score-League";
const FULL_REPOSITORY = `${OWNER}/${REPO}`;
const DEFAULT_BRANCH = "master";
const API_VERSION = "2026-03-10";
const PROVENANCE_START = "<!-- hsl-windows-release:";
const PROVENANCE_END = "-->";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeErrorText(value, token) {
  let text = String(value || "Error GitHub desconocido");
  if (token) text = text.split(token).join("[REDACTED]");
  return text
    .replace(/Authorization\s*:\s*[^\s,}]+/gi, "Authorization: [REDACTED]")
    .replace(/Bearer\s+[^\s,}]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|signature|sig|x-amz-[^=]+)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 1000);
}

function createGitHubClient(options = {}) {
  const token = String(options.token || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  invariant(token, "Falta GITHUB_TOKEN.");
  invariant(typeof fetchImpl === "function", "fetch no disponible.");
  const apiBase = options.apiBase || "https://api.github.com";
  const uploadBase = options.uploadBase || "https://uploads.github.com";

  async function request(method, endpoint, requestOptions = {}) {
    const isAbsolute = /^https:\/\//.test(endpoint);
    const url = isAbsolute ? endpoint : `${apiBase}${endpoint}`;
    const headers = {
      Accept: requestOptions.accept || "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "hsl-windows-release-pipeline",
      ...requestOptions.headers,
    };
    let body;
    if (requestOptions.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(requestOptions.json);
    } else if (requestOptions.body !== undefined) {
      body = requestOptions.body;
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      ...(requestOptions.duplex ? { duplex: requestOptions.duplex } : {}),
    });
    if (requestOptions.allow404 && response.status === 404) return null;
    if (!response.ok) {
      const requestId = response.headers?.get?.("x-github-request-id");
      const contentType = response.headers?.get?.("content-type") || "";
      let message = response.statusText;
      if (contentType.includes("json")) {
        const payload = await response.json().catch(() => null);
        message = payload?.message || message;
      } else {
        message = await response.text().catch(() => message);
      }
      const suffix = requestId ? ` Request ID: ${requestId}.` : "";
      throw new Error(`GitHub ${method} ${new URL(url).pathname}: ${response.status} ${sanitizeErrorText(message, token)}.${suffix}`);
    }
    if (requestOptions.response === "response") return response;
    if (response.status === 204) return null;
    return response.json();
  }

  async function listReleases() {
    const releases = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await request("GET", `/repos/${OWNER}/${REPO}/releases?per_page=100&page=${page}`);
      releases.push(...batch);
      if (batch.length < 100) return releases;
    }
    throw new Error("El historial supera 2000 Releases; preflight detenido para no inspeccionarlo parcialmente.");
  }

  async function resolveTag(tag) {
    const ref = await request("GET", `/repos/${OWNER}/${REPO}/git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true });
    if (!ref) return null;
    let object = ref.object;
    for (let depth = 0; depth < 5 && object?.type === "tag"; depth += 1) {
      const annotated = await request("GET", `/repos/${OWNER}/${REPO}/git/tags/${object.sha}`);
      object = annotated.object;
    }
    invariant(object?.type === "commit" && /^[0-9a-f]{40}$/.test(object.sha), `El tag ${tag} no resuelve a un commit Git valido.`);
    return object.sha;
  }

  async function assetSha256(asset) {
    if (typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
      return asset.digest.slice("sha256:".length);
    }
    const response = await request("GET", asset.url, {
      accept: "application/octet-stream",
      response: "response",
    });
    invariant(response.body, `GitHub no devolvio bytes para ${asset.name}.`);
    const hash = crypto.createHash("sha256");
    for await (const chunk of response.body) hash.update(chunk);
    return hash.digest("hex");
  }

  async function assetText(asset) {
    const response = await request("GET", asset.url, {
      accept: "application/octet-stream",
      response: "response",
    });
    return response.text();
  }

  async function uploadAsset(releaseId, asset) {
    const stats = await fsp.stat(asset.path);
    invariant(stats.size === asset.size, `El asset local cambio antes de subirlo: ${asset.name}.`);
    return request("POST", `${uploadBase}/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, {
      accept: "application/vnd.github+json",
      body: fs.createReadStream(asset.path),
      duplex: "half",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(asset.size),
      },
    });
  }

  return {
    assetSha256,
    assetText,
    listReleases,
    request,
    resolveTag,
    uploadAsset,
  };
}

function validateBuildIdentity(input) {
  assertStableVersion(input.version);
  invariant(input.packageVersion === input.version, `Input ${input.version} no coincide exactamente con package.json ${input.packageVersion}.`);
  invariant(input.workflowRepository === FULL_REPOSITORY, `Repositorio no autorizado: ${input.workflowRepository}.`);
  invariant(input.repositoryFullName === FULL_REPOSITORY, `La API resolvio un repositorio inesperado: ${input.repositoryFullName}.`);
  invariant(input.defaultBranch === DEFAULT_BRANCH, `La rama por defecto debe ser ${DEFAULT_BRANCH}.`);
  invariant(input.sourceRef === SOURCE_REF, `El workflow debe ejecutarse desde ${SOURCE_REF}.`);
  invariant(/^[0-9a-f]{40}$/.test(input.sourceCommit), "github.sha no es un SHA Git completo.");
  invariant(input.sourceCommit === input.masterHead, `github.sha ${input.sourceCommit} no coincide con HEAD remoto de master ${input.masterHead}.`);
}

function validateLatestReleaseContract(release, metadataSource) {
  invariant(release && !release.draft && !release.prerelease, "La Release latest no es estable/publicada.");
  const assetNames = new Set((release.assets || []).map((asset) => asset.name));
  invariant(assetNames.has("latest.yml"), `La Release latest ${release.tag_name} no contiene latest.yml.`);
  const metadata = parseLatestMetadata(metadataSource);
  invariant(assetNames.has(metadata.installerName), `La Release latest ${release.tag_name} no contiene ${metadata.installerName}.`);
  invariant(assetNames.has(`${metadata.installerName}.blockmap`), `La Release latest ${release.tag_name} no contiene ${metadata.installerName}.blockmap.`);
  const tagVersion = versionFromTag(release.tag_name);
  invariant(tagVersion && tagVersion === metadata.version, `La Release latest ${release.tag_name} tiene metadata de version incoherente.`);
  return tagVersion;
}

function inspectReleaseState(input) {
  const tag = tagForVersion(input.version);
  const matches = input.releases.filter((release) => release.tag_name === tag);
  invariant(matches.length <= 1, `Existen varias Releases para ${tag}; estado remoto ambiguo.`);
  const match = matches[0] || null;
  if (match && !match.draft) {
    throw new Error(match.prerelease ? `Ya existe una prerelease publicada ${tag}.` : `Ya existe una Release publicada ${tag}.`);
  }
  if (match) {
    invariant(!match.prerelease, `El draft ${tag} esta marcado como prerelease.`);
    invariant(match.target_commitish === input.sourceCommit, `El draft ${tag} apunta a otro commit: ${match.target_commitish}.`);
  }
  if (input.tagCommit) {
    invariant(input.tagCommit === input.sourceCommit, `El tag ${tag} apunta a otro commit: ${input.tagCommit}.`);
    invariant(match?.draft, `El tag ${tag} ya existe sin un draft reutilizable inequívoco.`);
  }
  if (input.latestVersion) assertVersionIsNewer(input.version, input.latestVersion);
  return { draft: match, tag };
}

async function remotePreflight(client, input) {
  const repository = await client.request("GET", `/repos/${OWNER}/${REPO}`);
  const master = await client.request("GET", `/repos/${OWNER}/${REPO}/branches/${DEFAULT_BRANCH}`);
  if (input.requireCurrentHead !== false) {
    validateBuildIdentity({
      ...input,
      repositoryFullName: repository.full_name,
      defaultBranch: repository.default_branch,
      masterHead: master.commit?.sha,
    });
  } else {
    assertStableVersion(input.version);
    invariant(input.packageVersion === input.version, `Input ${input.version} no coincide exactamente con package.json ${input.packageVersion}.`);
    invariant(repository.full_name === FULL_REPOSITORY && repository.default_branch === DEFAULT_BRANCH, "Repositorio/default branch inesperados.");
  }

  const releases = await client.listReleases();
  const latest = await client.request("GET", `/repos/${OWNER}/${REPO}/releases/latest`, { allow404: true });
  const publishedStableVersions = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => versionFromTag(release.tag_name))
    .filter(Boolean)
    .sort(compareStableVersions);
  const highestStableVersion = publishedStableVersions.at(-1) || null;
  let latestVersion = highestStableVersion;
  if (latest) {
    const metadataAsset = (latest.assets || []).find((asset) => asset.name === "latest.yml");
    invariant(metadataAsset, `La Release latest ${latest.tag_name} no contiene latest.yml.`);
    const endpointVersion = validateLatestReleaseContract(latest, await client.assetText(metadataAsset));
    invariant(endpointVersion === highestStableVersion, `/releases/latest (${endpointVersion}) no coincide con la mayor Release estable (${highestStableVersion || "ninguna"}).`);
  } else {
    invariant(!highestStableVersion, `Existen Releases estables hasta ${highestStableVersion}, pero /releases/latest no existe.`);
  }
  const tagCommit = await client.resolveTag(tagForVersion(input.version));
  const state = inspectReleaseState({
    version: input.version,
    sourceCommit: input.sourceCommit,
    releases,
    latestVersion,
    tagCommit,
  });
  return { ...state, latest, latestVersion, masterHead: master.commit?.sha, releases, repository };
}

function validateProvenance(provenance, expected = {}) {
  invariant(provenance?.schemaVersion === 1, "Provenance ausente o con schema no soportado.");
  assertStableVersion(provenance.version);
  invariant(provenance.tag === tagForVersion(provenance.version), "Provenance contiene tag incoherente.");
  invariant(/^[0-9a-f]{40}$/.test(provenance.sourceCommit), "Provenance contiene sourceCommit invalido.");
  invariant(provenance.sourceRef === SOURCE_REF, "Provenance contiene sourceRef invalido.");
  invariant(Number.isSafeInteger(provenance.stageRunId) && provenance.stageRunId > 0, "Provenance contiene stageRunId invalido.");
  invariant(Number.isSafeInteger(provenance.artifactId) && provenance.artifactId > 0, "Provenance contiene artifactId invalido.");
  invariant(typeof provenance.artifactName === "string" && /^hsl-windows-release-[0-9.]+-[0-9]+$/.test(provenance.artifactName), "Provenance contiene artifactName invalido.");
  invariant(/^sha256:[0-9a-f]{64}$/.test(provenance.artifactDigest), "Provenance contiene artifactDigest invalido.");
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined) invariant(provenance[key] === value, `Provenance ${key} no coincide con el valor esperado.`);
  }
  return provenance;
}

function parseProvenance(body) {
  const start = String(body || "").indexOf(PROVENANCE_START);
  invariant(start >= 0, "El draft no contiene provenance HSL.");
  const jsonStart = start + PROVENANCE_START.length;
  const end = String(body).indexOf(PROVENANCE_END, jsonStart);
  invariant(end >= 0, "El comentario de provenance no esta cerrado.");
  return validateProvenance(JSON.parse(String(body).slice(jsonStart, end).trim()));
}

function renderDraftBody(notes, provenance) {
  validateProvenance(provenance);
  const visibleNotes = String(notes || "").trim() || `Launcher ${provenance.version}. Fuente: ${provenance.sourceCommit}.`;
  invariant(!visibleNotes.includes(PROVENANCE_START), "Las release notes contienen el marcador reservado de provenance.");
  return `${visibleNotes}\n\n${PROVENANCE_START}\n${JSON.stringify(provenance)}\n${PROVENANCE_END}`;
}

function normalizeArtifactDigest(digest) {
  const value = String(digest || "");
  if (/^[0-9a-f]{64}$/.test(value)) return `sha256:${value}`;
  invariant(/^sha256:[0-9a-f]{64}$/.test(value), "Actions Artifact digest invalido.");
  return value;
}

function makeProvenance(input) {
  return validateProvenance({
    schemaVersion: 1,
    version: input.version,
    tag: tagForVersion(input.version),
    sourceCommit: input.sourceCommit,
    sourceRef: input.sourceRef,
    stageRunId: Number(input.stageRunId),
    artifactId: Number(input.artifactId),
    artifactName: input.artifactName,
    artifactDigest: normalizeArtifactDigest(input.artifactDigest),
  });
}

function verifyReleaseShape(release, expected, draft) {
  invariant(release.id === expected.releaseId, "Release ID distinto del esperado.");
  invariant(release.tag_name === expected.tag, "Tag remoto distinto del esperado.");
  invariant(release.target_commitish === expected.sourceCommit, "target_commitish remoto distinto del commit construido.");
  invariant(release.draft === draft, `La Release debe tener draft=${draft}.`);
  invariant(release.prerelease === false, "La Release no puede ser prerelease.");
}

async function verifyRemoteAssets(client, release, localAssets) {
  const remoteAssets = release.assets || [];
  const localNames = localAssets.map((asset) => asset.name).sort();
  const remoteNames = remoteAssets.map((asset) => asset.name).sort();
  invariant(JSON.stringify(localNames) === JSON.stringify(remoteNames), `Assets remotos distintos del bundle: ${remoteNames.join(", ")}.`);
  for (const local of localAssets) {
    const remote = remoteAssets.find((asset) => asset.name === local.name);
    invariant(remote.state === "uploaded", `Asset remoto ${local.name} no esta uploaded.`);
    invariant(remote.size === local.size, `Size remoto distinto para ${local.name}.`);
    invariant(await client.assetSha256(remote) === local.sha256, `SHA-256 remoto distinto para ${local.name}.`);
  }
}

async function uploadOrVerifyAssets(client, release, localAssets) {
  const expectedNames = new Set(localAssets.map((asset) => asset.name));
  for (const remote of release.assets || []) invariant(expectedNames.has(remote.name), `El draft contiene un asset inesperado: ${remote.name}.`);
  for (const local of localAssets) {
    const remote = (release.assets || []).find((asset) => asset.name === local.name);
    if (remote) {
      invariant(remote.size === local.size, `Asset ${local.name} existe con size diferente; no se sustituira.`);
      invariant(await client.assetSha256(remote) === local.sha256, `Asset ${local.name} existe con hash diferente; no se sustituira.`);
    } else {
      const uploaded = await client.uploadAsset(release.id, local);
      invariant(uploaded.name === local.name, `GitHub renombro el asset ${local.name} a ${uploaded.name}.`);
    }
  }
}

async function stageWindowsRelease(options) {
  invariant(options.mode === "dry-run" || options.mode === "stage", "mode debe ser dry-run o stage.");
  const preflight = await remotePreflight(options.client, {
    version: options.version,
    packageVersion: options.packageVersion,
    workflowRepository: options.workflowRepository,
    sourceRef: options.sourceRef,
    sourceCommit: options.sourceCommit,
    requireCurrentHead: true,
  });
  if (options.mode === "dry-run") return { mode: "dry-run", preflight };

  const bundle = await validateWindowsReleaseBundle({
    bundleDir: options.bundleDir,
    expectedVersion: options.version,
    sourceCommit: options.sourceCommit,
    sourceRef: options.sourceRef,
  });
  const provenance = makeProvenance(options);
  let release = preflight.draft;
  if (release?.body?.includes(PROVENANCE_START)) {
    const prior = parseProvenance(release.body);
    invariant(prior.version === options.version && prior.sourceCommit === options.sourceCommit, "El draft existente tiene provenance de otra build.");
  }
  if (!release) {
    release = await options.client.request("POST", `/repos/${OWNER}/${REPO}/releases`, {
      json: {
        tag_name: provenance.tag,
        target_commitish: options.sourceCommit,
        name: `High Score League ${provenance.tag}`,
        body: renderDraftBody(options.notes, provenance),
        draft: true,
        prerelease: false,
        make_latest: "false",
      },
    });
  }
  verifyReleaseShape(release, { releaseId: release.id, tag: provenance.tag, sourceCommit: options.sourceCommit }, true);
  await uploadOrVerifyAssets(options.client, release, bundle.assets);
  release = await options.client.request("GET", `/repos/${OWNER}/${REPO}/releases/${release.id}`);
  verifyReleaseShape(release, { releaseId: release.id, tag: provenance.tag, sourceCommit: options.sourceCommit }, true);
  await verifyRemoteAssets(options.client, release, bundle.assets);
  const body = renderDraftBody(options.notes, provenance);
  if (release.body !== body) {
    release = await options.client.request("PATCH", `/repos/${OWNER}/${REPO}/releases/${release.id}`, { json: { body } });
  }
  verifyReleaseShape(release, { releaseId: release.id, tag: provenance.tag, sourceCommit: options.sourceCommit }, true);
  validateProvenance(parseProvenance(release.body), provenance);
  const stagedTagCommit = await options.client.resolveTag(provenance.tag);
  if (stagedTagCommit) invariant(stagedTagCommit === options.sourceCommit, "El tag del draft no resuelve al sourceCommit exacto.");
  return { mode: "stage", release, provenance, bundle };
}

function assertConfirmation(version, confirmation) {
  const expected = `PUBLICAR ${tagForVersion(version)}`;
  invariant(confirmation === expected, `Confirmacion incorrecta; debe ser exactamente: ${expected}`);
}

async function findDraftAndProvenance(client, version, confirmation) {
  assertConfirmation(version, confirmation);
  const tag = tagForVersion(version);
  const releases = await client.listReleases();
  const matches = releases.filter((release) => release.tag_name === tag);
  invariant(matches.length === 1, `Se esperaba exactamente un draft ${tag}; encontrados: ${matches.length}.`);
  const draft = matches[0];
  invariant(draft.draft === true && draft.prerelease === false, `${tag} no es un draft estable publicable.`);
  const provenance = validateProvenance(parseProvenance(draft.body), { version, tag });
  invariant(draft.target_commitish === provenance.sourceCommit, "El draft y provenance declaran commits distintos.");
  const artifact = await client.request("GET", `/repos/${OWNER}/${REPO}/actions/artifacts/${provenance.artifactId}`);
  invariant(artifact.id === provenance.artifactId, "Artifact ID remoto incoherente.");
  invariant(artifact.name === provenance.artifactName, "Artifact name remoto incoherente.");
  invariant(artifact.digest === provenance.artifactDigest, "Artifact digest remoto incoherente.");
  invariant(artifact.expired === false, "El Actions Artifact original ha expirado.");
  invariant(artifact.workflow_run?.id === provenance.stageRunId, "El artifact no pertenece al Stage run registrado.");
  invariant(artifact.workflow_run?.head_sha === provenance.sourceCommit, "El artifact no pertenece al sourceCommit registrado.");
  invariant(artifact.workflow_run?.head_branch === DEFAULT_BRANCH, "El artifact no procede de master.");
  const stageRun = await client.request("GET", `/repos/${OWNER}/${REPO}/actions/runs/${provenance.stageRunId}`);
  invariant(stageRun.id === provenance.stageRunId, "Stage workflow run ID incoherente.");
  invariant(stageRun.event === "workflow_dispatch", "El run de provenance no fue manual.");
  invariant(stageRun.path === ".github/workflows/windows-release-stage.yml", "El run de provenance no pertenece al workflow Stage autorizado.");
  invariant(stageRun.head_branch === DEFAULT_BRANCH && stageRun.head_sha === provenance.sourceCommit, "El Stage run no corresponde a master/sourceCommit.");
  invariant(stageRun.status === "completed" && stageRun.conclusion === "success", "El Stage workflow run original no termino correctamente.");
  invariant(stageRun.repository?.full_name === FULL_REPOSITORY, "El Stage run pertenece a otro repositorio.");
  return { draft, provenance, artifact, stageRun };
}

async function assertSourceInMasterHistory(client, sourceCommit, masterHead) {
  const commit = await client.request("GET", `/repos/${OWNER}/${REPO}/commits/${sourceCommit}`);
  invariant(commit.sha === sourceCommit, "sourceCommit ya no es un commit valido del repositorio.");
  const comparison = await client.request("GET", `/repos/${OWNER}/${REPO}/compare/${sourceCommit}...${masterHead}`);
  invariant(comparison.status === "ahead" || comparison.status === "identical", "sourceCommit ya no pertenece a la historia de master.");
}

async function readPackageVersionAtCommit(client, sourceCommit) {
  const file = await client.request("GET", `/repos/${OWNER}/${REPO}/contents/local/hsl-local-app/package.json?ref=${sourceCommit}`);
  invariant(file?.encoding === "base64" && typeof file.content === "string", "GitHub no devolvio package.json en base64 para sourceCommit.");
  let metadata;
  try {
    metadata = JSON.parse(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8"));
  } catch {
    throw new Error("package.json de sourceCommit no es JSON valido.");
  }
  assertStableVersion(metadata.version, "package.json.version de sourceCommit");
  return metadata.version;
}

async function publishWindowsRelease(options) {
  assertConfirmation(options.version, options.confirmation);
  const located = await findDraftAndProvenance(options.client, options.version, options.confirmation);
  const bundle = await validateWindowsReleaseBundle({
    bundleDir: options.bundleDir,
    expectedVersion: options.version,
    sourceCommit: located.provenance.sourceCommit,
    sourceRef: SOURCE_REF,
  });
  const sourcePackageVersion = await readPackageVersionAtCommit(options.client, located.provenance.sourceCommit);
  const preflight = await remotePreflight(options.client, {
    version: options.version,
    packageVersion: sourcePackageVersion,
    sourceCommit: located.provenance.sourceCommit,
    requireCurrentHead: false,
  });
  invariant(preflight.draft?.id === located.draft.id, "El draft cambio durante el preflight de publicacion.");
  await assertSourceInMasterHistory(options.client, located.provenance.sourceCommit, preflight.masterHead);
  const freshDraft = await options.client.request("GET", `/repos/${OWNER}/${REPO}/releases/${located.draft.id}`);
  verifyReleaseShape(freshDraft, {
    releaseId: located.draft.id,
    tag: located.provenance.tag,
    sourceCommit: located.provenance.sourceCommit,
  }, true);
  validateProvenance(parseProvenance(freshDraft.body), located.provenance);
  await verifyRemoteAssets(options.client, freshDraft, bundle.assets);
  const finalPreflight = await remotePreflight(options.client, {
    version: options.version,
    packageVersion: sourcePackageVersion,
    sourceCommit: located.provenance.sourceCommit,
    requireCurrentHead: false,
  });
  invariant(finalPreflight.draft?.id === freshDraft.id, "El estado remoto cambio justo antes de publicar.");
  invariant(finalPreflight.latest?.id === preflight.latest?.id, "La Release latest cambio durante la revalidacion final.");
  assertConfirmation(options.version, options.confirmation);

  const published = await options.client.request("PATCH", `/repos/${OWNER}/${REPO}/releases/${freshDraft.id}`, {
    json: { draft: false, prerelease: false, make_latest: "true" },
  });
  verifyReleaseShape(published, {
    releaseId: freshDraft.id,
    tag: located.provenance.tag,
    sourceCommit: located.provenance.sourceCommit,
  }, false);

  const finalRelease = await options.client.request("GET", `/repos/${OWNER}/${REPO}/releases/${freshDraft.id}`);
  const latest = await options.client.request("GET", `/repos/${OWNER}/${REPO}/releases/latest`);
  verifyReleaseShape(finalRelease, {
    releaseId: freshDraft.id,
    tag: located.provenance.tag,
    sourceCommit: located.provenance.sourceCommit,
  }, false);
  invariant(latest.id === finalRelease.id, `/releases/latest no resuelve a ${located.provenance.tag}.`);
  await verifyRemoteAssets(options.client, finalRelease, bundle.assets);
  invariant(await options.client.resolveTag(located.provenance.tag) === located.provenance.sourceCommit, "El tag publicado no resuelve al sourceCommit exacto.");
  return { release: finalRelease, latest, provenance: located.provenance, bundle };
}

module.exports = {
  API_VERSION,
  DEFAULT_BRANCH,
  FULL_REPOSITORY,
  OWNER,
  PROVENANCE_START,
  REPO,
  assertConfirmation,
  assertSourceInMasterHistory,
  createGitHubClient,
  findDraftAndProvenance,
  inspectReleaseState,
  makeProvenance,
  normalizeArtifactDigest,
  parseProvenance,
  publishWindowsRelease,
  readPackageVersionAtCommit,
  remotePreflight,
  renderDraftBody,
  sanitizeErrorText,
  stageWindowsRelease,
  validateBuildIdentity,
  validateLatestReleaseContract,
  validateProvenance,
  verifyRemoteAssets,
};
