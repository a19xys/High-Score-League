const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getGameByRom } = require("./games");
const { validatePackMameArguments } = require("./mame-arguments");
const {
  buildMameMutableArgs,
  ensureMameStateDirectories,
  pathIsInside,
  resolveMameState,
} = require("./mame-runtime-state");
const { isMameVersionCompatible } = require("./mame-version");

const DEFAULT_PLUGIN_NAME = "hsl-score";
const DEFAULT_LAUNCH_ARGS = ["-skip_gameinfo"];
const MODES = new Set(["competition", "practice"]);
const OUTPUT_TAIL_LIMIT = 200;

function isPackV2Config(config) {
  return config?.pack?.packVersion === 2 || config?.pack?.contract?.version === 2;
}

function assertMameConfig(config) {
  if (isPackV2Config(config)) {
    assertSharedMameRuntimeConfig(config);
    return;
  }

  // @deprecated Legacy bridge for packVersion 1/dev packs with MAME embedded
  // in the pack. Keep until competition v2 and the dev bridge are migrated.
  if (!config.mame || typeof config.mame !== "object") {
    throw new Error("config.json debe incluir mame.executablePath y mame.workingDir");
  }

  if (typeof config.mame.executablePath !== "string" || config.mame.executablePath.trim() === "") {
    throw new Error("config.json debe incluir mame.executablePath");
  }

  if (typeof config.mame.workingDir !== "string" || config.mame.workingDir.trim() === "") {
    throw new Error("config.json debe incluir mame.workingDir");
  }
}

function assertSharedMameRuntimeConfig(config) {
  const runtime = config?.sharedMameRuntime;

  if (!runtime?.configured) {
    throw new Error("Runtime MAME compartido no configurado.");
  }

  if (!runtime.available) {
    throw new Error("No se encontro mame.exe en el runtime compartido.");
  }

  if (typeof runtime.mameExecutablePath !== "string" || runtime.mameExecutablePath.trim() === "") {
    throw new Error("Runtime MAME compartido no configurado.");
  }

  const minimumVersion = config.pack?.contract?.runtime?.minVersion;
  if (minimumVersion && runtime.version && !isMameVersionCompatible(runtime.version, minimumVersion)) {
    throw new Error(`MAME ${runtime.version} no cumple runtime.minVersion ${minimumVersion}.`);
  }
}

function resolveLaunchRom(rom) {
  const game = getGameByRom(rom);

  if (!game) {
    throw new Error(`ROM no soportada: ${rom || "sin rom"}`);
  }

  return {
    game,
    rom: game.launcher?.rom || game.primaryRom || String(rom).trim(),
  };
}

function validateLaunchArgs(launchArgs, label = "mame.launchArgs") {
  return validatePackMameArguments(launchArgs, label);
}

function getPackV2ModeProfile(config, mode) {
  return config.pack?.contract?.mame?.profiles?.[mode] || {};
}

