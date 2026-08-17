const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_CONFIG_SCHEMA_VERSION = 1;

function decodeJwtPayload(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function validatePublicSupabaseKey(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Falta supabasePublishableKey en la configuracion publica de producto.");
  }

  const key = value.trim();
  if (/^sb_secret_/i.test(key) || /service[_-]?role/i.test(key)) {
    throw new Error("La configuracion publica no puede contener una Supabase secret/service_role key.");
  }

  const jwt = decodeJwtPayload(key);
  if (jwt && jwt.role !== "anon") {
    throw new Error(`La clave JWT publica de Supabase debe tener role=anon, no ${jwt.role || "sin role"}.`);
  }

  if (!/^sb_publishable_/i.test(key) && !jwt) {
    throw new Error("supabasePublishableKey debe ser sb_publishable_... o un JWT legacy con role=anon.");
  }

  return key;
}

function normalizeHttpOrigin(value, label) {
  try {
    const url = new URL(String(value || ""));
    if (url.origin === "null" || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`${label} debe ser un origen HTTP(S) valido.`);
  }
}

function validateProductPublicConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La configuracion publica de producto debe ser un objeto.");
  }

  if (value.schemaVersion !== PRODUCT_CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion de configuracion publica debe ser ${PRODUCT_CONFIG_SCHEMA_VERSION}.`);
  }

  const hslOrigin = normalizeHttpOrigin(value.hslOrigin, "hslOrigin");
  const supabaseUrl = normalizeHttpOrigin(value.supabaseUrl, "supabaseUrl");
  if (!/\.supabase\.co$/i.test(new URL(supabaseUrl).hostname)) {
    throw new Error("supabaseUrl debe apuntar a un proyecto publico de Supabase.");
  }

  return Object.freeze({
    schemaVersion: PRODUCT_CONFIG_SCHEMA_VERSION,
    hslOrigin,
    supabaseUrl,
    supabasePublishableKey: validatePublicSupabaseKey(value.supabasePublishableKey || value.supabaseAnonKey),
  });
}

function readProductPublicConfig(configPath, options = {}) {
  const resolvedPath = path.resolve(configPath);
  try {
    return validateProductPublicConfig(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT" && options.required !== true) return null;
    throw new Error(`Configuracion publica de producto invalida (${resolvedPath}): ${error.message}`);
  }
}

module.exports = {
  PRODUCT_CONFIG_SCHEMA_VERSION,
  readProductPublicConfig,
  validateProductPublicConfig,
  validatePublicSupabaseKey,
};
