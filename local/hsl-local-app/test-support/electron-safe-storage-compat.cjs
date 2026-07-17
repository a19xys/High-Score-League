const { app, safeStorage } = require("electron");
const fs = require("node:fs");

const [mode, profileDir] = process.argv.slice(2);
if (profileDir) app.setPath("userData", profileDir);
app.disableHardwareAcceleration();

const input = fs.readFileSync(0, "utf8");
app.whenReady().then(async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage unavailable");
    const output = mode === "encrypt"
      ? safeStorage.encryptString(Buffer.from(input.trim(), "base64").toString("utf8")).toString("base64")
      : Buffer.from(safeStorage.decryptString(Buffer.from(input.trim(), "base64")), "utf8").toString("base64");
    process.stdout.write(output, () => app.quit());
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
