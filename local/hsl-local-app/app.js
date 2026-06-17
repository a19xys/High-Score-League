const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const eventValidation = require("./src/event-validation");
const submissionPayload = require("./src/submission-payload");

const APP_DIR = __dirname;
const CONFIG_PATH = path.join(APP_DIR, "config.json");

const ALLOWED_SOURCES = new Set([
  "web",
  "mame_memory",
  "mame_plugin",
  "local_app",
  "admin_import",
]);

const BOXES = new Set(["pending", "sent", "failed"]);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No existe config.json en ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const config = JSON.parse(raw);

  if (!config.eventsPendingDir || typeof config.eventsPendingDir !== "string") {
    throw new Error("config.json debe incluir eventsPendingDir");
  }

  const eventsSentDir = config.eventsSentDir || "../plugins/hsl-score/events/sent";
  const eventsFailedDir = config.eventsFailedDir || "../plugins/hsl-score/events/failed";
  const sessionFile = config.sessionFile || ".hsl-session.json";

  return {
    ...config,
    eventsSentDir,
    eventsFailedDir,
    sessionFile,
    eventsPendingDirAbs: resolveFromAppDir(config.eventsPendingDir),
    eventsSentDirAbs: resolveFromAppDir(eventsSentDir),
    eventsFailedDirAbs: resolveFromAppDir(eventsFailedDir),
    sessionFileAbs: resolveFromAppDir(sessionFile),
  };
}

function resolveFromAppDir(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(APP_DIR, value);
}

function getBoxDir(config, box) {
  if (box === "pending") return config.eventsPendingDirAbs;
  if (box === "sent") return config.eventsSentDirAbs;
  if (box === "failed") return config.eventsFailedDirAbs;

  throw new Error(`Caja desconocida: ${box}`);
}

