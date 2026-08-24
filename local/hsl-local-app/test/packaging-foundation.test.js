const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const packageMetadata = require("../package.json");
const packageLock = require("../package-lock.json");
const builder = require("../electron-builder.config.cjs");
const { loadConfig } = require("../src/config");
const { getRepoPluginDir } = require("../src/dev-sync-plugin");
const { inspectBundledMameRuntime } = require("../src/shared-mame-runtime");
const { readMameRuntimeManifest, validateMameRuntimeManifest } = require("../src/mame-runtime-manifest");
const { compareMameVersions, isMameVersionCompatible, parseMameVersion } = require("../src/mame-version");
const { findReservedMameArgument, validatePackMameArguments } = require("../src/mame-arguments");
const { prepareMame, stageProductMame } = require("../scripts/prepare-mame");
const { validateProductPublicConfig } = require("../src/product-config");
const { stageProductPlugin } = require("../scripts/stage-product-plugin");
const { prepareV2CompetitionRun } = require("../src/mame-plugin-run");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { loadPackFromDir } = require("../src/pack");
const { writePackProvenanceReceipt } = require("../src/pack-provenance");
const {
  REQUIRED_RUNTIME_FILES,
  verifyBundledMameRuntimeIntegrity,
  verifyBundledPluginIntegrity,
  writeProductIntegrityRoot,
  writeRuntimeIntegrityManifest,
} = require("../src/product-runtime-integrity");
const { configureProductRuntime, resetProductRuntime } = require("../src/product-runtime");
const { getWindowsInstallationDirName } = require("../node_modules/app-builder-lib/out/targets/targetUtil");

