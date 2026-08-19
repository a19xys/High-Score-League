const GITHUB_RELEASE_ORIGIN = "https://github.com";
const GITHUB_RELEASE_OWNER = "a19xys";
const GITHUB_RELEASE_REPOSITORY = "High-Score-League";

export const WINDOWS_LAUNCHER_MANIFEST_URL =
  `${GITHUB_RELEASE_ORIGIN}/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPOSITORY}`
  + "/releases/latest/download/release-manifest.json";

export const WINDOWS_LAUNCHER_CACHE_CONTROL = "no-store, max-age=0";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_REMOTE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const SHA_512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

type FetchLauncherManifest = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ManifestAsset = {
  name: string;
  sha256: string;
  size: number;
};

export type WindowsLauncherRelease = {
  installerName: string;
  tag: string;
  version: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRemoteBasename(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 160
    && SAFE_REMOTE_BASENAME.test(value)
    && !value.includes("..")
    && !/[\\/?#:%]/.test(value);
}

function parseManifestAsset(value: unknown): ManifestAsset | null {
  if (!isRecord(value)
    || !isSafeRemoteBasename(value.name)
    || !Number.isSafeInteger(value.size)
    || Number(value.size) <= 0
    || typeof value.sha256 !== "string"
    || !SHA_256.test(value.sha256)) {
    return null;
  }

  return {
    name: value.name,
    sha256: value.sha256,
    size: Number(value.size),
  };
}

export function parseWindowsLauncherManifest(
  value: unknown,
): WindowsLauncherRelease | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.version !== "string"
    || !STABLE_SEMVER.test(value.version)
    || value.tag !== `v${value.version}`
    || typeof value.sourceCommit !== "string"
    || !/^[0-9a-f]{40}$/.test(value.sourceCommit)
    || value.sourceRef !== "refs/heads/master"
    || !isRecord(value.assets)) {
    return null;
  }

  const metadata = parseManifestAsset(value.assets.metadata);
  const installer = parseManifestAsset(value.assets.installer);
  const blockmap = parseManifestAsset(value.assets.blockmap);

  if (!metadata
    || metadata.name !== "latest.yml"
    || !installer
    || !installer.name.toLowerCase().endsWith(".exe")
    || !blockmap
    || blockmap.name !== `${installer.name}.blockmap`
    || !isRecord(value.assets.installer)
    || typeof value.assets.installer.sha512 !== "string"
    || !SHA_512_BASE64.test(value.assets.installer.sha512)) {
    return null;
  }

  return {
    installerName: installer.name,
    tag: value.tag,
    version: value.version,
  };
}

export function buildWindowsLauncherInstallerUrl(
  release: WindowsLauncherRelease,
) {
  return `${GITHUB_RELEASE_ORIGIN}/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPOSITORY}`
    + `/releases/download/${encodeURIComponent(release.tag)}`
    + `/${encodeURIComponent(release.installerName)}`;
}

function unavailableResponse() {
  return new Response(
    JSON.stringify({ error: "La descarga no está disponible temporalmente." }),
    {
      status: 503,
      headers: {
        "Cache-Control": WINDOWS_LAUNCHER_CACHE_CONTROL,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function getWindowsLauncherDownloadResponse(
  fetchManifest: FetchLauncherManifest = fetch,
) {
  try {
    const upstream = await fetchManifest(WINDOWS_LAUNCHER_MANIFEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      return unavailableResponse();
    }

    const declaredLength = Number(upstream.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
      return unavailableResponse();
    }

    const rawManifest = await upstream.text();

    if (rawManifest.length > MAX_MANIFEST_BYTES) {
      return unavailableResponse();
    }

    const release = parseWindowsLauncherManifest(JSON.parse(rawManifest));

    if (!release) {
      return unavailableResponse();
    }

    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": WINDOWS_LAUNCHER_CACHE_CONTROL,
        Location: buildWindowsLauncherInstallerUrl(release),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailableResponse();
  }
}
