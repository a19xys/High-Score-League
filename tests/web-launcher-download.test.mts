import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildWindowsLauncherInstallerUrl,
  getWindowsLauncherDownloadResponse,
  parseWindowsLauncherManifest,
  WINDOWS_LAUNCHER_CACHE_CONTROL,
  WINDOWS_LAUNCHER_MANIFEST_URL,
} from "../lib/launcher-download.ts";

const SHA_256 = "a".repeat(64);
const SHA_512 = `${"A".repeat(86)}==`;

function manifest(version = "0.2.0") {
  const installerName = `High-Score-League-Setup-${version}.exe`;

  return {
    schemaVersion: 1,
    version,
    tag: `v${version}`,
    sourceCommit: "f".repeat(40),
    sourceRef: "refs/heads/master",
    assets: {
      metadata: { name: "latest.yml", size: 363, sha256: SHA_256 },
      installer: {
        name: installerName,
        size: 222969258,
        sha256: SHA_256,
        sha512: SHA_512,
      },
      blockmap: {
        name: `${installerName}.blockmap`,
        size: 234492,
        sha256: SHA_256,
      },
    },
  };
}

function upstreamJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("schema 1 accepts the current stable release and a future stable version", () => {
  for (const version of ["0.2.0", "0.3.0"]) {
    const parsed = parseWindowsLauncherManifest(manifest(version));

    assert.deepEqual(parsed, {
      installerName: `High-Score-League-Setup-${version}.exe`,
      tag: `v${version}`,
      version,
    });
    assert.equal(
      buildWindowsLauncherInstallerUrl(parsed!),
      `https://github.com/a19xys/High-Score-League/releases/download/v${version}/High-Score-League-Setup-${version}.exe`,
    );
  }
});

test("manifest rejects traversal, URL syntax and names outside the release contract", () => {
  const maliciousNames = [
    "../payload.exe",
    "../../evil.exe",
    "foo/bar.exe",
    "folder\\payload.exe",
    "//evil.example/a.exe",
    "https://evil.example/payload.exe",
    "a.exe?x=1",
    "a.exe#foo",
    "High-Score-League-Setup-0.2.0.exe?token=secret",
    "High-Score-League-Setup-0.2.0.exe#fragment",
    "High-Score-League-Setup-0.2.0%2f.exe",
    "High..Score-League-Setup-0.2.0.exe",
    "Other-Product-0.2.0.exe",
    "High-Score-League-Setup-0.2.0.zip",
  ];

  for (const name of maliciousNames) {
    const candidate = manifest();
    candidate.assets.installer.name = name;
    candidate.assets.blockmap.name = `${name}.blockmap`;
    assert.equal(parseWindowsLauncherManifest(candidate), null, name);
  }
});

test("manifest rejects version and tag mismatch", () => {
  const wrongTag = manifest();
  wrongTag.tag = "v0.3.0";
  assert.equal(parseWindowsLauncherManifest(wrongTag), null);

  const wrongInstallerVersion = manifest();
  wrongInstallerVersion.assets.installer.name = "High-Score-League-Setup-0.3.0.exe";
  wrongInstallerVersion.assets.blockmap.name = `${wrongInstallerVersion.assets.installer.name}.blockmap`;
  assert.equal(parseWindowsLauncherManifest(wrongInstallerVersion), null);
});

test("manifest rejects unsupported, unstable, incomplete and non-exe inputs", () => {
  const unsupported = manifest();
  unsupported.schemaVersion = 2;

  const unstable = manifest();
  unstable.version = "0.3.0-beta.1";
  unstable.tag = "v0.3.0-beta.1";

  const incomplete = manifest() as ReturnType<typeof manifest> & {
    assets: ReturnType<typeof manifest>["assets"] | Record<string, never>;
  };
  incomplete.assets = {};

  const nonExe = manifest();
  nonExe.assets.installer.name = "High-Score-League-Setup-0.2.0.msi";
  nonExe.assets.blockmap.name = `${nonExe.assets.installer.name}.blockmap`;

  for (const candidate of [unsupported, unstable, incomplete, nonExe, null, []]) {
    assert.equal(parseWindowsLauncherManifest(candidate), null);
  }
});

test("download resolver fetches the public manifest no-store and redirects to the exact tag", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const response = await getWindowsLauncherDownloadResponse(async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return upstreamJson(manifest());
  });

  assert.equal(requestedUrl, WINDOWS_LAUNCHER_MANIFEST_URL);
  assert.equal(requestedInit?.cache, "no-store");
  assert.equal(requestedInit?.redirect, "follow");
  assert.deepEqual(requestedInit?.headers, { Accept: "application/json" });
  assert.doesNotMatch(JSON.stringify(requestedInit), /authorization|token|api\.github/i);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), WINDOWS_LAUNCHER_CACHE_CONTROL);
  assert.equal(
    response.headers.get("location"),
    "https://github.com/a19xys/High-Score-League/releases/download/v0.2.0/High-Score-League-Setup-0.2.0.exe",
  );
  assert.doesNotMatch(response.headers.get("location") || "", /\/latest\//);
});

test("upstream failures, invalid JSON and invalid schema return the same no-store 503", async () => {
  const scenarios = [
    async () => new Response("not found secret", { status: 404 }),
    async () => new Response("upstream secret", { status: 500 }),
    async () => new Response("{invalid-json", { status: 200 }),
    async () => upstreamJson({ schemaVersion: 1 }),
    async () => { throw new Error("network secret"); },
  ];

  for (const fetchManifest of scenarios) {
    const response = await getWindowsLauncherDownloadResponse(fetchManifest);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), WINDOWS_LAUNCHER_CACHE_CONTROL);
    assert.deepEqual(JSON.parse(body), {
      error: "La descarga no está disponible temporalmente.",
    });
    assert.doesNotMatch(body, /secret|network|schema|json|github/i);
  }
});

test("route and authenticated Home retain the public, semantic UI contract", async () => {
  const root = process.cwd();
  const [route, home, options] = await Promise.all([
    readFile(join(root, "app/download/launcher/windows/route.ts"), "utf8"),
    readFile(join(root, "app/page.tsx"), "utf8"),
    readFile(join(root, "components/launcher-download-options.tsx"), "utf8"),
  ]);

  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /getWindowsLauncherDownloadResponse/);
  assert.doesNotMatch(route, /auth|cookie|token|session/i);

  assert.match(home, /<LauncherDownloadOptions \/>/);
  assert.doesNotMatch(home, /const weekHref/);
  assert.doesNotMatch(home, /<LinkButton href=\{weekHref\}[\s\S]*?>\s*Leaderboard/);
  assert.doesNotMatch(home, /<LinkButton href=\{seasonHref\}>\s*Clasificación/);

  assert.match(options, /<a[\s\S]*?href="\/download\/launcher\/windows"/);
  assert.match(options, /Windows 64 bits/);
  assert.match(options, /aria-disabled="true"[\s\S]*GNU\/Linux[\s\S]*Próximamente/);
  assert.doesNotMatch(options, /next\/link|<Link|<button|onClick|navigator|userAgent|href="#/i);
  const linuxOption = options.slice(options.indexOf("aria-disabled"));
  assert.doesNotMatch(linuxOption, /href=|tabIndex=|role="button"/);
});