async function withTempDir(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-packaging-foundation-"));
  try { return await fn(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

async function createBundledRuntime(resourcesPath, options = {}) {
  const root = path.join(resourcesPath, "mame", "0.287");
  const files = [...REQUIRED_RUNTIME_FILES, "COPYING"];
  for (const relativePath of files) {
    if (relativePath === options.omit) continue;
    const target = path.join(root, ...relativePath.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, "fixture", "utf8");
  }
  for (const relativePath of ["bgfx/effects", "bgfx/shaders"]) {
    if (relativePath !== options.omit) await fsp.mkdir(path.join(root, ...relativePath.split("/")), { recursive: true });
  }
  if (!options.omit) await writeRuntimeIntegrityManifest(root, "0.287");
  return root;
}

async function createExtractedRuntime(runtimeRoot, marker = "fixture") {
  for (const relativePath of [...REQUIRED_RUNTIME_FILES, "COPYING"]) {
    const target = path.join(runtimeRoot, ...relativePath.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, marker, "utf8");
  }
  await Promise.all([
    fsp.mkdir(path.join(runtimeRoot, "bgfx", "effects"), { recursive: true }),
    fsp.mkdir(path.join(runtimeRoot, "bgfx", "shaders"), { recursive: true }),
  ]);
  await fsp.writeFile(path.join(runtimeRoot, "stock-marker.txt"), marker, "utf8");
}

test("package metadata makes the GUI the product entry point with an assisted per-user installer", () => {
  assert.equal(packageMetadata.main, "gui/main.js");
  assert.equal(packageMetadata.scripts.gui, "electron .");
  assert.equal(builder.appId, "com.highscoreleague.launcher");
  assert.equal(builder.productName, "High Score League");
  assert.equal(builder.asar, true);
  assert.deepEqual(builder.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(builder.nsis.oneClick, false);
  assert.equal(builder.nsis.perMachine, false);
  assert.equal(builder.nsis.allowElevation, false);
  assert.equal(builder.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(builder.nsis.include, "build/installer.nsh");
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.equal(builder.nsis.createDesktopShortcut, true);
  assert.equal(builder.nsis.createStartMenuShortcut, true);
  assert.equal(builder.nsis.shortcutName, "High Score League");
  assert.equal(builder.nsis.script, undefined);
  assert.match(builder.nsis.artifactName, /High Score League Setup/);
  const mameRuntime = readMameRuntimeManifest();
  const mameResource = builder.extraResources.find((entry) => entry.to === path.posix.join("mame", mameRuntime.version));
  assert.equal(mameResource.from, path.join(".cache", "product", "mame", mameRuntime.version, "runtime"));
});

test("NSIS registra y elimina el protocolo deep-link por usuario con quoting seguro", async () => {
  const include = await fsp.readFile(path.join(__dirname, "..", builder.nsis.include), "utf8");
  assert.match(include, /!macro customInstall/);
  assert.match(include, /!macro customUnInstall/);
  assert.match(include, /HKCU "Software\\Classes\\highscoreleague" "URL Protocol" ""/);
  assert.match(include, /'"\$INSTDIR\\High Score League\.exe" "%1"'/);
  assert.match(include, /DeleteRegKey HKCU "Software\\Classes\\highscoreleague"/);
  assert.doesNotMatch(include, /HKLM|requestSingleInstanceLock|electron \.|npm run gui/i);
});

test("NSIS fuerza Current User y conserva todos los colores nativos de MUI2", async () => {
  const include = await fsp.readFile(path.join(__dirname, "..", builder.nsis.include), "utf8");
  assert.match(include, /!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"\s+!macroend/);
  assert.doesNotMatch(include, /MUI_(?:BGCOLOR|TEXTCOLOR|INSTFILESPAGE_COLORS|DIRECTORYPAGE_BGCOLOR)|AppsUseLightTheme|SetCtlColors/i);
  assert.doesNotMatch(include, /preInit|RequestExecutionLevel|InstallLocation|LocalAppData|ProgramFiles/i);
});

test("NSIS ofrece el acceso directo de escritorio marcado por defecto y respeta la elección", async () => {
  const include = await fsp.readFile(path.join(__dirname, "..", builder.nsis.include), "utf8");
  assert.match(include, /!macro customPageAfterChangeDir\s+Page custom hslDesktopShortcutPageCreate hslDesktopShortcutPageLeave\s+!macroend/);
  assert.match(include, /Function hslDesktopShortcutPageCreate[\s\S]*\$\{If\} \$\{isUpdated\}\s+Abort[\s\S]*FunctionEnd/);
  assert.match(include, /\$\{NSD_CreateCheckbox\}[^\n]*"Crear acceso directo en el escritorio"/);
  assert.match(include, /\$\{NSD_Check\} \$hslDesktopShortcutCheckbox/);
  assert.match(include, /Function hslDesktopShortcutPageLeave[\s\S]*\$\{NSD_GetState\} \$hslDesktopShortcutCheckbox \$0[\s\S]*StrCpy \$hslCreateDesktopShortcut "0"/);
  assert.match(include, /!undef isNoDesktopShortcut\s+!define isNoDesktopShortcut `"" hslIsNoDesktopShortcut ""`/);
  assert.match(include, /!macro _hslIsNoDesktopShortcut[\s\S]*StrCmp "\$hslCreateDesktopShortcut" "0"/);
});

test("assisted conserva el subdirectorio canónico del one-click anterior", async () => {
  const appInfo = {
    productFilename: builder.win.executableName,
    sanitizedName: packageMetadata.name,
  };
  assert.equal(getWindowsInstallationDirName(appInfo, false), "hsl-local-app");
  assert.equal(getWindowsInstallationDirName(appInfo, true), "High Score League");

  const include = await fsp.readFile(path.join(__dirname, "..", builder.nsis.include), "utf8");
  assert.match(include, /!undef APP_FILENAME\s+!define APP_FILENAME "\$\{APP_PACKAGE_NAME\}"/);
  assert.doesNotMatch(include, /[A-Z]:\\|InstallLocation|LocalAppData|ProgramFiles/i);
});

test("electron-builder 26 assisted conserva Directory, Current User, InstallLocation y updates silenciosos", async () => {
  const templatesDir = path.join(__dirname, "..", "node_modules", "app-builder-lib", "templates", "nsis");
  const [assisted, multiUserUi, multiUser, installer] = await Promise.all([
    fsp.readFile(path.join(templatesDir, "assistedInstaller.nsh"), "utf8"),
    fsp.readFile(path.join(templatesDir, "multiUserUi.nsh"), "utf8"),
    fsp.readFile(path.join(templatesDir, "multiUser.nsh"), "utf8"),
    fsp.readFile(path.join(templatesDir, "include", "installer.nsh"), "utf8"),
  ]);

  assert.match(assisted, /!insertmacro skipPageIfUpdated\s+!insertmacro MUI_PAGE_DIRECTORY/);
  assert.match(assisted, /!ifmacrodef customPageAfterChangeDir\s+!insertmacro customPageAfterChangeDir\s+!endif\s+!insertmacro MUI_PAGE_INSTFILES/);
  assert.match(assisted, /Function instFilesPre[\s\S]*\$\{StrContains\} \$0 "\$\{APP_FILENAME\}" \$INSTDIR[\s\S]*StrCpy \$INSTDIR "\$INSTDIR\\\$\{APP_FILENAME\}"[\s\S]*FunctionEnd/);
  assert.match(multiUserUi, /!insertmacro customInstallMode/);
  assert.match(multiUserUi, /\$isForceCurrentInstall == "1"[\s\S]*!insertmacro setInstallModePerUser[\s\S]*Abort/);
  assert.match(multiUser, /ReadRegStr \$perUserInstallationFolder HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation[\s\S]*StrCpy \$INSTDIR \$perUserInstallationFolder/);
  assert.match(multiUser, /FOLDERID_UserProgramFiles[\s\S]*SHGetKnownFolderPath[\s\S]*StrCpy \$INSTDIR "\$0\\\$\{APP_FILENAME\}"/);
  assert.match(installer, /WriteRegStr SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation "\$INSTDIR"/);
  assert.match(installer, /\$\{ifNot\} \$\{isNoDesktopShortcut\}[\s\S]*CreateShortCut "\$newDesktopLink" "\$appExe"/);
});

test("stable Electron 43 and electron-builder 26 are pinned", () => {
  assert.equal(packageMetadata.devDependencies.electron, "^43.4.0");
  assert.equal(packageMetadata.devDependencies["electron-builder"], "^26.15.7");
  assert.doesNotMatch(packageMetadata.devDependencies["electron-builder"], /alpha|beta/i);
});

test("Windows updater packaging contract is explicit, stable and never publishes locally", () => {
  assert.equal(packageMetadata.version, "0.3.1");
  assert.equal(packageLock.version, packageMetadata.version);
  assert.equal(packageLock.packages[""].version, packageMetadata.version);
  assert.equal(packageMetadata.dependencies["electron-updater"], "6.8.9");
  assert.equal(packageMetadata.devDependencies["electron-updater"], undefined);
  assert.deepEqual(builder.publish, [{
    provider: "github",
    owner: "a19xys",
    repo: "High-Score-League",
    channel: "latest",
    private: false,
  }]);
  assert.match(packageMetadata.scripts["package:win"], /--dir --publish never$/);
  assert.match(packageMetadata.scripts["dist:win"], /--publish never && npm run validate:update-artifacts$/);
  assert.equal(packageMetadata.scripts["validate:update-artifacts"], "node scripts/validate-update-artifacts.js");
  assert.doesNotMatch(JSON.stringify(builder.publish), /token|authorization|requestHeaders|GH_TOKEN|GITHUB_TOKEN/i);
  assert.equal(builder.appId, "com.highscoreleague.launcher");
  assert.equal(builder.productName, "High Score League");
  assert.equal(builder.nsis.perMachine, false);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
});

test("MAME manifest is explicit and validated", () => {
  const manifest = readMameRuntimeManifest();
  assert.deepEqual({ version: manifest.version, architecture: manifest.architecture, asset: manifest.asset, sha256: manifest.sha256 }, {
    version: "0.287",
    architecture: "x64",
    asset: "mame0287b_x64.exe",
    sha256: "68cdaf6d48213c6f3d0f7fa7f2733db46f74e400ad66db2d8a8d777430a42fb9",
  });
  assert.throws(() => validateMameRuntimeManifest({ ...manifest, sha256: "bad" }), /sha256/);
});

test("prepare:mame aborts when a cached asset has the wrong SHA", async () => {
  await withTempDir(async (root) => {
    const cacheDir = path.join(root, "cache");
    const manifestPath = path.join(root, "manifest.json");
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(path.join(cacheDir, "mame0287b_x64.exe"), "not-mame", "utf8");
    await fsp.writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      version: "0.287",
      architecture: "x64",
      asset: "mame0287b_x64.exe",
      url: "https://github.com/mamedev/mame/releases/download/mame0287/mame0287b_x64.exe",
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    }), "utf8");
    await assert.rejects(() => prepareMame({ cacheDir, manifestPath, offline: true }), /SHA-256 incorrecto/);
  });
});

test("product MAME staging ignores tampered caches and always extracts the verified SFX afresh", async () => {
  await withTempDir(async (root) => {
    const cacheDir = path.join(root, "cache", "mame", "0.287");
    const manifestPath = path.join(root, "manifest.json");
    const runtimeDir = path.join(root, "cache", "product", "mame", "0.287", "runtime");
    const asset = Buffer.from("verified-mame-sfx-fixture");
    const digest = crypto.createHash("sha256").update(asset).digest("hex");
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(path.join(cacheDir, "mame0287b_x64.exe"), asset);
    await fsp.writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      version: "0.287",
      architecture: "x64",
      asset: "mame0287b_x64.exe",
      url: "https://github.com/mamedev/mame/releases/download/mame0287/mame0287b_x64.exe",
      sha256: digest,
    }), "utf8");

    const tamperedDevRuntime = path.join(cacheDir, "runtime");
    await createExtractedRuntime(tamperedDevRuntime, "tampered-dev-cache");
    let extractionCount = 0;
    const options = {
      cacheDir,
      manifestPath,
      offline: true,
      runtimeDir,
      extractImpl: async (_assetPath, targetDir) => {
        extractionCount += 1;
        await createExtractedRuntime(targetDir, "verified-sfx");
      },
      verifyExecutableImpl: async () => ({ skipped: true, reason: "fixture" }),
    };

    await stageProductMame(options);
    assert.equal(await fsp.readFile(path.join(runtimeDir, "stock-marker.txt"), "utf8"), "verified-sfx");
    assert.equal(await fsp.readFile(path.join(tamperedDevRuntime, "stock-marker.txt"), "utf8"), "tampered-dev-cache");

    await fsp.writeFile(path.join(runtimeDir, "stock-marker.txt"), "tampered-product-cache", "utf8");
    await stageProductMame(options);
    assert.equal(extractionCount, 2);
    assert.equal(await fsp.readFile(path.join(runtimeDir, "stock-marker.txt"), "utf8"), "verified-sfx");
  });
});

