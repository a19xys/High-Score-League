const RENDERER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-elem 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' file:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function createSecureWebPreferences({ developerToolsEnabled, preload }) {
  return {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    devTools: developerToolsEnabled === true,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    preload,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  };
}

function isAllowedRendererNavigation(targetUrl, expectedDocumentUrl, documentLoaded = false) {
  return documentLoaded !== true && targetUrl === expectedDocumentUrl;
}

function deniedWindowOpenResponse() {
  return { action: "deny" };
}

function denyPermissionCheck() {
  return false;
}

function denyPermissionRequest(_webContents, _permission, callback) {
  callback(false);
}

function navigationProtocol(targetUrl) {
  try {
    return new URL(String(targetUrl || "")).protocol || "invalid:";
  } catch {
    return "invalid:";
  }
}

function securityConsoleCategory(message) {
  const value = String(message || "");
  if (/Electron Security Warning/i.test(value)) return "electron-security-warning";
  if (/Content Security Policy|Refused to/i.test(value)) return "csp-violation";
  return null;
}

function installRendererSecurity(webContents, options = {}) {
  const expectedDocumentUrl = options.expectedDocumentUrl;
  const logger = options.logger || console;
  const logBlocked = options.developerToolsEnabled === true;
  let documentLoaded = false;

  webContents.once("did-finish-load", () => {
    documentLoaded = true;
  });
  webContents.setWindowOpenHandler(deniedWindowOpenResponse);

  const blockUnexpectedNavigation = (event, legacyUrl) => {
    const targetUrl = event?.url || legacyUrl || "";
    if (isAllowedRendererNavigation(targetUrl, expectedDocumentUrl, documentLoaded)) return;
    event.preventDefault();
    if (logBlocked) logger.warn(`[renderer-security] navegacion bloqueada (${navigationProtocol(targetUrl)})`);
  };

  webContents.on("will-navigate", blockUnexpectedNavigation);
  webContents.on("will-redirect", blockUnexpectedNavigation);
  webContents.on("will-attach-webview", (event) => event.preventDefault());
  if (logBlocked) {
    webContents.on("console-message", (event, _level, legacyMessage) => {
      const category = securityConsoleCategory(event?.message || legacyMessage);
      if (category) logger.warn(`[renderer-security] mensaje de consola (${category})`);
    });
  }

  webContents.session.setPermissionCheckHandler(denyPermissionCheck);
  webContents.session.setPermissionRequestHandler(denyPermissionRequest);
}

function getRendererSecuritySummary() {
  return {
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
  };
}

module.exports = {
  RENDERER_CSP,
  createSecureWebPreferences,
  deniedWindowOpenResponse,
  denyPermissionCheck,
  denyPermissionRequest,
  getRendererSecuritySummary,
  installRendererSecurity,
  isAllowedRendererNavigation,
  navigationProtocol,
  securityConsoleCategory,
};
