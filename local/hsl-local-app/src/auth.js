const fsp = require("fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { pathExists } = require("./file-utils");
const { printHeader } = require("./output");
const { readStoredSession, writeStoredSession } = require("./secure-session-storage");

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
  const result = await readStoredSession(config.sessionFileAbs);
  return result.storedSession;
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

  await writeStoredSession(config.sessionFileAbs, data, { expectedUserId: user?.id || null });
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

function classifySessionRefreshError(error) {
  if (error?.code === "SESSION_IDENTITY_MISMATCH") return { status: "revoked", reason: "identity-mismatch", transient: false };
  if (error?.code === "SESSION_STORAGE_CORRUPT") return { status: "corrupt", reason: "corrupt-storage", transient: false };
  const status = Number(error?.status || error?.cause?.status) || null;
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const conclusive = [400, 401, 403].includes(status) &&
    /refresh|invalid.grant|session.*(missing|not found|revoked)|token.*(invalid|revoked|already used)/.test(`${code} ${message}`);
  if (conclusive) return { status: "revoked", reason: "refresh-token-rejected", transient: false };
  return { status: "temporary-failure", reason: status && status >= 500 ? "provider-unavailable" : "transport", transient: true };
}

async function refreshStoredSession(config, storedSession, options = {}) {
  const refreshToken = storedSession?.session?.refresh_token;

  if (!refreshToken) {
    throw Object.assign(new Error("No hay refresh_token guardado."), { code: "MISSING_REFRESH_TOKEN", sessionStatus: "revoked", transient: false });
  }

  const supabase = options.supabaseClient || createSupabaseClient(config);

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    const classification = classifySessionRefreshError(error);
    throw Object.assign(new Error("No se pudo renovar la sesión."), {
      cause: error,
      code: classification.reason,
      sessionStatus: classification.status,
      transient: classification.transient,
    });
  }

  if (!data.session) {
    throw Object.assign(new Error("El proveedor no devolvió una nueva sesión."), {
      code: "missing-refresh-response",
      sessionStatus: "temporary-failure",
      transient: true,
    });
  }

  const expectedUserId = storedSession?.user?.id || null;
  const returnedUserId = data.user?.id || expectedUserId;
  if (!expectedUserId || returnedUserId !== expectedUserId) {
    throw Object.assign(new Error("La identidad renovada no coincide con la cuenta."), {
      code: "SESSION_IDENTITY_MISMATCH",
      sessionStatus: "revoked",
      transient: false,
    });
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

function redactValues(text, values = []) {
  let safeText = String(text || "");

  for (const value of values) {
    if (!value || typeof value !== "string") {
      continue;
    }

    safeText = safeText.split(value).join("[redactado]");
  }

  return safeText;
}

function toSafeSessionState(storedSession, overrides = {}) {
  return {
    email: storedSession?.user?.email || overrides.email || null,
    expiresAt: storedSession?.session?.expires_at || null,
    hasSession: Boolean(storedSession),
    message: overrides.message || "Sesión local activa.",
    sessionFile: overrides.sessionFile || null,
    status: overrides.status || "ok",
    userId: storedSession?.user?.id || overrides.userId || null,
  };
}

async function getAuthState(config, options = {}) {
  let storedSession = null;
  try {
    assertAuthConfig(config);
  } catch {
    return {
      email: null,
      hasSession: false,
      message: "La autenticación local no está configurada.",
      sessionFile: config.sessionFileAbs,
      status: "not_configured",
      userId: null,
    };
  }

  try {
    storedSession = await readSession(config);

    if (!storedSession) {
      return {
        email: null,
        hasSession: false,
        message: "No hay sesión guardada.",
        sessionFile: config.sessionFileAbs,
        status: "missing",
        userId: null,
      };
    }

    if (isSessionExpiringSoon(storedSession) && options.deferRemote !== true) {
      storedSession = await refreshStoredSession(config, storedSession);
    }

    return toSafeSessionState(storedSession, {
      message: "Sesión local activa.",
      sessionFile: config.sessionFileAbs,
      status: "ok",
    });
  } catch (error) {
    const status = error?.sessionStatus || (error?.code === "SESSION_STORAGE_CORRUPT" ? "corrupt" : "temporary-failure");
    if (storedSession && (error?.transient === true || status === "temporary-failure")) {
      return toSafeSessionState(storedSession, {
        message: "La sesión se renovará cuando vuelva a estar disponible la conexión.",
        sessionFile: config.sessionFileAbs,
        status: "deferred-offline",
      });
    }
    return {
      email: null,
      hasSession: false,
      message: status === "revoked" ? "Esta sesión requiere iniciar sesión de nuevo." : "No se pudo leer la sesión local.",
      sessionFile: config.sessionFileAbs,
      status,
      userId: null,
    };
  }
}

async function signInWithPassword(config, credentials = {}, options = {}) {
  const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";

  if (!email || !password) {
    return {
      message: "Email y contraseña son obligatorios.",
      ok: false,
      status: "invalid_input",
    };
  }

  try {
    assertAuthConfig(config);
  } catch {
    return {
      message: "La autenticación local no está configurada.",
      ok: false,
      status: "not_configured",
    };
  }

  const supabase = options.supabaseClient || createSupabaseClient(config);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      message: "No he podido iniciar sesión. Revisa email y contraseña.",
      ok: false,
      status: "auth_failed",
      technicalMessage: redactValues(error.message, [password]),
    };
  }

  if (!data?.session) {
    return {
      message: "Login realizado, pero Supabase no devolvió sesión.",
      ok: false,
      status: "missing_session",
    };
  }

  await saveSession(config, data.session, data.user);
  const storedSession = await readSession(config);

  return {
    message: "Login correcto.",
    ok: true,
    session: toSafeSessionState(storedSession, {
      message: "Sesión local activa.",
      sessionFile: config.sessionFileAbs,
      status: "ok",
    }),
    status: "ok",
  };
}

async function logoutLocal(config) {
  await deleteSession(config);

  return {
    message: "Sesión cerrada.",
    ok: true,
    session: {
      email: null,
      hasSession: false,
      message: "No hay sesión guardada.",
      sessionFile: config.sessionFileAbs,
      status: "missing",
      userId: null,
    },
  };
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

module.exports = {
  assertAuthConfig,
  authStatus,
  authToken,
  createSupabaseClient,
  classifySessionRefreshError,
  deleteSession,
  getAuthState,
  getValidStoredSession,
  isSessionExpiringSoon,
  login,
  logout,
  logoutLocal,
  maskToken,
  readSession,
  refreshStoredSession,
  saveSession,
  signInWithPassword,
};