test("bundled runtime requires executable, stock plugin bootstrap and BGFX", async () => {
  await withTempDir(async (resourcesPath) => {
    await createBundledRuntime(resourcesPath);
    const complete = inspectBundledMameRuntime({ isPackaged: true, resourcesPath });
    assert.equal(complete.source, "bundled");
    assert.equal(complete.version, "0.287");
    assert.equal(complete.available, true);

    await fsp.rm(path.join(complete.runtimeRoot, "plugins", "boot.lua"));
    const withoutBoot = inspectBundledMameRuntime({ isPackaged: true, resourcesPath });
    assert.equal(withoutBoot.available, false);
    assert.ok(withoutBoot.missingResources.some((item) => /boot\.lua/.test(item)));

    await fsp.writeFile(path.join(complete.runtimeRoot, "plugins", "boot.lua"), "fixture", "utf8");
    await fsp.rm(path.join(complete.runtimeRoot, "bgfx", "chains", "crt-geom.json"));
    const withoutBgfx = inspectBundledMameRuntime({ isPackaged: true, resourcesPath });
    assert.equal(withoutBgfx.available, false);
    assert.ok(withoutBgfx.missingResources.some((item) => /crt-geom/.test(item)));

    await fsp.rm(path.join(complete.runtimeRoot, "mame.exe"));
    const withoutExe = inspectBundledMameRuntime({ isPackaged: true, resourcesPath });
    assert.equal(withoutExe.available, false);
    assert.ok(withoutExe.missingResources.includes("mame.exe"));
  });
});

