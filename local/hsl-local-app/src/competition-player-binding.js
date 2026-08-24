const crypto = require("node:crypto");

const PLAYER_BINDING_DOMAIN = "hsl-player-binding:v1|";

function deriveCompetitionPlayerBinding(userId) {
  if (typeof userId !== "string" || !userId || userId.length > 512 || /[\u0000-\u001f\u007f]/.test(userId)) {
    throw new Error("No se pudo derivar playerBinding: userId invalido.");
  }
  return crypto.createHash("sha256").update(`${PLAYER_BINDING_DOMAIN}${userId}`, "utf8").digest("hex");
}

module.exports = { PLAYER_BINDING_DOMAIN, deriveCompetitionPlayerBinding };
