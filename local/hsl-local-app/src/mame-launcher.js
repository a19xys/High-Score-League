const { spawn } = require("node:child_process");
const { getGameByRom } = require("./games");

const DEFAULT_PLUGIN_NAME = "hsl-score";
const MODES = new Set(["competition", "practice"]);

function assertMameConfig(config) {
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

function buildMameArgs(config, rom, mode) {
  if (!MODES.has(mode)) {
    throw new Error(`Modo de MAME desconocido: ${mode}`);
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
  console.log("");
}

function launchMame(config, rom, mode, spawnImpl = spawn) {
  const launch = buildMameArgs(config, rom, mode);
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