test("packaged config uses product metadata and bundled MAME without config.json", async () => {
  await withTempDir(async (root) => {
    const resourcesPath = path.join(root, "resources");
    const userDataDir = path.join(root, "userData");
    await createBundledRuntime(resourcesPath);
    const config = loadConfig(path.join(root, "missing-config.json"), root, {
      environment: {},
      productRuntime: {
        isPackaged: true,
        productConfig: builder.extraMetadata.hslProduct,
        resourcesPath,
        userDataDir,
        version: packageMetadata.version,
      },
    });
    assert.equal(config.configExists, false);
    assert.equal(config.productConfigSource, "product-metadata");
    assert.equal(config.hslOrigin, "https://highscoreleague.com");
    assert.equal(config.remoteConfiguration.source, "launcher-config");
    assert.equal(config.clientVersion, packageMetadata.version);
    assert.equal(config.supabasePublishableKey.startsWith("sb_publishable_"), true);
    assert.equal(config.sharedMameRuntime.source, "bundled");
    assert.equal(config.sharedMameRuntime.available, true);
    assert.equal(config.sharedMameRuntime.runtimeFile, null);
  });
});

test("product config rejects Supabase secrets and service_role JWTs", () => {
  const base = {
    schemaVersion: 1,
    hslOrigin: "https://highscoreleague.com",
    supabaseUrl: "https://project.supabase.co",
  };
  assert.throws(() => validateProductPublicConfig({ ...base, supabasePublishableKey: "sb_secret_forbidden" }), /secret\/service_role/);
  const serviceRole = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  assert.throws(() => validateProductPublicConfig({ ...base, supabasePublishableKey: serviceRole }), /role=anon/);
});

