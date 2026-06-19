const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { getBoxDir } = require("./config");
const { assertDirExists, pathExists } = require("./file-utils");
const { readEventFile } = require("./event-files");
const { printEventCard, printHeader } = require("./output");

function getNonClashingPath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);

  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}__${i}${parsed.ext}`);

    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No pude encontrar nombre libre para: ${targetPath}`);
}

async function moveFileSafe(sourcePath, desiredTargetPath) {
  const targetPath = getNonClashingPath(desiredTargetPath);

  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if (error && error.code === "EXDEV") {
      await fsp.copyFile(sourcePath, targetPath);
      await fsp.unlink(sourcePath);
    } else {
      throw error;
    }
  }

  return targetPath;
}

async function writeFailureNote(config, jsonFilename, reason) {
  const safeName = path.basename(jsonFilename);
  const notePath = path.join(config.eventsFailedDirAbs, `${safeName}.failed.txt`);

  const lines = [
    `failedAt=${new Date().toISOString()}`,
    `reason=${reason || "Sin motivo indicado"}`,
    "",
  ];

  await fsp.writeFile(notePath, lines.join("\n"), "utf8");
}

function parseFailureNote(raw) {
  const result = {
    failedAt: null,
    reason: null,
  };

  for (const line of String(raw || "").split(/\r?\n/)) {
    const separator = line.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);

    if (key === "failedAt") {
      result.failedAt = value || null;
    }

    if (key === "reason") {
      result.reason = value || null;
    }
  }

  return result;
}

async function readFailureNote(config, jsonFilename) {
  const safeName = path.basename(jsonFilename);
  const notePath = path.join(config.eventsFailedDirAbs, `${safeName}.failed.txt`);

  try {
    const raw = await fsp.readFile(notePath, "utf8");

    return {
      exists: true,
      notePath,
      ...parseFailureNote(raw),
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        exists: false,
        failedAt: null,
        notePath,
        reason: null,
      };
    }

    throw error;
  }
}

async function restoreBoxToPending(config, fromBox, filename) {
  if (fromBox !== "sent" && fromBox !== "failed") {
    throw new Error("Solo se puede restaurar desde sent o failed.");
  }

  const sourceDir = getBoxDir(config, fromBox);

  await assertDirExists(sourceDir, fromBox);
  await assertDirExists(config.eventsPendingDirAbs, "pending");

  const safeName = path.basename(filename);
  const sourcePath = path.join(sourceDir, safeName);

  if (!(await pathExists(sourcePath))) {
    throw new Error(`No existe en ${fromBox}: ${sourcePath}`);
  }

  const desiredTargetPath = path.join(config.eventsPendingDirAbs, safeName);
  const finalPath = await moveFileSafe(sourcePath, desiredTargetPath);

  return {
    finalPath,
    fromBox,
    originalFilename: safeName,
    restoredFilename: path.basename(finalPath),
  };
}

async function markSent(config, filename) {
  printHeader(config);

  if (!filename) {
    console.error("Uso: node app.js mark-sent <archivo.json>");
    process.exitCode = 1;
    return;
  }

  await assertDirExists(config.eventsPendingDirAbs, "pending");
  await assertDirExists(config.eventsSentDirAbs, "sent");

  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);

  if (!(await pathExists(sourcePath))) {
    console.error(`No existe en pending: ${sourcePath}`);
    process.exitCode = 1;
    return;
  }

  const result = await readEventFile(config.eventsPendingDirAbs, safeName);

  if (!result.ok) {
    console.error("No marco como sent porque el evento no es válido.");
    console.error("Mándalo a failed o corrige el JSON.");
    console.log("");
    printEventCard(result, 0);
    process.exitCode = 1;
    return;
  }

  const desiredTargetPath = path.join(config.eventsSentDirAbs, safeName);
  const finalPath = await moveFileSafe(sourcePath, desiredTargetPath);

  console.log("Evento movido a sent:");
  console.log(finalPath);
  console.log("");
}

async function markFailed(config, filename, reason) {
  printHeader(config);

  if (!filename) {
    console.error("Uso: node app.js mark-failed <archivo.json> [motivo]");
    process.exitCode = 1;
    return;
  }

  await assertDirExists(config.eventsPendingDirAbs, "pending");
  await assertDirExists(config.eventsFailedDirAbs, "failed");

  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);

  if (!(await pathExists(sourcePath))) {
    console.error(`No existe en pending: ${sourcePath}`);
    process.exitCode = 1;
    return;
  }

  const desiredTargetPath = path.join(config.eventsFailedDirAbs, safeName);
  const finalPath = await moveFileSafe(sourcePath, desiredTargetPath);

  await writeFailureNote(config, path.basename(finalPath), reason);

  console.log("Evento movido a failed:");
  console.log(finalPath);
  console.log("");

  if (reason) {
    console.log(`Motivo: ${reason}`);
    console.log("");
  }
}

async function restoreToPending(config, fromBox, filename) {
  printHeader(config);

  if (!fromBox || !filename) {
    console.error("Uso: node app.js restore <sent|failed> <archivo.json>");
    process.exitCode = 1;
    return;
  }

  if (fromBox !== "sent" && fromBox !== "failed") {
    console.error("Solo se puede restaurar desde sent o failed.");
    process.exitCode = 1;
    return;
  }

  let result;

  try {
    result = await restoreBoxToPending(config, fromBox, filename);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Evento restaurado desde ${fromBox} a pending:`);
  console.log(result.finalPath);
  console.log("");
}

async function movePendingToSent(config, filename) {
  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);
  const desiredTargetPath = path.join(config.eventsSentDirAbs, safeName);

  return moveFileSafe(sourcePath, desiredTargetPath);
}

async function movePendingToFailed(config, filename, reason) {
  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);
  const desiredTargetPath = path.join(config.eventsFailedDirAbs, safeName);

  const finalPath = await moveFileSafe(sourcePath, desiredTargetPath);
  await writeFailureNote(config, path.basename(finalPath), reason);

  return finalPath;
}

module.exports = {
  getNonClashingPath,
  markFailed,
  markSent,
  moveFileSafe,
  movePendingToFailed,
  movePendingToSent,
  parseFailureNote,
  readFailureNote,
  restoreBoxToPending,
  restoreToPending,
  writeFailureNote,
};
