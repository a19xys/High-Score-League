const fs = require("node:fs");
const path = require("node:path");
const { getV2CaptureReadiness } = require("./mame-plugin-run");

function exists(targetPath) {
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function isDirectory(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function check(id, level, label, message, technicalDetails = []) {
  return {
    id,
    label,
    level,
    message,
    technicalDetails: technicalDetails.filter(Boolean),
  };
}

function firstBlockingMessage(checks) {
  return checks.find((item) => item.level === "error")?.message || null;
}

function summarizeStatus(checks) {
  if (checks.some((item) => item.level === "error")) {
    return "blocked";
  }

  if (checks.some((item) => item.level === "warning")) {
    return "warning";
  }

  if (checks.length === 0) {
    return "unknown";
  }

  return "ready";
}

function getPluginName(config) {
  return config?.mame?.pluginName || config?.pack?.capture?.pluginName || config?.pack?.contract?.capture?.pluginName || config?.pack?.plugin?.name || "hsl-score";
}

function inferRomPath(config, rom) {
  if (config?.pack?.contract?.version === 2 && config.pack.contract.mame?.romDir && rom) {
    return path.join(config.pack.contract.mame.romDir, `${rom}.zip`);
  }

  if (!config?.mame?.workingDir || !rom) {
    return null;
  }

  return path.join(config.mame.workingDir, "roms", `${rom}.zip`);
}

function expectedRomLabel(config, rom) {
  if (config?.pack?.contract?.version === 2 && config.pack.contract.mame?.romPath && rom) {
    return `${String(config.pack.contract.mame.romPath).replaceAll("\\", "/").replace(/\/+$/, "")}/${rom}.zip`;
  }

  return rom ? `roms/${rom}.zip` : "roms/<rom>.zip";
}

function buildTitle(status) {
  if (status === "ready") {
    return "Listo para jugar";
  }

  if (status === "warning") {
    return "Listo con avisos";
  }

  if (status === "blocked") {
    return "Requiere atencion";
  }

  return "Estado del pack desconocido";
}

function buildMessage({ checks, status, canPlayCompetition, canPractice, canSubmit }) {
  const blocker = firstBlockingMessage(checks);

  if (blocker) {
    return blocker;
  }

  if (status === "warning") {
    if (canPlayCompetition && !canSubmit) {
      return "Puedes jugar, pero la subida automatica no esta lista todavia.";
    }

    return "Puedes usar el pack, pero hay avisos que conviene revisar.";
  }

  if (canPlayCompetition && canPractice && canSubmit) {
    return "Puedes practicar, competir y sincronizar puntuaciones.";
  }

  if (canPractice && !canPlayCompetition) {
    return "Puedes practicar, pero la competicion necesita atencion.";
  }

  return "No se pudo determinar si el pack esta listo.";
}

function evaluatePackReadiness({ config = {}, session = {}, membership = {}, scope = null, queue = {}, autoSync = {} } = {}) {
  const checks = [];
  const pack = config.pack || null;
  const isPackV2 = pack?.packVersion === 2 || pack?.contract?.version === 2 || config.requiresSharedMameRuntime === true;
  const sharedRuntime = config.sharedMameRuntime || {};
  const v2Capture = isPackV2 ? getV2CaptureReadiness(config) : null;
  const rom = pack?.rom || config.rom || null;
  const weekId = config.defaultWeekId || pack?.weekId || null;
  const pluginName = getPluginName(config);
  const pluginDir = !isPackV2 && config.mame?.workingDir && pluginName
    ? path.join(config.mame.workingDir, "plugins", pluginName)
    : null;
  const hasPluginStaging = !isPackV2 && (
    config.eventQueueRole === "plugin-staging" ||
    config.eventsSource === "opened-pack" ||
    config.eventsSource === "explicit" ||
    Boolean(config.stagingEventsPendingDirAbs || config.stagingEventsSentDirAbs || config.stagingEventsFailedDirAbs)
  );
  const stagingRoot = config.eventsBaseDirAbs || (
    hasPluginStaging && config.mame?.workingDir && pluginName
      ? path.join(config.mame.workingDir, "plugins", pluginName, "events")
      : null
  );
  const stagingDirs = hasPluginStaging
    ? [
        config.stagingEventsPendingDirAbs || config.eventsPendingDirAbs || (stagingRoot ? path.join(stagingRoot, "pending") : null),
        config.stagingEventsSentDirAbs || config.eventsSentDirAbs || (stagingRoot ? path.join(stagingRoot, "sent") : null),
        config.stagingEventsFailedDirAbs || config.eventsFailedDirAbs || (stagingRoot ? path.join(stagingRoot, "failed") : null),
      ]
    : [];
  const romPath = inferRomPath(config, rom);

  if (config.packLoaded || pack) {
    checks.push(check("pack-json", "ok", "Pack", "pack.json cargado.", [config.packPath]));
  } else {
    checks.push(check("pack-json", "warning", "Pack", "No hay pack.json activo.", [config.packPath]));
  }

  if (config.packErrors?.length > 0) {
    checks.push(check("pack-valid", "error", "Pack", "El pack tiene errores de configuracion.", config.packErrors));
  } else {
    checks.push(check("pack-valid", "ok", "Pack", "Configuracion basica del pack valida."));
  }

  if (pack?.duplicatePackId) {
    checks.push(check(
      "pack-id-duplicate",
      "error",
      "Pack",
      "Hay otro pack con el mismo packId. Cambia el packId o elimina el duplicado.",
      [pack.packId]
    ));
  }

  if (pack?.contractStatus) {
    checks.push(check(
      "pack-contract",
      pack.deprecated ? "warning" : "ok",
      "Contrato",
      pack.deprecated
        ? "Este pack usa un contrato legacy/deprecated."
        : `Contrato ${pack.contractStatus}.`,
      [
        `packVersion=${pack.packVersion}`,
        pack.deprecationReason,
        pack.replacement ? `replacement=${pack.replacement}` : null,
      ]
    ));
  }

  const contractWarnings = (pack?.warnings || []).filter((item) => !(pack?.metadataWarnings || []).includes(item));

  if (contractWarnings.length > 0) {
    checks.push(check("pack-contract-warnings", "warning", "Contrato", "El contrato del pack tiene avisos no bloqueantes.", contractWarnings));
  }

  if (config.packRoot && isDirectory(config.packRoot)) {
    checks.push(check("pack-root", "ok", "Pack", "La carpeta del pack existe.", [config.packRoot]));
  } else if (config.packRoot) {
    checks.push(check("pack-root", "error", "Pack", "No encuentro la carpeta raiz del pack.", [config.packRoot]));
  }

  if (config.packPath && isFile(config.packPath)) {
    checks.push(check("pack-path", "ok", "Pack", "El archivo pack.json existe.", [config.packPath]));
  } else if (config.packPath && (config.packLoaded || pack)) {
    checks.push(check("pack-path", "error", "Pack", "No encuentro el archivo pack.json.", [config.packPath]));
  }

  for (const [id, label, value] of [
    ["pack-id", "Pack", pack?.packId || pack?.gameId || config.gameId],
    ["rom", "ROM", rom],
    ["week-id", "Competicion", weekId],
  ]) {
    checks.push(
      value
        ? check(id, "ok", label, `${label} configurado.`, [value])
        : check(id, id === "week-id" ? "error" : "error", label, `Falta ${label === "ROM" ? "ROM" : "un dato obligatorio del pack"}.`)
    );
  }

  if (pack?.metadataWarnings?.length > 0) {
    checks.push(check("metadata", "warning", "Metadata", "metadata.json tiene avisos no bloqueantes.", pack.metadataWarnings));
  } else {
    checks.push(check("metadata", "ok", "Metadata", pack?.metadataLoaded ? "metadata.json cargado." : "metadata.json no es obligatorio."));
  }

  if (isPackV2) {
    if (sharedRuntime.available) {
      checks.push(check("runtime-shared", "ok", "MAME", "Runtime MAME compartido encontrado.", [sharedRuntime.mameExecutablePath]));
    } else if (sharedRuntime.configured) {
      checks.push(check("runtime-shared", "error", "MAME", "No se encontro mame.exe en el runtime compartido.", [
        sharedRuntime.mameExecutablePath,
        ...(sharedRuntime.errors || []),
      ]));
    } else {
      checks.push(check("runtime-shared", "error", "MAME", "Runtime MAME compartido no configurado."));
    }
  } else if (isFile(config.mame?.executablePath)) {
    checks.push(check("mame-executable", "ok", "MAME", "mame.exe encontrado.", [config.mame.executablePath]));
  } else {
    checks.push(check("mame-executable", "error", "MAME", "No encuentro mame.exe. Revisa la carpeta del pack.", [config.mame?.executablePath]));
  }

  if (isPackV2) {
    checks.push(check("mame-working-dir", "ok", "MAME", "packVersion 2 usa MAME compartido, no mame.workingDir del pack."));
  } else if (isDirectory(config.mame?.workingDir)) {
    checks.push(check("mame-working-dir", "ok", "MAME", "Carpeta de trabajo de MAME encontrada.", [config.mame.workingDir]));
  } else {
    checks.push(check("mame-working-dir", "error", "MAME", "No encuentro la carpeta de trabajo de MAME.", [config.mame?.workingDir]));
  }

  if (isPackV2) {
    const capture = pack?.contract?.capture || {};
    const adapterExists = isFile(capture.adapterPath);

    checks.push(check(
      "capture-mode-v2",
      capture.mode === "plugin" ? "ok" : "error",
      "Captura",
      capture.mode === "plugin"
        ? "El pack declara captura mediante plugin."
        : "capture.mode debe ser plugin para la captura v2 actual.",
      [capture.mode ? `capture.mode=${capture.mode}` : "capture.mode ausente"]
    ));
    checks.push(check(
      "capture-plugin-v2",
      capture.pluginName ? "ok" : "error",
      "Plugin",
      capture.pluginName
        ? `Plugin de captura declarado: ${capture.pluginName}.`
        : "El pack v2 no declara capture.pluginName."
    ));
    checks.push(check(
      "capture-adapter-v2",
      adapterExists ? "ok" : "error",
      "Adaptador",
      adapterExists
        ? "Adaptador de captura encontrado dentro del pack."
        : capture.adapter
          ? "No encuentro el adaptador de captura declarado dentro del pack."
          : "El pack v2 no declara capture.adapter.",
      [capture.adapter ? `capture.adapter=${capture.adapter}` : null, capture.adapterPath]
    ));
    checks.push(check(
      "capture-v2",
      v2Capture.ok ? "ok" : "error",
      "Competicion",
      v2Capture.ok
        ? "Cargador competitivo v2 disponible; el plugin/adaptador se prepara por ejecucion."
        : "No se puede preparar el plugin/adaptador competitivo v2.",
      v2Capture.ok
        ? [
            `plugin=${v2Capture.pluginName}`,
            v2Capture.adapterPath,
          ]
        : v2Capture.errors
    ));
  } else if (pluginName) {
    checks.push(check("plugin-name", "ok", "Plugin", `Plugin configurado: ${pluginName}.`));
  } else {
    checks.push(check("plugin-name", "error", "Plugin", "No hay plugin configurado para capturar puntuaciones."));
  }

  if (pluginDir && isDirectory(pluginDir)) {
    checks.push(check("plugin-folder", "ok", "Plugin", "Carpeta del plugin encontrada.", [pluginDir]));
  } else if (pluginDir && isDirectory(config.mame?.workingDir)) {
    checks.push(check("plugin-folder", "error", "Plugin", "No encuentro la carpeta del plugin en el pack.", [pluginDir]));
  }

  if (isPackV2 && pack?.contract?.mame?.romDir) {
    if (isDirectory(pack.contract.mame.romDir)) {
      checks.push(check("rom-dir", "ok", "ROM", "Directorio de ROMs del pack encontrado.", [pack.contract.mame.romDir]));
    } else {
      checks.push(check("rom-dir", "error", "ROM", "No encuentro el directorio de ROMs del pack v2.", [pack.contract.mame.romDir]));
    }
  }

  if (romPath && exists(romPath)) {
    checks.push(check("rom-file", "ok", "ROM", "ROM encontrada en roms/.", [romPath]));
  } else if (!isPackV2 && romPath && isDirectory(config.mame?.workingDir)) {
    checks.push(check("rom-file", "warning", "ROM", "No pude confirmar la ROM en roms/. MAME podria usar otra ruta.", [romPath]));
  } else if (isPackV2 && romPath && isDirectory(pack?.contract?.mame?.romDir)) {
    checks.push(check("rom-file", "error", "ROM", `Falta la ROM necesaria: ${expectedRomLabel(config, rom)}.`, [romPath]));
  } else if (isPackV2 && romPath) {
    checks.push(check("rom-file", "error", "ROM", `Falta la ROM necesaria: ${expectedRomLabel(config, rom)}.`, [romPath]));
  }

  if (isPackV2) {
    checks.push(check(
      "staging-v2-deferred",
      "ok",
      "Captura",
      "Staging competitivo v2 pendiente de la carga segura del plugin/adaptador.",
      [
        "La GUI usa cola scoped por cuenta y pack.",
        "No se evalua userData/events como staging del pack v2.",
      ]
    ));
  } else {
    for (const [index, dir] of stagingDirs.entries()) {
      const box = ["pending", "sent", "failed"][index];

      if (isDirectory(dir)) {
        checks.push(check(`staging-${box}`, "ok", "Captura", `Staging ${box} existe.`, [dir]));
      } else if (dir && isDirectory(path.dirname(dir))) {
        checks.push(check(`staging-${box}`, "warning", "Captura", `Staging ${box} no existe todavia, pero parece creable.`, [dir]));
      } else {
        checks.push(check(`staging-${box}`, "warning", "Captura", `Staging ${box} no esta preparado.`, [dir]));
      }
    }
  }

  if (session?.hasSession) {
    checks.push(check("session", "ok", "Sesion", "Sesion local encontrada.", [session.email]));
  } else {
    checks.push(check("session", "error", "Sesion", "Inicia sesion para jugar competicion."));
  }

  if (scope?.scopedQueueRoot) {
    checks.push(check("scope", "ok", "Cola scoped", "Cola separada por cuenta y pack preparada.", [scope.scopedQueueRoot]));
  } else {
    checks.push(check("scope", "error", "Cola scoped", "No se pudo preparar la cola local de esta cuenta y pack."));
  }

  if (membership?.status === "member") {
    checks.push(check("membership", "ok", "Participacion", "Participas en la temporada."));
  } else if (membership?.status === "unknown" || membership?.status === "error") {
    checks.push(check("membership", "warning", "Participacion", membership.message || "No se pudo comprobar la participacion.", [membership.technicalReason]));
  } else {
    checks.push(check("membership", "error", "Participacion", membership?.message || "No participas en esta temporada."));
  }

  if (config.webBaseUrl) {
    checks.push(check("web-base-url", "ok", "Sync", "Web configurada.", [config.webBaseUrl]));
  } else {
    checks.push(check("web-base-url", "error", "Sync", "Falta webBaseUrl para sincronizar puntuaciones."));
  }

  if (queue?.totals?.failed > 0) {
    checks.push(check("failed-queue", "warning", "Cola", "Hay puntuaciones con error que requieren atencion.", [`failed=${queue.totals.failed}`]));
  }

  if (autoSync?.status === "blocked" || autoSync?.status === "failed" || autoSync?.status === "partial_failed") {
    checks.push(check("auto-sync", "warning", "Auto-sync", autoSync.message || "Auto-sync requiere atencion.", [autoSync.reason]));
  } else {
    checks.push(check("auto-sync", "ok", "Auto-sync", autoSync?.message || "Auto-sync listo."));
  }

  const hasMame = isPackV2
    ? checks.find((item) => item.id === "runtime-shared")?.level === "ok"
    : checks.find((item) => item.id === "mame-executable")?.level === "ok" &&
      checks.find((item) => item.id === "mame-working-dir")?.level === "ok";
  const hasRom = Boolean(rom) && (
    checks.find((item) => item.id === "rom-file")?.level === "ok" ||
    (!isPackV2 && checks.find((item) => item.id === "rom-file")?.level !== "error")
  );
  const hasRomDir = !isPackV2 || checks.find((item) => item.id === "rom-dir")?.level === "ok";
  const hasPlugin = isPackV2
    ? Boolean(v2Capture?.ok)
    : Boolean(pluginName) && checks.find((item) => item.id === "plugin-folder")?.level !== "error";
  const hasSession = Boolean(session?.hasSession);
  const hasScope = Boolean(scope?.scopedQueueRoot);
  const hasWeek = Boolean(weekId);
  const membershipStatus = membership?.status || "unknown";
  const membershipAllowsCompetition = membershipStatus === "member" || membershipStatus === "unknown" || membershipStatus === "error";
  const canPractice = hasMame && hasRom && hasRomDir;
  const canCapture = hasPlugin;
  const canPlayCompetition = canPractice && canCapture && hasSession && hasScope && hasWeek && membershipAllowsCompetition;
  const canSubmit = Boolean(hasSession && hasScope && hasWeek && config.webBaseUrl && membership?.canSubmit === true);
  const status = summarizeStatus(checks.filter((item) => {
    if (item.id === "session" || item.id === "scope" || item.id === "membership" || item.id === "web-base-url") {
      return false;
    }

    return true;
  }));
  const effectiveStatus = !canPractice || (!canPlayCompetition && hasSession && membershipStatus !== "unknown" && membershipStatus !== "error")
    ? "blocked"
    : status === "blocked"
      ? "blocked"
      : checks.some((item) => item.level === "warning") || !canSubmit
        ? "warning"
        : "ready";
  const blockers = checks.filter((item) => item.level === "error").map((item) => item.message);
  const warnings = checks.filter((item) => item.level === "warning").map((item) => item.message);

  return {
    blockers,
    canCapture,
    canPlayCompetition,
    canPractice,
    canSubmit,
    checks,
    message: buildMessage({ checks, status: effectiveStatus, canPlayCompetition, canPractice, canSubmit }),
    status: effectiveStatus,
    title: buildTitle(effectiveStatus),
    warnings,
  };
}

module.exports = {
  evaluatePackReadiness,
  inferRomPath,
};
