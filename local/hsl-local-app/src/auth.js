const fsp = require("fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { pathExists } = require("./file-utils");
const { printHeader } = require("./output");

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

  await fsp.mkdir(path.dirname(config.sessionFileAbs), { recursive: true });
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

async function getAuthStateLegacy(config) {
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
    const storedSession = await getValidStoredSession(config);

    return toSafeSessionState(storedSession, {
      message: "Sesión local activa.",
      sessionFile: config.sessionFileAbs,
      status: "ok",
    });
  } catch (error) {
    const missing = /No hay sesión guardada/i.test(error.message);

    return {
      email: null,
      hasSession: false,
      message: missing
        ? "No hay sesión guardada."
        : "La sesión ha caducado. Inicia sesión de nuevo.",
      sessionFile: config.sessionFileAbs,
      status: missing ? "missing" : "expired",
      userId: null,
    };
  }
}

async function getAuthState(config, options = {}) {
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
    let storedSession = await readSession(config);

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
  } catch {
    return {
      email: null,
      hasSession: false,
      message: "La sesión ha caducado. Inicia sesión de nuevo.",
      sessionFile: config.sessionFileAbs,
      status: "expired",
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
