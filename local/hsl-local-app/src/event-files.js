const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { assertBox, getBoxDir } = require("./config");
const { assertDirExists, pathExists } = require("./file-utils");
const { validateEvent } = require("./event-validation");
const { printEventCard, printHeader } = require("./output");

async function listJsonFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
}

async function readEventFile(dir, filename) {
  const safeName = path.basename(filename);
  const fullPath = path.join(dir, safeName);
  const raw = await fsp.readFile(fullPath, "utf8");

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      filename: safeName,
      fullPath,
      ok: false,
      event: null,
      errors: [`JSON inválido: ${error.message}`],
      warnings: [],
    };
  }

  const validation = validateEvent(parsed);

  return {
    filename: safeName,
    fullPath,
    ok: validation.errors.length === 0,
    event: parsed,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

async function scanBox(config, box = "pending") {
  assertBox(box);

  const dir = getBoxDir(config, box);

  printHeader(config);

  await assertDirExists(dir, box);

  const files = await listJsonFiles(dir);

  console.log(`Caja: ${box}`);
  console.log("");

  if (files.length === 0) {
    console.log("No hay eventos.");
    console.log("");
    return;
  }

  const results = [];

  for (const filename of files) {
    const result = await readEventFile(dir, filename);
    results.push(result);
  }

  const okCount = results.filter((result) => result.ok).length;
  const errorCount = results.length - okCount;

  console.log(`Eventos encontrados: ${results.length}`);
  console.log(`Válidos: ${okCount}`);
  console.log(`Con error: ${errorCount}`);
  console.log("");

  results.forEach(printEventCard);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

async function showOne(config, filename, box = "pending") {
  assertBox(box);

  printHeader(config);

  if (!filename) {
    console.error("Uso: node app.js show <archivo.json> [pending|sent|failed]");
    process.exitCode = 1;
    return;
  }

  const dir = getBoxDir(config, box);
  await assertDirExists(dir, box);

  const safeName = path.basename(filename);
  const fullPath = path.join(dir, safeName);

  if (!(await pathExists(fullPath))) {
    console.error(`No existe el archivo: ${fullPath}`);
    process.exitCode = 1;
    return;
  }

  const result = await readEventFile(dir, safeName);
  printEventCard(result, 0);

  if (result.event) {
    console.log("JSON completo:");
    console.log(JSON.stringify(result.event, null, 2));
    console.log("");
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function watchPending(config) {
  printHeader(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");

  console.log("Modo vigilancia activo.");
  console.log("Cuando MAME escriba un JSON nuevo, se reescaneará pending.");
  console.log("Pulsa Ctrl+C para salir.");
  console.log("");

  await scanBox(config, "pending");

  let timer = null;

  fs.watch(config.eventsPendingDirAbs, () => {
    clearTimeout(timer);

    timer = setTimeout(async () => {
      console.clear();

      try {
        await scanBox(config, "pending");
      } catch (error) {
        console.error("Error durante el escaneo:");
        console.error(error);
      }
    }, 500);
  });
}

module.exports = {
  listJsonFiles,
  readEventFile,
  scanBox,
  showOne,
  watchPending,
};
