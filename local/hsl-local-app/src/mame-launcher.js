const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getGameByRom } = require("./games");

const DEFAULT_PLUGIN_NAME = "hsl-score";
const MODES = new Set(["competition", "practice"]);

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

function validateLaunchArgs(launchArgs) {
  if (launchArgs === undefined || launchArgs === null) {
    return [];
  }

  if (!Array.isArray(launchArgs)) {
    throw new Error("pack.json mame.launchArgs debe ser un array");
  }

  return launchArgs.map((value) => {
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error("pack.json mame.launchArgs solo puede incluir strings seguros");
    }

    return value;
  });
}

function buildPackV2MameArgs(config, rom, mode) {
  if (mode === "competition") {
    throw new Error(
      "Competicion v2 bloqueada: el pack puede declarar capture.pluginName y capture.adapter, pero el launcher aun no carga ese adaptador de forma segura. La practica v2 ya usa MAME compartido."
    );
  }

  assertSharedMameRuntimeConfig(config);

  const launch = resolveLaunchRom(rom);
  const mame = config.pack?.contract?.mame || {};
  const args = [launch.rom];

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

  if (mame.cfgDir) {
    args.push("-cfg_directory", mame.cfgDir);
  }

  args.push(...validateLaunchArgs(mame.launchArgs));

  return {
    args,
    command: config.sharedMameRuntime.mameExecutablePath.trim(),
    cwd: path.dirname(config.sharedMameRuntime.mameExecutablePath.trim()),
    game: launch.game,
    mode,
    pluginName: config.pack?.contract?.capture?.pluginName || DEFAULT_PLUGIN_NAME,
    rom: launch.rom,
    runtime: "shared-mame",
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

  if (launch.runtime === "shared-mame") {
    console.log("Runtime: MAME compartido");
  }

  console.log("");
}

function assertLaunchResources(config, launch) {
  if (launch.runtime !== "shared-mame") {
    return;
  }

  const romDir = config.pack?.contract?.mame?.romDir;

  if (!romDir || !fs.existsSync(romDir) || !fs.statSync(romDir).isDirectory()) {
    throw new Error("No encuentro el directorio de ROMs del pack v2.");
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

module.exports = {
  DEFAULT_PLUGIN_NAME,
  assertMameConfig,
  buildMameArgs,
  launchMame,
  printLaunchSummary,
};
