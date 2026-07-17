const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const {
  RENDERER_CSP,
  createSecureWebPreferences,
  deniedWindowOpenResponse,
  denyPermissionCheck,
  denyPermissionRequest,
  getRendererSecuritySummary,
  installRendererSecurity,
  isAllowedRendererNavigation,
  securityConsoleCategory,
} = require("../gui/security-policy");

const appRoot = path.join(__dirname, "..");
const rendererRoot = path.join(appRoot, "gui", "renderer");
const indexPath = path.join(rendererRoot, "index.html");

async function rendererCodeFiles() {
  const files = [];
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if ([".html", ".js"].includes(path.extname(entry.name))) files.push(target);
    }
  }
  await visit(rendererRoot);
  return files;
}

function runThemeBootstrap(storedTheme, { storageError = false } = {}) {
  const documentElement = {
    classList: { values: [], add(value) { this.values.push(value); } },
    dataset: {},
    style: {},
  };
  const context = {
    document: { documentElement },
    localStorage: {
      getItem() {
        if (storageError) throw new Error("storage unavailable");
        return storedTheme;
      },
    },
    window: {},
  };
  return fsp.readFile(path.join(rendererRoot, "theme-bootstrap.js"), "utf8").then((source) => {
    vm.runInNewContext(source, context);
    return { context, documentElement };
  });
}

test("index delivers one restrictive CSP before every renderer resource", async () => {
  const html = await fsp.readFile(indexPath, "utf8");
  const policies = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/gi)];
  assert.equal(policies.length, 1);
  assert.equal(policies[0][1], RENDERER_CSP);
  assert.ok(policies[0].index < html.search(/<(?:script|link)\b/i));

  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ]) assert.ok(RENDERER_CSP.includes(directive));

  assert.doesNotMatch(RENDERER_CSP, /unsafe-eval|script-src[^;]*unsafe-inline|\*|https?:|wss?:|blob:|data:/);
  assert.match(RENDERER_CSP, /style-src 'self';/);
  assert.match(RENDERER_CSP, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /<script src="\.\/theme-bootstrap\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
});