function assertBox(box) {
  if (!BOXES.has(box)) {
    throw new Error(`Caja inválida: ${box}. Usa pending, sent o failed.`);
  }
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertDirExists(dir, label) {
  const exists = await pathExists(dir);

  if (!exists) {
    throw new Error(`No existe la carpeta ${label}: ${dir}`);
  }

  const stat = await fsp.stat(dir);

  if (!stat.isDirectory()) {
    throw new Error(`${label} existe, pero no es una carpeta: ${dir}`);
  }
}

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

  const validation = eventValidation.validateEvent(parsed);

  return {
    filename: safeName,
    fullPath,
    ok: validation.errors.length === 0,
    event: parsed,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

function validateEvent(event) {
  const errors = [];
  const warnings = [];

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return {
      errors: ["El evento no es un objeto JSON válido"],
      warnings,
    };
  }

  if (event.schemaVersion !== 1) {
    errors.push("schemaVersion debe ser 1");
  }

  if (!event.rom || typeof event.rom !== "string") {
    errors.push("rom debe ser un string");
  }

  if (!Number.isInteger(event.score) || event.score < 0) {
    errors.push("score debe ser un entero >= 0");
  }

  if (!event.detectedAt || typeof event.detectedAt !== "string") {
    errors.push("detectedAt debe ser un string ISO");
  } else {
    const date = new Date(event.detectedAt);
    if (Number.isNaN(date.getTime())) {
      errors.push("detectedAt no es una fecha válida");
    }
  }

  if (!event.source || typeof event.source !== "string") {
    errors.push("source debe ser un string");
  } else if (!ALLOWED_SOURCES.has(event.source)) {
    errors.push(`source no permitido: ${event.source}`);
  }

  if (!event.game || typeof event.game !== "string") {
    warnings.push("game falta o no es string");
  }

  if (!event.pluginVersion || typeof event.pluginVersion !== "string") {
    warnings.push("pluginVersion falta o no es string");
  }

  if (!event.mameVersion || typeof event.mameVersion !== "string") {
    warnings.push("mameVersion falta o no es string");
  }

  if (!event.detection || typeof event.detection !== "object") {
    warnings.push("detection falta o no es objeto");
  } else {
    if (typeof event.detection.manualConfirm !== "boolean") {
      warnings.push("detection.manualConfirm falta o no es boolean");
    }

    if (typeof event.detection.gameOverDetected !== "boolean") {
      warnings.push("detection.gameOverDetected falta o no es boolean");
    }

    if (!event.detection.method || typeof event.detection.method !== "string") {
      warnings.push("detection.method falta o no es string");
    }
  }

  if (!event.scoreData || typeof event.scoreData !== "object") {
    warnings.push("scoreData falta o no es objeto");
  } else {
    if (
      event.scoreData.trackedScore !== undefined &&
      (!Number.isInteger(event.scoreData.trackedScore) || event.scoreData.trackedScore < 0)
    ) {
      warnings.push("scoreData.trackedScore debería ser entero >= 0");
    }

    if (
      event.scoreData.displayScore !== undefined &&
      (!Number.isInteger(event.scoreData.displayScore) || event.scoreData.displayScore < 0)
    ) {
      warnings.push("scoreData.displayScore debería ser entero >= 0");
    }

    if (
      event.scoreData.rollovers !== undefined &&
      (!Number.isInteger(event.scoreData.rollovers) || event.scoreData.rollovers < 0)
    ) {
      warnings.push("scoreData.rollovers debería ser entero >= 0");
    }
  }

  return { errors, warnings };
}

function formatDate(value) {
  if (!value) {
    return {
      utc: "sin fecha",
      local: "sin fecha",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      utc: String(value),
      local: "fecha inválida",
    };
  }

  return {
    utc: date.toISOString(),
    local: date.toLocaleString("es-ES", {
      hour12: false,
    }),
  };
}

function printHeader(config) {
  console.log("");
  console.log("High Score League Local App");
  console.log("===========================");
  console.log(`Versión cliente: ${config.clientVersion || "sin versión"}`);
  console.log(`Pending: ${config.eventsPendingDirAbs}`);
  console.log(`Sent:    ${config.eventsSentDirAbs}`);
  console.log(`Failed:  ${config.eventsFailedDirAbs}`);
  console.log("");
}

function printEventCard(result, index) {
  const prefix = result.ok ? "OK" : "ERROR";
  const event = result.event || {};
  const dates = formatDate(event.detectedAt);

  console.log(`${index + 1}. [${prefix}] ${result.filename}`);

  if (result.event) {
    console.log(`   Juego: ${event.game || "desconocido"} (${event.rom || "sin rom"})`);
    console.log(`   Score: ${Number.isInteger(event.score) ? event.score : "inválido"}`);
    console.log(`   Fecha UTC: ${dates.utc}`);
    console.log(`   Fecha local: ${dates.local}`);
    console.log(`   Fuente: ${event.source || "sin source"}`);
    console.log(`   MAME: ${event.mameVersion || "sin mameVersion"}`);
    console.log(`   Plugin: ${event.pluginVersion || "sin pluginVersion"}`);

    if (event.scoreData) {
      const display = event.scoreData.displayScore;
      const tracked = event.scoreData.trackedScore;
      const rollovers = event.scoreData.rollovers;

      console.log(
        `   ScoreData: display=${display ?? "?"}, tracked=${tracked ?? "?"}, rollovers=${rollovers ?? "?"}`
      );
    }
  }

  if (result.errors.length > 0) {
    console.log("   Errores:");
    for (const error of result.errors) {
      console.log(`   - ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("   Avisos:");
    for (const warning of result.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  console.log("");
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

  const sourceDir = getBoxDir(config, fromBox);

  await assertDirExists(sourceDir, fromBox);
  await assertDirExists(config.eventsPendingDirAbs, "pending");

  const safeName = path.basename(filename);
  const sourcePath = path.join(sourceDir, safeName);

  if (!(await pathExists(sourcePath))) {
    console.error(`No existe en ${fromBox}: ${sourcePath}`);
    process.exitCode = 1;
    return;
  }

  const desiredTargetPath = path.join(config.eventsPendingDirAbs, safeName);
  const finalPath = await moveFileSafe(sourcePath, desiredTargetPath);

  console.log(`Evento restaurado desde ${fromBox} a pending:`);
  console.log(finalPath);
  console.log("");
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

function loadSupabaseSdk() {
  try {
    return require("@supabase/supabase-js");
  } catch {
    throw new Error(
      "No encuentro @supabase/supabase-js. Ejecuta: npm install @supabase/supabase-js"
    );
  }
}

function assertAuthConfig(config) {
  if (!config.supabaseUrl || typeof config.supabaseUrl !== "string") {
    throw new Error("config.json debe incluir supabaseUrl");
  }

  if (!config.supabaseAnonKey || typeof config.supabaseAnonKey !== "string") {
    throw new Error("config.json debe incluir supabaseAnonKey");
  }

  if (config.supabaseAnonKey.toLowerCase().includes("service_role")) {
    throw new Error("No uses service_role en la app local. Usa la anon key.");
  }
}

function createSupabaseClient(config) {
  assertAuthConfig(config);

  const { createClient } = loadSupabaseSdk();

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function promptForValue(label, fallbackValue) {
  if (fallbackValue) {
    return fallbackValue;
  }

  const rl = readline.createInterface({ input, output });

  try {
    const value = await rl.question(label);
    return value.trim();
  } finally {
    rl.close();
  }
}

async function readSession(config) {
  if (!(await pathExists(config.sessionFileAbs))) {
    return null;
  }

  const raw = await fsp.readFile(config.sessionFileAbs, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`El archivo de sesión no es JSON válido: ${error.message}`);
  }
}

async function saveSession(config, session, user) {
  if (!session || !session.access_token || !session.refresh_token) {
    throw new Error("La sesión de Supabase no contiene access_token/refresh_token");
  }

  const data = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    supabaseUrl: config.supabaseUrl,
    user: {
      id: user?.id || null,
      email: user?.email || null,
    },
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type || "bearer",
      expires_at: session.expires_at || null,
      expires_in: session.expires_in || null,
    },
  };

  await fsp.writeFile(config.sessionFileAbs, JSON.stringify(data, null, 2), "utf8");
}

async function deleteSession(config) {
  if (await pathExists(config.sessionFileAbs)) {
    await fsp.unlink(config.sessionFileAbs);
  }
}

function isSessionExpiringSoon(storedSession) {
  const expiresAt = storedSession?.session?.expires_at;

  if (!expiresAt) {
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiresAt <= nowSeconds + 60;
}

function maskToken(token) {
  if (!token || typeof token !== "string") {
    return "sin token";
  }

  if (token.length <= 16) {
    return `${token.slice(0, 4)}...`;
  }

  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

async function refreshStoredSession(config, storedSession) {
  const refreshToken = storedSession?.session?.refresh_token;

  if (!refreshToken) {
    throw new Error("No hay refresh_token guardado. Haz login de nuevo.");
  }

  const supabase = createSupabaseClient(config);

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    throw new Error(`No pude refrescar sesión: ${error.message}`);
  }

  if (!data.session) {
    throw new Error("Supabase no devolvió una nueva sesión");
  }

  await saveSession(config, data.session, data.user || storedSession.user);

  return readSession(config);
}

async function getValidStoredSession(config) {
  let storedSession = await readSession(config);

  if (!storedSession) {
    throw new Error("No hay sesión guardada. Ejecuta: node app.js login");
  }

  if (isSessionExpiringSoon(storedSession)) {
    storedSession = await refreshStoredSession(config, storedSession);
  }

  return storedSession;
}

async function login(config, emailArg) {
  printHeader(config);
  assertAuthConfig(config);

  const email =
    emailArg ||
    process.env.HSL_EMAIL ||
    (await promptForValue("Email: ", null));

  const password =
    process.env.HSL_PASSWORD ||
    (await promptForValue("Password (visible en consola): ", null));

  if (!email || !password) {
    console.error("Email y password son obligatorios.");
    process.exitCode = 1;
    return;
  }

  const supabase = createSupabaseClient(config);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Login fallido:");
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (!data.session) {
    console.error("Login realizado, pero Supabase no devolvió sesión.");
    process.exitCode = 1;
    return;
  }

  await saveSession(config, data.session, data.user);

  console.log("Login correcto.");
  console.log(`Usuario: ${data.user?.email || data.user?.id || "desconocido"}`);
  console.log(`Sesión guardada en: ${config.sessionFileAbs}`);
  console.log(`Access token: ${maskToken(data.session.access_token)}`);
  console.log("");
}

async function authStatus(config) {
  printHeader(config);
  assertAuthConfig(config);

  let storedSession;

  try {
    storedSession = await getValidStoredSession(config);
  } catch (error) {
    console.log("No autenticado.");
    console.log(error.message);
    console.log("");
    return;
  }

  const supabase = createSupabaseClient(config);

  const { data, error } = await supabase.auth.getUser(
    storedSession.session.access_token
  );

  if (error) {
    console.log("Sesión local encontrada, pero no validada por Supabase.");
    console.log(error.message);
    console.log("");
    process.exitCode = 1;
    return;
  }

  console.log("Autenticado.");
  console.log(`Usuario: ${data.user?.email || storedSession.user?.email || data.user?.id}`);
  console.log(`User ID: ${data.user?.id || storedSession.user?.id || "desconocido"}`);
  console.log(`Session file: ${config.sessionFileAbs}`);
  console.log(`Access token: ${maskToken(storedSession.session.access_token)}`);
  console.log(`Expires at: ${storedSession.session.expires_at || "desconocido"}`);
  console.log("");
}

async function authToken(config) {
  printHeader(config);
  assertAuthConfig(config);

  const storedSession = await getValidStoredSession(config);

  console.log(storedSession.session.access_token);
}

async function logout(config) {
  printHeader(config);

  await deleteSession(config);

  console.log("Sesión local eliminada.");
  console.log("");
}

function assertSubmitConfig(config) {
  if (!config.webBaseUrl || typeof config.webBaseUrl !== "string") {
    throw new Error("config.json debe incluir webBaseUrl");
  }

  if (!config.defaultWeekId || typeof config.defaultWeekId !== "string") {
    throw new Error("config.json debe incluir defaultWeekId");
  }
}

function normalizeWebBaseUrl(webBaseUrl) {
  return String(webBaseUrl || "").replace(/\/+$/, "");
}

function getIngestUrl(config) {
  return `${normalizeWebBaseUrl(config.webBaseUrl)}/api/submissions/ingest`;
}

async function parseResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      rawText: text,
    };
  }
}

function getServerMessage(body) {
  if (!body) {
    return "Sin cuerpo de respuesta";
  }

  if (typeof body === "string") {
    return body;
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  return JSON.stringify(body);
}

async function postSubmission(config, accessToken, payload) {
  const response = await fetch(getIngestUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseResponseBody(response);

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
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

async function submitPendingFile(config, filename) {
  assertSubmitConfig(config);
  assertAuthConfig(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");
  await assertDirExists(config.eventsSentDirAbs, "sent");
  await assertDirExists(config.eventsFailedDirAbs, "failed");

  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);

  if (!(await pathExists(sourcePath))) {
    return {
      action: "missing",
      ok: false,
      filename: safeName,
      message: `No existe en pending: ${sourcePath}`,
    };
  }

  const result = await readEventFile(config.eventsPendingDirAbs, safeName);

  if (!result.ok) {
    const reason = `Evento local inválido: ${result.errors.join("; ")}`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return {
      action: "failed",
      ok: false,
      filename: safeName,
      message: reason,
      movedTo: finalPath,
    };
  }

  let storedSession;

  try {
    storedSession = await getValidStoredSession(config);
  } catch (error) {
    return {
      action: "auth_required",
      ok: false,
      filename: safeName,
      message: error.message,
    };
  }

  const payload = submissionPayload.buildSubmissionPayload(config, result.event, storedSession);

  let serverResult;

  try {
    serverResult = await postSubmission(
      config,
      storedSession.session.access_token,
      payload
    );
  } catch (error) {
    return {
      action: "network_error",
      ok: false,
      filename: safeName,
      message: `Error de red o servidor no accesible: ${error.message}`,
    };
  }

  const { status, body } = serverResult;

  if (submissionPayload.responseLooksOk(status, body) || submissionPayload.responseLooksDuplicate(status, body)) {
    const finalPath = await movePendingToSent(config, safeName);

    return {
      action: submissionPayload.responseLooksDuplicate(status, body) ? "duplicate_sent" : "sent",
      ok: true,
      filename: safeName,
      status,
      body,
      duplicateKey: payload.duplicateKey,
      movedTo: finalPath,
    };
  }

  if (status === 401) {
    return {
      action: "auth_required",
      ok: false,
      filename: safeName,
      status,
      body,
      message: `401 no autorizado. Haz login de nuevo o revisa que el endpoint acepte Bearer token. Respuesta: ${getServerMessage(body)}`,
    };
  }

  const shouldMoveToFailed = status === 400 || status === 403 || status === 409;

  if (shouldMoveToFailed) {
    const reason = `HTTP ${status}: ${getServerMessage(body)}`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return {
      action: "failed",
      ok: false,
      filename: safeName,
      status,
      body,
      message: reason,
      movedTo: finalPath,
    };
  }

  return {
    action: "pending",
    ok: false,
    filename: safeName,
    status,
    body,
    message: `HTTP ${status}: ${getServerMessage(body)}. Se deja en pending para revisar/reintentar.`,
  };
}

function printSubmitResult(result) {
  console.log("");

  if (result.ok) {
    console.log(`[OK] ${result.filename}`);

    if (result.action === "duplicate_sent") {
      console.log("El servidor indicó duplicado. Lo trato como éxito lógico.");
    } else {
      console.log("Submission enviada correctamente.");
    }

    if (result.status) {
      console.log(`HTTP: ${result.status}`);
    }

    if (result.duplicateKey) {
      console.log(`duplicateKey: ${result.duplicateKey}`);
    }

    if (result.movedTo) {
      console.log(`Movido a: ${result.movedTo}`);
    }

    if (result.body) {
      console.log("Respuesta:");
      console.log(JSON.stringify(result.body, null, 2));
    }

    console.log("");
    return;
  }

  console.log(`[ERROR] ${result.filename}`);
  console.log(result.message || "Error desconocido");

  if (result.status) {
    console.log(`HTTP: ${result.status}`);
  }

  if (result.movedTo) {
    console.log(`Movido a: ${result.movedTo}`);
  }

  if (result.body) {
    console.log("Respuesta:");
    console.log(JSON.stringify(result.body, null, 2));
  }

  console.log("");
}

async function submitOne(config, filename) {
  printHeader(config);

  if (!filename) {
    console.error("Uso: node app.js submit <archivo.json>");
    process.exitCode = 1;
    return;
  }

  const result = await submitPendingFile(config, filename);
  printSubmitResult(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function submitAll(config) {
  printHeader(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");

  const files = await listJsonFiles(config.eventsPendingDirAbs);

  if (files.length === 0) {
    console.log("No hay eventos pendientes para enviar.");
    console.log("");
    return;
  }

  console.log(`Eventos pendientes: ${files.length}`);
  console.log(`Endpoint: ${getIngestUrl(config)}`);
  console.log(`Week: ${config.defaultWeekId}`);
  console.log("");

  let sent = 0;
  let failed = 0;
  let pending = 0;

  for (const filename of files) {
    const result = await submitPendingFile(config, filename);
    printSubmitResult(result);

    if (result.ok) {
      sent += 1;
    } else if (result.action === "network_error" || result.action === "auth_required" || result.action === "pending") {
      pending += 1;
    } else {
      failed += 1;
    }

    if (result.action === "auth_required") {
      console.log("Se detiene submit-all porque falta autenticación válida.");
      break;
    }
  }

  console.log("Resumen submit-all");
  console.log("==================");
  console.log(`Enviados/sent: ${sent}`);
  console.log(`Fallidos/failed: ${failed}`);
  console.log(`Siguen pending: ${pending}`);
  console.log("");

  if (failed > 0 || pending > 0) {
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log("");
  console.log("High Score League Local App");
  console.log("");
  console.log("Comandos de eventos:");
  console.log("  node app.js scan [pending|sent|failed]");
  console.log("  node app.js show <archivo.json> [pending|sent|failed]");
  console.log("  node app.js watch");
  console.log("  node app.js mark-sent <archivo.json>");
  console.log("  node app.js mark-failed <archivo.json> [motivo]");
  console.log("  node app.js restore <sent|failed> <archivo.json>");
  console.log("  node app.js submit <archivo.json>");
  console.log("  node app.js submit-all");
  console.log("");
  console.log("Comandos de autenticación:");
  console.log("  node app.js login [email]");
  console.log("  node app.js auth-status");
  console.log("  node app.js auth-token");
  console.log("  node app.js logout");
  console.log("");
}

async function main() {
  const config = loadConfig();
  const command = process.argv[2] || "scan";

  if (command === "scan") {
    await scanBox(config, process.argv[3] || "pending");
    return;
  }

  if (command === "show") {
    await showOne(config, process.argv[3], process.argv[4] || "pending");
    return;
  }

  if (command === "watch") {
    await watchPending(config);
    return;
  }

  if (command === "mark-sent") {
    await markSent(config, process.argv[3]);
    return;
  }

  if (command === "mark-failed") {
    const reason = process.argv.slice(4).join(" ");
    await markFailed(config, process.argv[3], reason);
    return;
  }

  if (command === "restore") {
    await restoreToPending(config, process.argv[3], process.argv[4]);
    return;
  }

  if (command === "login") {
    await login(config, process.argv[3]);
    return;
  }

  if (command === "auth-status") {
    await authStatus(config);
    return;
  }

  if (command === "auth-token") {
    await authToken(config);
    return;
  }

  if (command === "logout") {
    await logout(config);
    return;
  }

  if (command === "submit") {
    await submitOne(config, process.argv[3]);
    return;
  }

  if (command === "submit-all") {
    await submitAll(config);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  console.error(`Comando desconocido: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("");
  console.error("Error fatal:");
  console.error(error.message || error);
  console.error("");
  process.exitCode = 1;
});