function uniquePathList(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    const key = String(entry).trim().replace(/[\\/]+$/, "").toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function getArgValue(args, option) {
  const index = args.lastIndexOf(option);

  return index >= 0 ? args[index + 1] || null : null;
}

function hasArg(args, option) {
  return args.includes(option);
}

function usesBgfx(args) {
  return args.some((value, index) => (
    value === "-bgfx_screen_chains" ||
    value === "-bgfx_path" ||
    value.startsWith("-bgfx_") ||
    (value === "-video" && args[index + 1] === "bgfx")
  ));
}

function addPackV2ResourceArgs(args, config, mode, mameRoot) {
  const mame = config.pack?.contract?.mame || {};
  const profile = getPackV2ModeProfile(config, mode);

  if (!mame.romDir) {
    throw new Error("pack.json v2 debe incluir mame.romPath para lanzar MAME.");
  }

  args.push("-rompath", mame.romDir);

  if (mame.artworkDir || mameRoot) {
    const artpath = uniquePathList([mame.artworkDir, mameRoot ? path.join(mameRoot, "artwork") : null]).join(path.delimiter);
    args.push("-artpath", artpath);
  }

  if (mame.sampleDir || mameRoot) {
    const samplepath = uniquePathList([mame.sampleDir, mameRoot ? path.join(mameRoot, "samples") : null]).join(path.delimiter);
    args.push("-samplepath", samplepath);
  }

  args.push(...validateLaunchArgs(mame.launchArgs));
  args.push(...validateLaunchArgs(profile.launchArgs, `mame.profiles.${mode}.launchArgs`));

  if (mameRoot) {
    args.push(
      "-bgfx_path", path.join(mameRoot, "bgfx"),
      "-hlslpath", path.join(mameRoot, "hlsl"),
      "-hashpath", path.join(mameRoot, "hash"),
      "-ctrlrpath", path.join(mameRoot, "ctrlr"),
      "-languagepath", path.join(mameRoot, "language"),
      "-fontpath", mameRoot,
    );
  }
}

function addDefaultLaunchArgs(args) {
  for (const value of DEFAULT_LAUNCH_ARGS) {
    if (!args.includes(value)) {
      args.push(value);
    }
  }
}

function buildPluginSearchPath(runPluginSearchDir, mameCwd) {
  const stockPluginSearchDir = path.join(mameCwd, "plugins");
  const entries = [runPluginSearchDir, stockPluginSearchDir].filter(Boolean);

  return [...new Set(entries)].join(path.delimiter);
}

function buildPackV2MameArgs(config, rom, mode) {
  assertSharedMameRuntimeConfig(config);

  const launch = resolveLaunchRom(rom);
  const args = [launch.rom];
  const pluginName = config.pack?.contract?.capture?.pluginName || DEFAULT_PLUGIN_NAME;
  const command = config.sharedMameRuntime.mameExecutablePath.trim();
  const mameRoot = config.sharedMameRuntime.runtimeRoot || path.dirname(command);
  const run = mode === "competition" ? config.v2PluginRun : null;
  const mutableDirectories = resolveMameState(config, { runRoot: run?.runRoot || null });
  const mame = config.pack?.contract?.mame || {};
  const profile = getPackV2ModeProfile(config, mode);
  const cfgDirectory = profile.cfgDir || mame.cfgDir || mutableDirectories.cfg;

  addDefaultLaunchArgs(args);
  addPackV2ResourceArgs(args, config, mode, mameRoot);
  args.push(...buildMameMutableArgs(mutableDirectories, cfgDirectory));

  if (mode === "competition") {
    if (!run?.runRoot || !run?.pluginSearchDir || !run?.stagingPendingDir || run.pluginName !== pluginName) {
      throw new Error("Competicion v2 requiere preparar plugin/adaptador aislado antes de lanzar MAME.");
    }

    args.push(
      "-pluginspath",
      buildPluginSearchPath(run.pluginSearchDir, mameRoot),
      "-plugins",
      "-plugin",
      pluginName
    );
  } else {
    args.push("-noplugins");
  }

  const effectiveMutableDirectories = { ...mutableDirectories, cfg: cfgDirectory };
  for (const [name, directory] of Object.entries(effectiveMutableDirectories)) {
    if (pathIsInside(directory, mameRoot)) {
      throw new Error(`La ruta mutable MAME ${name} no puede estar dentro del runtime instalado.`);
    }
  }

  return {
    args,
    command,
    cwd: mutableDirectories.home,
    game: launch.game,
    mameRoot,
    mode,
    mutableDirectories: effectiveMutableDirectories,
    pluginName,
    rom: launch.rom,
    runtime: config.sharedMameRuntime.source || "external/dev",
    v2PluginRun: config.v2PluginRun || null,
  };
}

function buildMameArgs(config, rom, mode) {
  if (!MODES.has(mode)) {
    throw new Error(`Modo de MAME desconocido: ${mode}`);
  }

  if (isPackV2Config(config)) {
    return buildPackV2MameArgs(config, rom, mode);
  }

  assertMameConfig(config);

  const launch = resolveLaunchRom(rom);
  const args = [launch.rom];

  addDefaultLaunchArgs(args);

  if (mode === "competition") {
    args.push("-plugins", "-plugin", config.mame.pluginName || DEFAULT_PLUGIN_NAME);
  }

  return {
    args,
    command: config.mame.executablePath.trim(),
    cwd: config.mame.workingDir.trim(),
    game: launch.game,
    mode,
    pluginName: config.mame.pluginName || DEFAULT_PLUGIN_NAME,
    rom: launch.rom,
    runtime: "legacy-pack-mame",
  };
}

function printLaunchSummary(launch) {
  console.log("");
  console.log("Lanzando MAME");
  console.log("=============");
  console.log(`Modo: ${launch.mode === "competition" ? "competicion" : "practica"}`);
  console.log(`ROM: ${launch.rom}`);

  if (launch.mode === "competition") {
    console.log(`Plugin: ${launch.pluginName} activado explicitamente`);
  } else {
    console.log("Plugins: desactivados explicitamente para practica");
  }

  console.log(`Ejecutable: ${launch.command}`);
  console.log(`Working dir: ${launch.cwd}`);
  console.log(`Args: ${launch.args.join(" ")}`);

  const artpath = getArgValue(launch.args, "-artpath");
  const bgfxPath = getArgValue(launch.args, "-bgfx_path");

  if (artpath) {
    console.log(`Artpath: ${artpath}`);
  }

  if (bgfxPath) {
    console.log(`BGFX path: ${bgfxPath}`);
  }

  if (["bundled", "external/dev"].includes(launch.runtime)) {
    console.log(`Runtime: ${launch.runtime === "bundled" ? "MAME bundled" : "MAME externo de desarrollo"}`);
  }

  if (launch.v2PluginRun) {
    console.log(`Run v2: ${launch.v2PluginRun.runId || launch.v2PluginRun.runRoot}`);
    console.log(`Pluginpath v2: ${buildPluginSearchPath(launch.v2PluginRun.pluginSearchDir, launch.mameRoot)}`);
    console.log(`Staging v2: ${launch.v2PluginRun.stagingPendingDir}`);
  }

  console.log("");
}

function assertLaunchResources(config, launch) {
  if (!["bundled", "external/dev"].includes(launch.runtime)) {
    return;
  }

  const romDir = config.pack?.contract?.mame?.romDir;
  const romPath = romDir && launch.rom ? path.join(romDir, `${launch.rom}.zip`) : null;

  if (!romDir || !fs.existsSync(romDir) || !fs.statSync(romDir).isDirectory()) {
    throw new Error("No encuentro el directorio de ROMs del pack v2.");
  }

  if (!romPath || !fs.existsSync(romPath) || !fs.statSync(romPath).isFile()) {
    throw new Error(`Falta la ROM necesaria: ${config.pack?.contract?.mame?.romPath || "roms"}/${launch.rom}.zip.`);
  }

  if (launch.mode === "competition") {
    const run = config.v2PluginRun;

    if (!run?.runRoot || !fs.existsSync(run.runRoot) || !fs.statSync(run.runRoot).isDirectory()) {
      throw new Error("No encuentro el run preparado para competicion v2.");
    }

    if (!run?.pluginSearchDir || !fs.existsSync(run.pluginSearchDir) || !fs.statSync(run.pluginSearchDir).isDirectory()) {
      throw new Error("No encuentro el plugin preparado para competicion v2.");
    }

    const stockPluginBoot = path.join(launch.mameRoot, "plugins", "boot.lua");

    if (!fs.existsSync(stockPluginBoot) || !fs.statSync(stockPluginBoot).isFile()) {
      throw new Error("No encuentro boot.lua en los plugins base de MAME compartido.");
    }

    if (!run?.stagingPendingDir || !fs.existsSync(run.stagingPendingDir) || !fs.statSync(run.stagingPendingDir).isDirectory()) {
      throw new Error("No encuentro el staging preparado para competicion v2.");
    }
  }
}

function attachProcessLifecycle(child, lifecycle, resolve, reject, resultFactory) {
  let spawned = false;
  let settled = false;
  let spawnHook = Promise.resolve();

  child.on("spawn", () => {
    spawned = true;
    spawnHook = Promise.resolve(lifecycle?.onSpawn?.()).catch(() => {});
  });
  child.on("error", (error) => {
    if (spawned || settled) return;
    settled = true;
    reject(error);
  });
  child.on("close", async (code) => {
    if (settled) return;
    settled = true;
    await spawnHook;
    if (spawned) {
      try {
        await lifecycle?.onClose?.(code ?? 1);
      } catch {}
    }
    resolve(resultFactory(code ?? 1));
  });
}

function launchMame(config, rom, mode, spawnImpl = spawn, lifecycle = null) {
  const launch = buildMameArgs(config, rom, mode);
  assertLaunchResources(config, launch);
  ensureMameStateDirectories(launch.mutableDirectories);
  printLaunchSummary(launch);

  return new Promise((resolve, reject) => {
    const child = spawnImpl(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: "inherit",
    });

    attachProcessLifecycle(child, lifecycle, resolve, reject, (code) => code);
  });
}