test("hsl-score source resolves from repo in dev and resources when packaged", () => {
  const appDir = path.resolve(__dirname, "..");
  assert.equal(getRepoPluginDir(appDir, { isPackaged: false }), path.resolve(appDir, "..", "mame-plugin", "hsl-score"));
  assert.equal(
    getRepoPluginDir(appDir, { productRuntime: { isPackaged: true, resourcesPath: "C:/Program/HSL/resources" } }),
    path.join("C:/Program/HSL/resources", "hsl", "mame-plugin", "hsl-score"),
  );
});

test("product plugin staging reuses the runtime allowlist and excludes mutable data", async () => {
  await withTempDir(async (root) => {
    const result = await stageProductPlugin({ targetDir: path.join(root, "hsl-score") });
    assert.ok(result.files.includes("init.lua"));
    assert.ok(result.files.includes("plugin.json"));
    assert.ok(result.files.some((file) => /core[\\/]config\.lua$/.test(file)));
    assert.equal(result.files.some((file) => /(^|[\\/])events([\\/]|$)/.test(file)), false);
    assert.equal(result.files.includes("config.lua"), false);
  });
});

test("product integrity manifests detect changed bytes and cannot omit critical coverage", async () => {
  await withTempDir(async (root) => {
    const runtimeRoot = await createBundledRuntime(path.join(root, "resources"));
    await verifyBundledMameRuntimeIntegrity(runtimeRoot, "0.287");
    await fsp.writeFile(path.join(runtimeRoot, "bgfx", "chains", "crt-geom.json"), "tampered", "utf8");
    await assert.rejects(
      () => verifyBundledMameRuntimeIntegrity(runtimeRoot, "0.287"),
      /Recurso critico de producto modificado/,
    );

    const pluginRoot = path.join(root, "hsl-score");
    await stageProductPlugin({ targetDir: pluginRoot });
    await verifyBundledPluginIntegrity(pluginRoot);
    const manifestPath = path.join(pluginRoot, "hsl-plugin-integrity.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    manifest.files = manifest.files.filter((entry) => entry.path !== "core/writer.lua");
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => verifyBundledPluginIntegrity(pluginRoot),
      /omite un recurso critico: core\/writer\.lua/,
    );
  });
});

