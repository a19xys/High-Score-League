const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { atomicWriteJson } = require("./secure-session-storage");

const CLIENT_ID_RELATIVE_PATH = path.join("presence", "client-id.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getPresenceClientIdPath(config = {}) {
  if (!config.userDataDir) throw new Error("config.userDataDir es obligatorio para Presence.");
  return path.join(config.userDataDir, CLIENT_ID_RELATIVE_PATH);
}

async function getOrCreatePresenceClientId(config = {}, options = {}) {
  const filePath = getPresenceClientIdPath(config);
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (parsed?.schemaVersion === 1 && UUID_PATTERN.test(parsed.clientId || "")) {
      return parsed.clientId;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") options.logger?.warn?.("presence-client-id", { reason: "invalid-client-id-file" });
  }

  const clientId = (options.randomUUID || crypto.randomUUID)();
  await atomicWriteJson(filePath, { schemaVersion: 1, clientId });
  return clientId;
}

module.exports = {
  CLIENT_ID_RELATIVE_PATH,
  getOrCreatePresenceClientId,
  getPresenceClientIdPath,
};

