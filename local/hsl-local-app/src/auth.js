const fsp = require("fs/promises");
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

module.exports = {
  assertAuthConfig,
  authStatus,
  authToken,
  createSupabaseClient,
  deleteSession,
  getValidStoredSession,
  isSessionExpiringSoon,
  login,
  logout,
  maskToken,
  readSession,
  refreshStoredSession,
  saveSession,
};
