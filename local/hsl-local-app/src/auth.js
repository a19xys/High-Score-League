const readline = require("node:readline/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { stdin: input, stdout: output } = require("node:process");
const {
  clearActiveAccount,
  readKnownAccounts,
} = require("./account-store");
const { createAccountSessionRepository } = require("./account-session-repository");
const { printHeader } = require("./output");
const { executeRemoteRequest } = require("./remote-request");
const {
  createSessionResult,
  isSessionLocallyAvailable,
  isSessionRemoteUsable,
  requiresSessionLogin,
} = require("./session-result");
const { normalizeProviderUrl } = require("./session-refresh-policy");
const { parseResponseText } = require("./submission-http");
const { parseRetryAfter } = require("./submission-outcome");

const repositories = new Map();
const migrationPromises = new WeakMap();
const migratedRepositories = new WeakSet();

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
  const code = String(error?.providerCode || error?.code || error?.cause?.code || "").toLowerCase();
  const conclusiveCodes = new Set([
    "invalid_grant",
    "invalid_refresh_token",
    "refresh_token_already_used",
    "refresh_token_not_found",
    "refresh_token_revoked",
  ]);
  const conclusive = [400, 401, 403].includes(status) && conclusiveCodes.has(code);
  if (conclusive) return { status: "revoked", reason: "refresh-token-rejected", transient: false };
  const cancelled = error?.failureType === "cancelled" || error?.name === "AbortError";
  return {
    status: "temporary-failure",
    reason: cancelled ? "cancelled" : status === 429 ? "rate-limited" : status && status >= 500 ? "provider-unavailable" : error?.failureType === "timeout" ? "timeout" : "transport",
    transient: true,
  };
}

async function requestProviderRefresh(config, refreshToken, signal, options = {}) {
  const origin = normalizeProviderUrl(config.supabaseUrl);
  if (!origin) throw Object.assign(new Error("El proveedor de autenticacion no es valido."), { code: "PROVIDER_URL_INVALID" });
  const request = await executeRemoteRequest({
    fetchImpl: options.fetchImpl,
    init: {
      body: JSON.stringify({ refresh_token: refreshToken }),
      headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
      method: "POST",
    },
    signal,
    timeoutMs: options.timeoutMs,
    url: `${origin}/auth/v1/token?grant_type=refresh_token`,
  });
  if (!request.ok) {
    throw Object.assign(new Error("No se pudo completar la renovacion."), {
      code: request.reason || "REFRESH_TRANSPORT_FAILURE",
      failureType: request.failureType,
      refreshReason: request.reason,
      transient: true,
    });
  }
  const body = parseResponseText(request.bodyText);
  if (!request.response.ok) {
    const providerCode = typeof body?.error_code === "string" ? body.error_code
      : typeof body?.code === "string" ? body.code
      : typeof body?.error === "string" ? body.error
      : null;
    throw Object.assign(new Error("El proveedor rechazo la renovacion."), {
      code: providerCode || `HTTP_${request.httpStatus}`,
      providerCode,
      retryAfterMs: parseRetryAfter(request.response.headers?.get?.("retry-after"), { nowMs: options.nowMs }),
      status: request.httpStatus,
    });
  }
  if (!body || body.rawText || typeof body !== "object") {
    throw Object.assign(new Error("El proveedor devolvio una respuesta de renovacion no valida."), {
      code: "REFRESH_RESPONSE_INVALID",
      status: request.httpStatus,
      transient: true,
    });
  }
  const { user, ...session } = body;
  return { session, user };
}

function awaitRefreshOperation(operation, signal, timeoutMs = 15000) {
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
  let timer;
  let abortListener;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("La renovacion excedio su deadline."), {
      code: "REFRESH_TIMEOUT",
      failureType: "timeout",
      transient: true,
    })), deadlineMs);
  });
  const cancellation = new Promise((_, reject) => {
    if (!signal) return;
    abortListener = () => reject(Object.assign(new Error("La renovacion fue cancelada."), {
      code: "REFRESH_CANCELLED",
      failureType: "cancelled",
      name: "AbortError",
      transient: true,
    }));
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });
  return Promise.race([Promise.resolve(operation), deadline, cancellation]).finally(() => {
    clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  });
}

