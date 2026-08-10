const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, nativeImage } = require("electron");
const { RENDERER_CSP, createSecureWebPreferences } = require("../gui/security-policy");

const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hsl-alpha-canvas-probe-"));
const profileDirectory = path.join(fixtureDirectory, "profile");
fs.mkdirSync(profileDirectory);
app.setPath("userData", profileDirectory);
app.commandLine.appendSwitch("disable-gpu");

function bitmap({ transparent = false } = {}) {
  const size = 8;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const opaque = !transparent || (x >= 2 && x <= 5 && y >= 2 && y <= 5);
      pixels[offset] = 0x24;
      pixels[offset + 1] = 0x88;
      pixels[offset + 2] = 0xee;
      pixels[offset + 3] = opaque ? 0xff : 0x00;
    }
  }
  return nativeImage.createFromBitmap(pixels, { height: size, scaleFactor: 1, width: size });
}

function writeFixtures() {
  const opaque = bitmap();
  fs.writeFileSync(path.join(fixtureDirectory, "opaque.png"), opaque.toPNG());
  fs.writeFileSync(path.join(fixtureDirectory, "opaque.jpg"), opaque.toJPEG(90));
  fs.writeFileSync(path.join(fixtureDirectory, "transparent.png"), bitmap({ transparent: true }).toPNG());
  fs.writeFileSync(path.join(fixtureDirectory, "transparent.svg"), [
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">',
    '<rect x="2" y="2" width="4" height="4" fill="#ee8824"/>',
    "</svg>",
  ].join(""));

  const sources = {
    jpeg: pathToFileURL(path.join(fixtureDirectory, "opaque.jpg")).href,
    opaquePng: pathToFileURL(path.join(fixtureDirectory, "opaque.png")).href,
    transparentPng: pathToFileURL(path.join(fixtureDirectory, "transparent.png")).href,
    transparentSvg: pathToFileURL(path.join(fixtureDirectory, "transparent.svg")).href,
  };
  fs.writeFileSync(path.join(fixtureDirectory, "probe.js"), `
    const sources = ${JSON.stringify(sources)};
    const read = (name, src) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 8;
          canvas.height = 8;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(image, 0, 0, 8, 8);
          const pixels = context.getImageData(0, 0, 8, 8).data;
          let translucent = 0;
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] < 255) translucent += 1;
          }
          resolve({ error: null, height: image.naturalHeight, name, translucent, width: image.naturalWidth });
        } catch (error) {
          resolve({ error: error.name + ': ' + error.message, name });
        }
      };
      image.onerror = () => resolve({ error: 'ImageError', name });
      image.src = src;
    });
    Promise.all(Object.entries(sources).map(([name, src]) => read(name, src)))
      .then((results) => { window.__hslAlphaProbeResult = results; });
  `);
  fs.writeFileSync(path.join(fixtureDirectory, "probe.html"), [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}">`,
    '<meta charset="utf-8"><script src="./probe.js" defer></script>',
    "</head><body></body></html>",
  ].join(""));
}

app.whenReady().then(async () => {
  let window = null;
  try {
    writeFixtures();
    window = new BrowserWindow({
      show: false,
      webPreferences: createSecureWebPreferences({ developerToolsEnabled: false }),
    });
    await window.loadFile(path.join(fixtureDirectory, "probe.html"));
    const started = Date.now();
    let result = null;
    while (!result && Date.now() - started < 5_000) {
      result = await window.webContents.executeJavaScript("window.__hslAlphaProbeResult || null");
      if (!result) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!result) throw new Error("Canvas/file probe timed out");
    process.stdout.write(`${JSON.stringify({
      csp: RENDERER_CSP,
      preferences: createSecureWebPreferences({ developerToolsEnabled: false }),
      results: result,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(process.exitCode || 0);
  }
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});

app.on("window-all-closed", () => {});