function trimOutputLines(lines) {
  if (lines.length <= OUTPUT_TAIL_LIMIT) {
    return lines;
  }

  return [
    `... ${lines.length - OUTPUT_TAIL_LIMIT} linea(s) anteriores omitidas ...`,
    ...lines.slice(-OUTPUT_TAIL_LIMIT),
  ];
}

function launchMameDetailed(config, rom, mode, spawnImpl = spawn, lifecycle = null) {
  const launch = buildMameArgs(config, rom, mode);
  assertLaunchResources(config, launch);
  ensureMameStateDirectories(launch.mutableDirectories);
  printLaunchSummary(launch);

  return new Promise((resolve, reject) => {
    const stdoutLines = [];
    const stderrLines = [];
    const child = spawnImpl(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const collect = (target) => (chunk) => {
      const lines = String(chunk).split(/\r?\n/).filter((line) => line.trim() !== "");
      target.push(...lines);
    };

    if (child.stdout?.on) {
      child.stdout.on("data", collect(stdoutLines));
    }

    if (child.stderr?.on) {
      child.stderr.on("data", collect(stderrLines));
    }

    attachProcessLifecycle(child, lifecycle, resolve, reject, (code) => ({
      exitCode: code ?? 1,
      launch,
      stderrLines: trimOutputLines(stderrLines),
      stdoutLines: trimOutputLines(stdoutLines),
    }));
  });
}

module.exports = {
  DEFAULT_PLUGIN_NAME,
  DEFAULT_LAUNCH_ARGS,
  assertMameConfig,
  buildMameArgs,
  buildPluginSearchPath,
  launchMameDetailed,
  launchMame,
  printLaunchSummary,
};
