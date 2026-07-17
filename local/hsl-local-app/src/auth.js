const readline = require("node:readline/promises");
const path = require("node:path");
const { stdin: input, stdout: output } = require("node:process");
const {
  clearActiveAccount,
  readKnownAccounts,
  removeKnownAccount,
} = require("./account-store");
const { createAccountSessionRepository } = require("./account-session-repository");
const { printHeader } = require("./output");

const repositories = new Map();
const migrationPromises = new WeakMap();

function loadSupabaseSdk() {
  try {
    return require("@supabase/supabase-js");
  } catch {
    throw new Error("No encuentro @supabase/supabase-js. Ejecuta: npm install @supabase/supabase-js");
  }
}

function assertAuthConfig(config) {
  if (!config.supabaseUrl || typeof config.supabaseUrl !== "string") throw new Error("config.json debe incluir supabaseUrl");
  if (!config.supabaseAnonKey || typeof config.supabaseAnonKey !== "string") throw new Error("config.json debe incluir supabaseAnonKey");
  if (config.supabaseAnonKey.toLowerCase().includes("service_role")) throw new Error("No uses service_role en la app local. Usa la anon key.");
}

function createSupabaseClient(config) {
  assertAuthConfig(config);
  const { createClient } = loadSupabaseSdk();
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function promptForValue(label, fallbackValue) {
  if (fallbackValue) return fallbackValue;
  const rl = readline.createInterface({ input, output });
  try { return (await rl.question(label)).trim(); } finally { rl.close(); }
}

function isSessionExpiringSoon(storedSession) {
  const expiresAt = storedSession?.session?.expires_at;
  if (!expiresAt) return true;
  return expiresAt <= Math.floor(Date.now() / 1000) + 60;
}

function maskToken(token) {
  if (!token || typeof token !== "string") return "sin token";
  if (token.length <= 16) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function classifySessionRefreshError(error) {
  if (error?.code === "SESSION_IDENTITY_MISMATCH") return { status: "revoked", reason: "identity-mismatch", transient: false };
  if (error?.code === "SESSION_STORAGE_CORRUPT") return { status: "corrupt", reason: "corrupt-storage", transient: false };
  const status = Number(error?.status || error?.cause?.status) || null;
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const conclusive = [400, 401, 403].includes(status) &&
    /refresh|invalid.grant|session.*(missing|not found|revoked)|token.*(invalid|revoked|already used)/.test(`${code} ${message}`);
  if (conclusive) return { status: "revoked", reason: "refresh-token-rejected", transient: false };
  return { status: "temporary-failure", reason: status === 429 ? "rate-limited" : status && status >= 500 ? "provider-unavailable" : "transport", transient: true };
}

async function requestProviderRefresh(config, refreshToken, signal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason || "cancelled");
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("refresh-timeout"), 15000);
  try {
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      body: JSON.stringify({ refresh_token: refreshToken }),
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error("El proveedor rechazo la renovacion."), {
        code: body.error_code || body.error || `HTTP_${response.status}`,
        status: response.status,
      });
    }
    const { user, ...session } = body;
    return { session, user };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function refreshProviderSession({ config, signal, storedSession, supabaseClient }) {
  const refreshToken = storedSession?.session?.refresh_token;
  if (!refreshToken) {
    throw Object.assign(new Error("No hay refresh_token guardado."), { code: "MISSING_REFRESH_TOKEN", sessionStatus: "revoked", transient: false });
  }
  let data;
  let error;
  try {
    if (supabaseClient) ({ data, error } = await supabaseClient.auth.refreshSession({ refresh_token: refreshToken }));
    else data = await requestProviderRefresh(config, refreshToken, signal);
  } catch (requestError) {
    error = requestError;
  }
  if (error) {
    const classification = classifySessionRefreshError(error);
    throw Object.assign(new Error("No se pudo renovar la sesion."), {
      cause: error,
      code: classification.reason,
      sessionStatus: classification.status,
      transient: classification.transient,
    });
  }
  if (!data?.session) {
    throw Object.assign(new Error("El proveedor no devolvio una nueva sesion."), {
      code: "missing-refresh-response",
      sessionStatus: "temporary-failure",
      transient: true,
    });
  }
  const expectedUserId = storedSession?.user?.id;
  const returnedUserId = data.user?.id || expectedUserId;
  if (!expectedUserId || returnedUserId !== expectedUserId) {
    throw Object.assign(new Error("La identidad renovada no coincide con la cuenta."), {
      code: "SESSION_IDENTITY_MISMATCH",
      sessionStatus: "revoked",
      transient: false,
    });
  }
  return {
    schemaVersion: 1,
    session: data.session,
    supabaseUrl: config.supabaseUrl,
    user: data.user || storedSession.user,
  };
}