test("packaged competition stages hsl-score from resources without checkout-relative access", async () => {
  await withTempDir(async (root) => {
    const resourcesPath = path.join(root, "installed", "resources");
    const runtimeRoot = await createBundledRuntime(resourcesPath);
    const sourceDir = path.join(resourcesPath, "hsl", "mame-plugin", "hsl-score");
    const stagedPlugin = await stageProductPlugin({ targetDir: sourceDir });
    const appPath = path.join(root, "installed", "app");
    const productRootPath = path.join(appPath, "product", "product-integrity-root.json");
    await writeProductIntegrityRoot(productRootPath, {
      mameVersion: "0.287",
      pluginVersion: stagedPlugin.pluginVersion,
      runtimeManifestPath: path.join(runtimeRoot, "hsl-runtime-integrity.json"),
      pluginManifestPath: stagedPlugin.integrity.manifestPath,
    });
    const packRoot = path.join(root, "pack");
    const adapterPath = path.join(packRoot, "scripts", "capture.lua");
    const romDir = path.join(packRoot, "roms");
    await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.writeFile(adapterPath, "return { observe_capture = function() end }", "utf8");
    await fsp.writeFile(path.join(romDir, "invaders.zip"), "fixture-rom", "utf8");
    await fsp.writeFile(path.join(packRoot, "pack.json"), `${JSON.stringify({
      packVersion: 2,
      packId: "packaged-pack",
      gameId: "space-invaders",
      rom: "invaders",
      seasonId: "season-packaged",
      seasonSlug: "season-packaged",
      seasonName: "Season Packaged",
      weekId: "week-packaged",
      weekNumber: 1,
      webBaseUrl: "https://high-score-league.example",
      runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
      mame: {
        romPath: "roms",
        launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
        profiles: {
          practice: { launchArgs: [] },
          competition: {
            launchArgs: [],
            integrity: { version: 1, mameVersion: "0.287", dips: [] },
          },
        },
      },
      capture: {
        mode: "plugin",
        pluginName: "hsl-score",
        adapter: "scripts/capture.lua",
        automatic: { version: 1, strategy: "invaders-game-mode-final-v1" },
      },
    }, null, 2)}\n`, "utf8");
    const loadedPack = loadPackFromDir(packRoot);
    assert.equal(loadedPack.loaded, true);
    assert.deepEqual(loadedPack.errors, []);
    const config = {
      appDir: path.join(root, "checkout-does-not-exist", "hsl-local-app"),
      packRoot,
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath: path.join(runtimeRoot, "mame.exe"),
        runtimeRoot,
        source: "bundled",
      },
      userDataDir: path.join(root, "userData"),
      pack: loadedPack.pack,
    };
    const manifest = await writeCompetitionManifest(config.pack);
    await writePackProvenanceReceipt(config, {
      artifactSha256: "b".repeat(64),
      artifactSizeBytes: 1234,
      competitionManifestSha256: manifest.manifestSha256,
      importedAt: "2026-08-21T10:00:00.000Z",
      packId: config.pack.packId,
    });
    configureProductRuntime({ appPath, isPackaged: true, resourcesPath, version: "0.3.0" });
    try {
      const run = await prepareV2CompetitionRun(config, {
        packKey: "pack_packaged",
        playerKey: "user_player",
        scopedQueueRoot: path.join(root, "queue"),
      }, { runId: "run_packaged", userId: "player", detectMameVersionImpl: () => "0.287" });
      assert.equal(run.copiedFiles.includes("init.lua"), true);
      assert.equal(run.config.v2PluginRun.pluginDir.startsWith(config.userDataDir), true);
      assert.match(await fsp.readFile(path.join(run.pluginDir, "init.lua"), "utf8"), /PLUGIN_VERSION = "0\.4\.0"/);
      assert.equal(run.adapterSourcePath, path.join(run.snapshotRoot, "scripts", "capture.lua"));
      assert.equal(run.iniDir, path.join(run.runRoot, "ini"));
      assert.equal(await fsp.readFile(run.pluginBootstrapPath, "utf8"), "fixture");
    } finally {
      resetProductRuntime();
    }
  });
});

test("MAME version parsing and minimum comparison are numeric", () => {
  assert.deepEqual(parseMameVersion("MAME v0.287"), [0, 287, 0]);
  assert.equal(compareMameVersions("0.287", "0.287"), 0);
  assert.equal(compareMameVersions("0.287", "0.288"), -1);
  assert.equal(compareMameVersions("0.288", "0.287"), 1);
  assert.equal(isMameVersionCompatible("0.287", "0.287"), true);
  assert.equal(isMameVersionCompatible("0.287", "0.288"), false);
  assert.equal(isMameVersionCompatible("0.288", "0.287"), true);
});

test("reserved infrastructure arguments reject case, aliases and inline forms", () => {
  for (const args of [
    ["-ROMPATH", "D:/roms"],
    ["--bgfx_path=D:/bgfx"],
    ["/pluginspath:D:/plugins"],
    ["-rp", "D:/roms"],
    ["-NO_PLUGINS"],
    ["-cfg-directory", "D:/cfg"],
  ]) {
    assert.ok(findReservedMameArgument(args));
    assert.throws(() => validatePackMameArguments(args), /opcion reservada/);
  }
  assert.deepEqual(validatePackMameArguments(["-video", "bgfx", "-bgfx_screen_chains", "crt-geom", "-window"]), [
    "-video", "bgfx", "-bgfx_screen_chains", "crt-geom", "-window",
  ]);
});

test("renderer version comes through the narrow preload bridge", async () => {
  const appSource = await fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8");
  const preloadSource = await fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8");
  assert.doesNotMatch(appSource, /const LAUNCHER_VERSION = "v1\.0\.0"/);
  assert.match(appSource, /window\.hslLauncher\?\.productVersion/);
  assert.match(preloadSource, /hsl-product-version/);
  assert.match(preloadSource, /productVersion/);
});
