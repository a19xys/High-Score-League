const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getGameByRom } = require("./games");

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
  if (launchArgs === undefined || launchArgs === null) {
    return [];
  }

  if (!Array.isArray(launchArgs)) {
    throw new Error(`pack.json ${label} debe ser un array`);
  }

  return launchArgs.map((value) => {
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error(`pack.json ${label} solo puede incluir strings seguros`);
    }

    return value;
  });
}

function getPackV2ModeProfile(config, mode) {
  return config.pack?.contract?.mame?.profiles?.[mode] || {};
}

function addPackV2ResourceArgs(args, config, mode) {
  const mame = config.pack?.contract?.mame || {};
  const profile = getPackV2ModeProfile(config, mode);

  if (!mame.romDir) {
    throw new Error("pack.json v2 debe incluir mame.romPath para lanzar MAME.");
  }

  args.push("-rompath", mame.romDir);

  if (mame.artworkDir) {
    args.push("-artpath", mame.artworkDir);
  }

  if (mame.sampleDir) {
    args.push("-samplepath", mame.sampleDir);
  }

  if (profile.cfgDir || mame.cfgDir) {
    args.push("-cfg_directory", profile.cfgDir || mame.cfgDir);
  }

  args.push(...validateLaunchArgs(mame.launchArgs));
  args.push(...validateLaunchArgs(profile.launchArgs, `mame.profiles.${mode}.launchArgs`));
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
  const cwd = path.dirname(command);

  addDefaultLaunchArgs(args);
  addPackV2ResourceArgs(args, config, mode);

  if (mode === "competition") {
    const run = config.v2PluginRun;

    if (!run?.runRoot || !run?.pluginSearchDir || !run?.stagingPendingDir || run.pluginName !== pluginName) {
      throw new Error("Competicion v2 requiere preparar plugin/adaptador aislado antes de lanzar MAME.");
    }

    args.push(
      "-homepath",
      run.runRoot,
      "-pluginspath",
      buildPluginSearchPath(run.pluginSearchDir, cwd),
      "-plugins",
      "-plugin",
      pluginName
    );
  }

  return {
    args,
    command,
    cwd,
    game: launch.game,
    mode,
    pluginName,
    rom: launch.rom,
    runtime: "shared-mame",
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
    console.log(`Plugin: ${launch.pluginName} no se activa explicitamente`);
    console.log("Nota: si esta activado globalmente en plugin.ini, MAME podria cargarlo igualmente.");
  }

  console.log(`Ejecutable: ${launch.command}`);
  console.log(`Working dir: ${launch.cwd}`);
  console.log(`Args: ${launch.args.join(" ")}`);

  if (launch.runtime === "shared-mame") {
    console.log("Runtime: MAME compartido");
  }

  if (launch.v2PluginRun) {
    console.log(`Run v2: ${launch.v2PluginRun.runId || launch.v2PluginRun.runRoot}`);
    console.log(`Pluginpath v2: ${buildPluginSearchPath(launch.v2PluginRun.pluginSearchDir, launch.cwd)}`);
    console.log(`Staging v2: ${launch.v2PluginRun.stagingPendingDir}`);
  }

  console.log("");
}

function assertLaunchResources(config, launch) {
  if (launch.runtime !== "shared-mame") {
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

    const stockPluginBoot = path.join(launch.cwd, "plugins", "boot.lua");

    if (!fs.existsSync(stockPluginBoot) || !fs.statSync(stockPluginBoot).isFile()) {
      throw new Error("No encuentro boot.lua en los plugins base de MAME compartido.");
    }

    if (!run?.stagingPendingDir || !fs.existsSync(run.stagingPendingDir) || !fs.statSync(run.stagingPendingDir).isDirectory()) {
      throw new Error("No encuentro el staging preparado para competicion v2.");
    }
  }
}

function launchMame(config, rom, mode, spawnImpl = spawn) {
  const launch = buildMameArgs(config, rom, mode);
  assertLaunchResources(config, launch);
  printLaunchSummary(launch);

  return new Promise((resolve, reject) => {
    const child = spawnImpl(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
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

function launchMameDetailed(config, rom, mode, spawnImpl = spawn) {
  const launch = buildMameArgs(config, rom, mode);
  assertLaunchResources(config, launch);
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

    child.on("error", reject);
    child.on("close", (code) => resolve({
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