function repositoryKey(config) {
  return `${config.userDataDir || ""}\n${config.supabaseUrl || ""}`;
}

function sessionConfig(config) {
  return config.userDataDir ? config : {
    ...config,
    userDataDir: config.sessionFileAbs ? path.dirname(config.sessionFileAbs) : null,
  };
}

function getAccountSessionRepository(config, options = {}) {
  if (options.repository) return options.repository;
  const canonicalConfig = sessionConfig(config);
  const key = repositoryKey(canonicalConfig);
  if (!repositories.has(key)) {
    repositories.set(key, createAccountSessionRepository({
      config: canonicalConfig,
      isExpiringSoon: isSessionExpiringSoon,
      refreshProvider: refreshProviderSession,
    }));
  }
  return repositories.get(key);
}

function ensureMigration(repository) {
  if (!migrationPromises.has(repository)) {
    migrationPromises.set(repository, repository.migrateLegacy().catch((error) => ({ error, status: "recovery-required" })));
  }
  return migrationPromises.get(repository);
}

async function activeIdentity(config) {
  const accounts = await readKnownAccounts(sessionConfig(config));
  return accounts.lastActiveUserId || null;
}

async function readSession(config, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const userId = options.userId || await activeIdentity(config);
  if (!userId) return null;
  return (await repository.read(userId)).storedSession || null;
}

async function saveSession(config, session, user, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  return repository.saveLogin({
    schemaVersion: 1,
    session,
    supabaseUrl: config.supabaseUrl,
    user,
  }, { setActive: options.setActive !== false });
}

async function deleteSession(config, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const userId = options.userId || await activeIdentity(config);
  if (!userId) return { removed: false };
  const result = await repository.remove(userId, { reason: options.reason || "logout" });
  await clearActiveAccount(sessionConfig(config));
  return result;
}

async function refreshStoredSession(config, storedSession, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const userId = storedSession?.user?.id;
  if (!userId) throw Object.assign(new Error("La sesion no contiene userId."), { code: "SESSION_IDENTITY_MISSING" });
  const result = await repository.refresh(userId, {
    connected: options.connected !== false,
    force: true,
    supabaseClient: options.supabaseClient,
  });
  if (!result.storedSession) {
    const error = result.error || new Error(result.status === "revoked" ? "La sesion requiere login." : "La renovacion se ha aplazado.");
    error.sessionStatus ||= result.status;
    throw error;
  }
  return result.storedSession;
}

async function getValidStoredSession(config, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const userId = options.userId || await activeIdentity(config);
  if (!userId) throw new Error("No hay sesion guardada. Ejecuta: node app.js login");
  const result = await repository.resolve(userId, {
    connected: options.connected !== false,
    deferRemote: options.deferRemote === true,
    supabaseClient: options.supabaseClient,
  });
  if (!result.storedSession) {
    const error = result.error || new Error(result.status === "revoked" ? "Esta sesion requiere iniciar sesion de nuevo." : "No hay sesion canonica valida.");
    error.sessionStatus ||= result.status;
    throw error;
  }
  return result.storedSession;
}

async function resolveCanonicalSession(config, options = {}) {
  return getValidStoredSession(config, options);
}

function redactValues(text, values = []) {
  let safeText = String(text || "");
  for (const value of values) if (value && typeof value === "string") safeText = safeText.split(value).join("[redactado]");
  return safeText;
}

function toSafeSessionState(storedSession, overrides = {}) {
  return {
    email: storedSession?.user?.email || overrides.email || null,
    expiresAt: storedSession?.session?.expires_at || null,
    hasSession: Boolean(storedSession),
    message: overrides.message || "Sesion local activa.",
    sessionRevision: Number(storedSession?.sessionRevision) || Number(overrides.sessionRevision) || 0,
    status: overrides.status || "ok",
    userId: storedSession?.user?.id || overrides.userId || null,
  };
}