async function refreshProviderSession({ config, fetchImpl, signal, storedSession, supabaseClient, timeoutMs }) {
  const refreshToken = storedSession?.session?.refresh_token;
  if (!refreshToken) {
    throw Object.assign(new Error("No hay refresh_token guardado."), { code: "MISSING_REFRESH_TOKEN", sessionStatus: "revoked", transient: false });
  }
  let data;
  let error;
  try {
    if (supabaseClient) ({ data, error } = await awaitRefreshOperation(
      supabaseClient.auth.refreshSession({ refresh_token: refreshToken }),
      signal,
      timeoutMs,
    ));
    else data = await requestProviderRefresh(config, refreshToken, signal, { fetchImpl, timeoutMs });
  } catch (requestError) {
    error = requestError;
  }
  if (error) {
    const classification = classifySessionRefreshError(error);
    throw Object.assign(new Error("No se pudo renovar la sesion."), {
      cause: error,
      code: classification.reason,
      refreshReason: classification.reason,
      retryAfterMs: error?.retryAfterMs,
      sessionStatus: classification.status,
      status: error?.status,
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
  const returnedUserId = data.user?.id || null;
  if (!data.user?.id) {
    throw Object.assign(new Error("El proveedor no devolvio la identidad renovada."), {
      code: "REFRESH_IDENTITY_MISSING",
      sessionStatus: "temporary-failure",
      transient: true,
    });
  }
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
    user: data.user,
  };
}

function repositoryKey(config) {
  const anonKeyFingerprint = crypto.createHash("sha256")
    .update(String(config.supabaseAnonKey || "missing-anon-key"))
    .digest("hex")
    .slice(0, 16);
  return `${path.resolve(config.userDataDir || ".")}\n${normalizeProviderUrl(config.supabaseUrl) || "invalid-provider"}\nkey_${anonKeyFingerprint}`;
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
  if (migratedRepositories.has(repository)) return Promise.resolve({ cached: true, status: "completed" });
  const existing = migrationPromises.get(repository);
  if (existing) return existing;
  const operation = repository.migrateLegacy()
    .catch((error) => ({ error, status: "recovery-required" }))
    .then((result) => {
      if (result?.status === "completed") migratedRepositories.add(repository);
      return result;
    })
    .finally(() => {
      if (migrationPromises.get(repository) === operation) migrationPromises.delete(repository);
    });
  migrationPromises.set(repository, operation);
  return operation;
}

async function activeIdentity(config) {
  const accounts = await readKnownAccounts(sessionConfig(config));
  return accounts.lastActiveUserId || null;
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
  if (!userId) {
    await clearActiveAccount(sessionConfig(config));
    return { removed: false };
  }
  const result = await repository.remove(userId, {
    forgetAccount: options.forgetAccount === true,
    reason: options.reason || "logout",
  });
  if (options.forgetAccount !== true) await clearActiveAccount(sessionConfig(config));
  return result;
}

async function resolveCanonicalSessionResult(config, options = {}) {
  const repository = getAccountSessionRepository(config, options);
  const migration = await ensureMigration(repository);
  const userId = options.userId || await activeIdentity(config);
  if (migration?.status === "cancelled") {
    return createSessionResult({ status: "cancelled", reason: "migration-cancelled" });
  }
  if (migration?.status === "recovery-required" || migration?.error) {
    const current = userId ? await repository.read(userId).catch(() => null) : null;
    return createSessionResult({
      error: migration.error,
      hasLocalSession: current?.hasLocalSession === true,
      migrationRequired: true,
      reason: "migration-recovery-required",
      sessionRevision: current?.sessionRevision || 0,
      status: "recovery-required",
      storedSession: current?.storedSession || null,
    });
  }
  if (!userId) return createSessionResult({ status: "missing", reason: "no-active-account" });
  return repository.resolve(userId, {
    connected: options.connected !== false,
    deferRemote: options.deferRemote === true,
    fetchImpl: options.fetchImpl,
    force: options.force === true,
    signal: options.signal,
    supabaseClient: options.supabaseClient,
    timeoutMs: options.timeoutMs,
  });
}

async function requireRemoteUsableSession(config, options = {}) {
  const sessionResult = await resolveCanonicalSessionResult(config, options);
  if (isSessionRemoteUsable(sessionResult)) return sessionResult;
  const error = Object.assign(new Error(
    sessionResult.requiresLogin
      ? "Esta sesion requiere iniciar sesion de nuevo."
      : "La credencial remota no esta disponible temporalmente."
  ), {
    code: sessionResult.requiresLogin ? "SESSION_LOGIN_REQUIRED" : "SESSION_REMOTE_DEFERRED",
    sessionResult,
    sessionStatus: sessionResult.status,
  });
  throw error;
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
    remoteUsable: overrides.remoteUsable === true,
    requiresLogin: overrides.requiresLogin === true,
    sessionRevision: Number(storedSession?.sessionRevision) || Number(overrides.sessionRevision) || 0,
    status: overrides.status || "ok",
    userId: storedSession?.user?.id || overrides.userId || null,
  };
}

async function getAuthState(config, options = {}) {
  try { assertAuthConfig(config); } catch {
    return { email: null, hasSession: false, message: "La autenticacion local no esta configurada.", sessionRevision: 0, status: "not_configured", userId: null };
  }
  const sessionResult = await resolveCanonicalSessionResult(config, options);
  if (isSessionLocallyAvailable(sessionResult) && sessionResult.storedSession) {
    const remoteUsable = isSessionRemoteUsable(sessionResult);
    return toSafeSessionState(sessionResult.storedSession, {
      message: sessionResult.requiresLogin
        ? "Esta sesion requiere iniciar sesion de nuevo."
        : remoteUsable
          ? "Sesion local activa."
          : "La sesion se conserva y su renovacion esta aplazada.",
      remoteUsable,
      requiresLogin: requiresSessionLogin(sessionResult),
      sessionRevision: sessionResult.sessionRevision,
      status: ["valid", "refreshed"].includes(sessionResult.status) ? "ok" : sessionResult.status,
    });
  }
  return {
    email: null,
    hasSession: isSessionLocallyAvailable(sessionResult),
    message: sessionResult.requiresLogin
      ? "Esta sesion requiere iniciar sesion de nuevo."
      : sessionResult.status === "missing"
        ? "No hay sesion guardada."
        : "La sesion local no esta disponible temporalmente.",
    remoteUsable: false,
    requiresLogin: requiresSessionLogin(sessionResult),
    sessionRevision: sessionResult.sessionRevision,
    status: sessionResult.status,
    userId: options.userId || null,
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
  const removed = await deleteSession(config, options);
  return {
    message: "Sesion cerrada.",
    ok: true,
    session: { email: null, hasSession: false, message: "No hay sesion guardada.", remoteUsable: false, requiresLogin: false, sessionRevision: removed.sessionRevision || 0, status: "missing", userId: null },
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
    await repository.remove(userId, { forgetAccount: true, reason: "cli-logout" });
  } else {
    await clearActiveAccount(sessionConfig(config));
  }
  console.log("Sesion local eliminada; las colas permanecen intactas.");
  console.log("");
}

async function shutdownAccountSessionRepositories(options = {}) {
  const repositoriesToClose = [...new Set(repositories.values())];
  return Promise.all(repositoriesToClose.map((repository) => repository.shutdown(options)));
}

module.exports = {
  assertAuthConfig,
  authStatus,
  createSupabaseClient,
  classifySessionRefreshError,
  deleteSession,
  getAccountSessionRepository,
  getAuthState,
  isSessionExpiringSoon,
  login,
  logout,
  logoutLocal,
  maskToken,
  requestProviderRefresh,
  requireRemoteUsableSession,
  resolveCanonicalSessionResult,
  refreshProviderSession,
  saveSession,
  shutdownAccountSessionRepositories,
  signInWithPassword,
  toSafeSessionState,
};
