const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

test("status primitives pair color with icon and text", async () => {
  const { renderStatusBadge } = await import(pathToFileURL(path.join(rendererRoot, "components", "status-primitives.js")).href);
  const html = renderStatusBadge({
    description: "La puntuación sigue segura.",
    icon: "warning",
    severity: "warning",
    title: "Envío aplazado",
  });
  assert.match(html, /data-severity="warning"/);
  assert.match(html, /data-icon="warning"/);
  assert.match(html, /Envío aplazado/);
  assert.match(html, /La puntuación sigue segura/);
});

test("unavailable action has native disabled state and an accessible reason", async () => {
  const { renderAvailabilityButton, renderBlockingReasons } = await import(pathToFileURL(path.join(rendererRoot, "components", "status-primitives.js")).href);
  const action = {
    action: "play",
    available: false,
    icon: "play",
    label: "Jugar",
    reason: "Inicia sesión para competir.",
    reasonId: "action-block-play",
  };
  const html = `${renderAvailabilityButton(action)}${renderBlockingReasons([action])}`;
  assert.match(html, /disabled aria-disabled="true"/);
  assert.match(html, /aria-label="Jugar"/);
  assert.match(html, /aria-describedby="action-block-play"/);
  assert.match(html, /id="action-block-play"/);
  assert.match(html, /Inicia sesión para competir/);
});

test("connectivity refresh is a separate native keyboard action with visible focus support", async () => {
  const [header, styles] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  assert.match(header, /<button class="[^"]*connection-refresh-button" type="button" data-action="refresh-connectivity"/);
  assert.match(header, /title="\$\{escapeHtml\(actionTitle\)\}" aria-label="Comprobar conexión" aria-busy=/);
  assert.match(header, /disabled aria-disabled=/);
  assert.match(styles, /button:focus-visible[\s\S]*outline: 2px solid var\(--circuit\)/);
});

test("live region is focused and the app root is not live", async () => {
  const [index, app] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "index.html"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
  ]);
  assert.doesNotMatch(index, /id="app"[^>]*aria-live/);
  assert.match(app, /id="hsl-live-status"[\s\S]*aria-live="polite"/);
  assert.equal((`${index}\n${app}`.match(/id="hsl-live-status"/g) || []).length, 1);
  assert.match(app, /deriveLiveAnnouncement/);
});

test("login errors are associated with both fields", async () => {
  const header = await fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8");
  assert.match(header, /id="hsl-login-error" role="alert"/);
  assert.match(header, /aria-describedby=\\"hsl-login-error\\" aria-invalid=\\"true\\"/);
  assert.match(header, /loginAction\.reasonId/);
});

test("semantic tokens cover all severities and reduced motion remains enforced", async () => {
  const [tokens, styles] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  for (const severity of ["neutral", "info", "progress", "success", "warning", "error", "blocked"]) {
    assert.match(tokens, new RegExp(`--state-${severity}`));
  }
  assert.match(styles, /\.state-badge/);
  assert.match(styles, /\.state-notice/);
  assert.match(styles, /\.action-block-reason/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms/);
});

test("presentation layer has no side effects or raw secret-bearing copy", async () => {
  const presentation = await fsp.readFile(path.join(rendererRoot, "product-presentation.js"), "utf8");
  assert.doesNotMatch(presentation, /fetch\(|setState\(|localStorage|sessionStorage|writeFile|ipcRenderer|access_token|refresh_token|Authorization/);
  assert.doesNotMatch(presentation, /duplicatePaths|scopedQueueRoot|userId/);
});

test("living inventory records sources, deferrals and confirmation gaps", async () => {
  const docsRoot = path.join(__dirname, "..", "..", "docs");
  const [inventory, model] = await Promise.all([
    fsp.readFile(path.join(docsRoot, "launcher-visual-functional-inventory-3b3.md"), "utf8"),
    fsp.readFile(path.join(docsRoot, "launcher-product-state-presentation-3b3.md"), "utf8"),
  ]);
  for (const column of ["Requisito o idea", "Fuente", "Área", "Estado antes", "3B.3", "Aplazado", "Confirmación", "Dependencia", "Riesgo como parche"]) {
    assert.match(inventory, new RegExp(column.replace(".", "\\.")));
  }
  assert.match(inventory, /No recuperado|no recuperado/);
  assert.match(inventory, /Requiere confirmación/);
  assert.match(inventory, /Trabajo aplazado/);
  assert.match(model, /Extensión futura/);
  assert.match(model, /No\s+debe tocar gate de snapshots, autoridad remota, readiness/);
});