test("renderer executable sources contain no inline handlers or direct network primitives", async () => {
  const forbidden = [
    /\s(?:onclick|onload|onerror|onsubmit|onchange|oninput|onfocus|onblur|onkeydown|onkeyup|onpointer[a-z]*)\s*=/i,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /\bjavascript:/i,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\s*\(/,
    /\b(?:Shared)?Worker\s*\(/,
    /\bimport\s*\(\s*["']https?:/i,
    /<script[^>]+src=["']https?:/i,
  ];
  for (const file of await rendererCodeFiles()) {
    const source = await fsp.readFile(file, "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${path.relative(rendererRoot, file)} matched ${pattern}`);
  }
});

test("renderer CSS uses only local fonts and no remote imports", async () => {
  const styles = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  const css = styles.join("\n");
  assert.doesNotMatch(css, /@import|https?:|data:|blob:/i);
  assert.match(css, /\.\.\/assets\/fonts\/manrope\/Manrope-Regular\.woff2/);
  assert.match(css, /\.\.\/assets\/fonts\/sora\/Sora-Regular\.woff2/);
});

test("theme bootstrap preserves light, dark and fallback behavior", async () => {
  for (const [stored, expected, storageError] of [
    ["light", "light", false],
    ["dark", "dark", false],
    ["sepia", "dark", false],
    [null, "dark", false],
    [null, "dark", true],
  ]) {
    const { context, documentElement } = await runThemeBootstrap(stored, { storageError });
    assert.equal(documentElement.dataset.theme, expected);
    assert.equal(documentElement.style.colorScheme, expected);
    assert.deepEqual(documentElement.classList.values, ["theme-bootstrap"]);
    assert.equal(context.window.__HSL_INITIAL_THEME__, expected);
  }
});

test("BrowserWindow preferences make every relevant security default explicit", () => {
  const preload = path.join(appRoot, "gui", "preload.js");
  assert.deepEqual(createSecureWebPreferences({ developerToolsEnabled: false, preload }), {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    devTools: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    preload,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  });
  assert.equal(createSecureWebPreferences({ developerToolsEnabled: true, preload }).devTools, true);
});

test("navigation, windows and permissions are denied by pure policy", () => {
  const expected = "file:///launcher/renderer/index.html";
  assert.equal(isAllowedRendererNavigation(expected, expected, false), true);
  for (const target of [
    "https://high-score-league.vercel.app",
    "http://localhost:3000",
    "file:///launcher/renderer/other.html",
    "javascript:alert(1)",
    "data:text/html,test",
  ]) assert.equal(isAllowedRendererNavigation(target, expected, false), false);
  assert.equal(isAllowedRendererNavigation(expected, expected, true), false);
  assert.deepEqual(deniedWindowOpenResponse(), { action: "deny" });
  assert.equal(denyPermissionCheck(), false);
  let permissionGranted = true;
  denyPermissionRequest(null, "media", (granted) => { permissionGranted = granted; });
  assert.equal(permissionGranted, false);
});

test("security installer wires all Electron boundaries without opening URLs", () => {
  const listeners = new Map();
  let windowOpenHandler = null;
  let permissionCheck = null;
  let permissionRequest = null;
  const webContents = {
    on(name, listener) { listeners.set(name, listener); },
    once(name, listener) { listeners.set(name, listener); },
    session: {
      setPermissionCheckHandler(handler) { permissionCheck = handler; },
      setPermissionRequestHandler(handler) { permissionRequest = handler; },
    },
    setWindowOpenHandler(handler) { windowOpenHandler = handler; },
  };
  const expected = "file:///launcher/renderer/index.html";
  installRendererSecurity(webContents, { expectedDocumentUrl: expected });

  assert.deepEqual(windowOpenHandler({ url: "https://example.test" }), { action: "deny" });
  assert.equal(permissionCheck(), false);
  let granted = true;
  permissionRequest(null, "notifications", (value) => { granted = value; });
  assert.equal(granted, false);
  for (const eventName of ["will-navigate", "will-redirect", "will-attach-webview"]) assert.ok(listeners.has(eventName));

  let blocked = false;
  listeners.get("will-navigate")({ preventDefault() { blocked = true; }, url: "https://example.test" });
  assert.equal(blocked, true);
  listeners.get("did-finish-load")();
  blocked = false;
  listeners.get("will-navigate")({ preventDefault() { blocked = true; }, url: expected });
  assert.equal(blocked, true);
});

test("development console diagnostics classify security messages without retaining details", () => {
  assert.equal(securityConsoleCategory("Electron Security Warning (Insecure Content-Security-Policy)"), "electron-security-warning");
  assert.equal(securityConsoleCategory("Refused to load the script because of Content Security Policy"), "csp-violation");
  assert.equal(securityConsoleCategory("ordinary renderer log"), null);

  const listeners = new Map();
  const warnings = [];
  const webContents = {
    on(name, listener) { listeners.set(name, listener); },
    once(name, listener) { listeners.set(name, listener); },
    session: {
      setPermissionCheckHandler() {},
      setPermissionRequestHandler() {},
    },
    setWindowOpenHandler() {},
  };
  installRendererSecurity(webContents, {
    developerToolsEnabled: true,
    expectedDocumentUrl: "file:///launcher/renderer/index.html",
    logger: { warn(message) { warnings.push(message); } },
  });
  listeners.get("console-message")({ message: "Refused to load https://secret.example/token" });
  assert.deepEqual(warnings, ["[renderer-security] mensaje de consola (csp-violation)"]);
});

test("security diagnostics expose policy facts without paths or secrets", () => {
  assert.deepEqual(getRendererSecuritySummary(), {
    browserSandbox: true,
    contextIsolation: true,
    defaultSource: "none",
    delivery: "meta",
    documentProtocol: "file:",
    evalAllowed: false,
    localPackImagesAllowed: true,
    navigationRestricted: true,
    newWindowsDenied: true,
    nodeIntegration: false,
    permissionsDenied: true,
    rendererConnectAllowed: false,
    scriptInlineAllowed: false,
    scriptSource: "self",
    styleAttributeException: true,
    webSecurity: true,
  });
});

test("main keeps loadFile and preload remains a narrow contextBridge", async () => {
  const [main, preload] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "preload.js"), "utf8"),
  ]);
  assert.match(main, /mainWindow\.loadFile\(rendererDocumentPath\)/);
  assert.match(main, /installRendererSecurity\(mainWindow\.webContents/);
  assert.doesNotMatch(main, /disable-web-security|allow-file-access-from-files|allow-universal-access-from-files|bypassCSP|ELECTRON_DISABLE_SECURITY_WARNINGS/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("hslLauncher"/);
  assert.doesNotMatch(preload, /ipcRenderer\s*:|require\s*:|process\s*:|filesystem\s*:|shell\s*:/);
});
