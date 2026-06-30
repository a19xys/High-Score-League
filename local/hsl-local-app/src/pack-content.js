const fs = require("node:fs");
const path = require("node:path");
const { isUnsafePackRelativePath } = require("./pack-contract");

const DEFAULT_MANUAL_PATHS = [
  "manual/manual.html",
  "manual/manual.pdf",
  "manual/index.html",
];

const MANUAL_EXTENSIONS = new Set([".html", ".htm", ".pdf"]);

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function resolveLocalManual(packRoot, relativePath, source) {
  if (!packRoot || !relativePath || isUnsafePackRelativePath(relativePath)) {
    return null;
  }

  const fullPath = path.resolve(packRoot, relativePath);
  const relative = path.relative(path.resolve(packRoot), fullPath);
  const extension = path.extname(fullPath).toLowerCase();

  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !MANUAL_EXTENSIONS.has(extension) ||
    !isFile(fullPath)
  ) {
    return null;
  }

  return {
    available: true,
    kind: "local",
    path: fullPath,
    relativePath: String(relativePath).replaceAll("\\", "/"),
    source,
  };
}

function resolvePackManual(pack) {
  const metadata = pack?.metadata || {};
  const packRoot = pack?.packRoot || null;
  const explicitLocalCandidates = [
    ["metadata.manual", metadata.manual],
    ["metadata.manualPath", metadata.manualPath],
  ];

  for (const [source, candidate] of explicitLocalCandidates) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      continue;
    }

    const resolved = resolveLocalManual(packRoot, candidate.trim(), source);

    if (resolved) {
      return resolved;
    }

    return {
      available: false,
      kind: "missing",
      reason: `${source} no apunta a un archivo HTML/PDF seguro dentro del pack.`,
      source,
    };
  }

  if (metadata.manualUrl) {
    if (isHttpUrl(metadata.manualUrl)) {
      return {
        available: true,
        kind: "external",
        source: "metadata.manualUrl",
        url: metadata.manualUrl.trim(),
      };
    }

    return {
      available: false,
      kind: "missing",
      reason: "metadata.manualUrl debe ser una URL http(s) explicita.",
      source: "metadata.manualUrl",
    };
  }

  for (const candidate of DEFAULT_MANUAL_PATHS) {
    const resolved = resolveLocalManual(packRoot, candidate, candidate);

    if (resolved) {
      return resolved;
    }
  }

  return {
    available: false,
    kind: "missing",
    reason: "Este pack todavia no incluye manual local.",
    source: null,
  };
}

function resolvePackRanking(pack, fallbackWebBaseUrl = null) {
  const metadataUrl = pack?.metadata?.rankingUrl;

  if (metadataUrl) {
    if (isHttpUrl(metadataUrl)) {
      return {
        available: true,
        kind: "external",
        source: "metadata.rankingUrl",
        url: metadataUrl.trim(),
      };
    }

    return {
      available: false,
      kind: "missing",
      reason: "metadata.rankingUrl debe ser una URL http(s) explicita.",
      source: "metadata.rankingUrl",
    };
  }

  const baseUrl = pack?.webBaseUrl || fallbackWebBaseUrl;
  const weekId = pack?.weekId;
  const seasonKey = pack?.seasonSlug || pack?.seasonId;

  if (isHttpUrl(baseUrl) && typeof weekId === "string" && weekId.trim() !== "") {
    const url = new URL(`/weeks/${encodeURIComponent(weekId.trim())}`, baseUrl.trim());

    return {
      available: true,
      kind: "external",
      source: "week-web-route",
      url: url.toString(),
    };
  }

  if (isHttpUrl(baseUrl) && typeof seasonKey === "string" && seasonKey.trim() !== "") {
    const url = new URL(`/seasons/${encodeURIComponent(seasonKey.trim())}`, baseUrl.trim());

    return {
      available: true,
      kind: "external",
      source: "season-web-route",
      url: url.toString(),
    };
  }

  if (isHttpUrl(baseUrl)) {
    return {
      available: true,
      kind: "external",
      source: "web-base-url",
      url: baseUrl.trim(),
    };
  }

  return {
    available: false,
    kind: "missing",
    reason: "Ranking integrado pendiente y este pack no incluye una URL de ranking valida.",
    source: null,
  };
}

function toRendererContentState(target) {
  return {
    available: target.available,
    kind: target.kind,
    reason: target.reason || null,
    source: target.source || null,
  };
}

module.exports = {
  DEFAULT_MANUAL_PATHS,
  isHttpUrl,
  resolvePackManual,
  resolvePackRanking,
  toRendererContentState,
};
