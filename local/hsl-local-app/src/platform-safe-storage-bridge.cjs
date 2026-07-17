const fs = require("node:fs");
const { app, safeStorage } = require("electron");

const [mode, userDataDir] = process.argv.slice(2);
if (userDataDir) app.setPath("userData", userDataDir);
app.disableHardwareAcceleration();
const input = fs.readFileSync(0, "utf8").trim();

app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error("safeStorage unavailable"), { code: "SESSION_STORAGE_UNAVAILABLE" });
    const output = mode === "encrypt"
      ? safeStorage.encryptString(Buffer.from(input, "base64").toString("utf8")).toString("base64")
      : Buffer.from(safeStorage.decryptString(Buffer.from(input, "base64")), "utf8").toString("base64");
    process.stdout.write(output, () => app.quit());
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