async function getAuthState(config, options = {}) {
  try { assertAuthConfig(config); } catch {
    return { email: null, hasSession: false, message: "La autenticacion local no esta configurada.", sessionRevision: 0, status: "not_configured", userId: null };
  }
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const userId = await activeIdentity(config);
  if (!userId) return { email: null, hasSession: false, message: "No hay sesion guardada.", sessionRevision: 0, status: "missing", userId: null };
  const result = await repository.resolve(userId, {
    connected: options.connected !== false,
    deferRemote: options.deferRemote === true,
    supabaseClient: options.supabaseClient,
  });
  if (result.storedSession) {
    return toSafeSessionState(result.storedSession, {
      message: result.status.startsWith("deferred") ? "La sesion se renovara cuando vuelva la conexion." : "Sesion local activa.",
      sessionRevision: result.sessionRevision,
      status: result.status.startsWith("deferred") ? "deferred-offline" : "ok",
    });
  }
  return {
    email: null,
    hasSession: false,
    message: result.status === "revoked" ? "Esta sesion requiere iniciar sesion de nuevo." : "No se pudo leer la sesion local.",
    sessionRevision: Number(result.sessionRevision) || 0,
    status: result.status || "corrupt",
    userId: null,
  };
}

async function signInWithPassword(config, credentials = {}, options = {}) {
  const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!email || !password) return { message: "Email y contrasena son obligatorios.", ok: false, status: "invalid_input" };
  try { assertAuthConfig(config); } catch {
    return { message: "La autenticacion local no esta configurada.", ok: false, status: "not_configured" };
  }
  const supabase = options.supabaseClient || createSupabaseClient(config);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { message: "No he podido iniciar sesion. Revisa email y contrasena.", ok: false, status: "auth_failed", technicalMessage: redactValues(error.message, [password]) };
  if (!data?.session || !data?.user?.id) return { message: "Login realizado, pero Supabase no devolvio sesion valida.", ok: false, status: "missing_session" };
  const repository = getAccountSessionRepository(config, options);
  await ensureMigration(repository);
  const saved = await repository.saveLogin({ schemaVersion: 1, session: data.session, supabaseUrl: config.supabaseUrl, user: data.user });
  return {
    message: "Login correcto.",
    ok: true,
    session: toSafeSessionState(saved.storedSession, { sessionRevision: saved.sessionRevision, status: "ok" }),
    status: "ok",
  };
}

async function logoutLocal(config, options = {}) {
  await deleteSession(config, options);
  return {
    message: "Sesion cerrada.",
    ok: true,
    session: { email: null, hasSession: false, message: "No hay sesion guardada.", sessionRevision: 0, status: "missing", userId: null },
  };
}

async function login(config, emailArg) {
  printHeader(config);
  const email = emailArg || process.env.HSL_EMAIL || await promptForValue("Email: ", null);
  const password = process.env.HSL_PASSWORD || await promptForValue("Password (visible en consola): ", null);
  const result = await signInWithPassword(config, { email, password });
  if (!result.ok) { console.error(result.message); process.exitCode = 1; return; }
  console.log("Login correcto.");
  console.log(`Usuario: ${result.session.email || result.session.userId}`);
  console.log(`Revision de sesion: ${result.session.sessionRevision}`);
  console.log("");
}

async function authStatus(config) {
  printHeader(config);
  const state = await getAuthState(config);
  if (!state.hasSession) { console.log("No autenticado."); console.log(state.message); console.log(""); return; }
  console.log("Autenticado.");
  console.log(`Usuario: ${state.email || state.userId}`);
  console.log(`User ID: ${state.userId}`);
  console.log(`Session revision: ${state.sessionRevision}`);
  console.log(`Expires at: ${state.expiresAt || "desconocido"}`);
  console.log("");
}

async function logout(config) {
  printHeader(config);
  const userId = await activeIdentity(config);
  if (userId) {
    const repository = getAccountSessionRepository(config);
    await ensureMigration(repository);
    await repository.remove(userId, { reason: "cli-logout" });
    await removeKnownAccount(sessionConfig(config), userId, { deleteSession: false });
  } else {
    await clearActiveAccount(sessionConfig(config));
  }
  console.log("Sesion local eliminada; las colas permanecen intactas.");
  console.log("");
}

module.exports = {
  assertAuthConfig,
  authStatus,
  createSupabaseClient,
  deleteSession,
  getAccountSessionRepository,
  getAuthState,
  getValidStoredSession,
  isSessionExpiringSoon,
  login,
  logout,
  logoutLocal,
  maskToken,
  readSession,
  resolveCanonicalSession,
  refreshProviderSession,
  refreshStoredSession,
  saveSession,
  signInWithPassword,
  toSafeSessionState,
};
