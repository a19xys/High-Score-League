const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function fakeForm() {
  const ownerDocument = { activeElement: null };
  const fields = {};
  for (const name of ["email", "password"]) {
    fields[name] = {
      name,
      ownerDocument,
      selectionDirection: "none",
      selectionEnd: 0,
      selectionStart: 0,
      value: "",
      focus() { ownerDocument.activeElement = this; },
      setSelectionRange(start, end, direction) {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
      },
    };
  }
  return {
    elements: { namedItem: (name) => fields[name] || null },
    fields,
    ownerDocument,
  };
}

async function draftApi() {
  const file = path.join(__dirname, "..", "gui", "renderer", "login-draft.js");
  return import(pathToFileURL(file).href);
}

test("ephemeral login draft preserves email, password, focus and selection across replacement", async () => {
  const { createEphemeralLoginDraft } = await draftApi();
  const draft = createEphemeralLoginDraft();
  const first = fakeForm();
  first.fields.email.value = "player@example.com";
  first.fields.password.value = "temporary-secret";
  first.fields.password.focus();
  first.fields.password.setSelectionRange(2, 8, "forward");
  draft.capture(first);

  const replacement = fakeForm();
  draft.restore(replacement);
  assert.equal(replacement.fields.email.value, "player@example.com");
  assert.equal(replacement.fields.password.value, "temporary-secret");
  assert.equal(replacement.ownerDocument.activeElement, replacement.fields.password);
  assert.deepEqual([
    replacement.fields.password.selectionStart,
    replacement.fields.password.selectionEnd,
    replacement.fields.password.selectionDirection,
  ], [2, 8, "forward"]);
});

test("clear removes both fields and seed never seeds a password", async () => {
  const { createEphemeralLoginDraft } = await draftApi();
  const draft = createEphemeralLoginDraft();
  const form = fakeForm();
  form.fields.email.value = "player@example.com";
  form.fields.password.value = "temporary-secret";
  draft.capture(form);
  draft.clear();
  const cleared = fakeForm();
  draft.restore(cleared);
  assert.equal(cleared.fields.email.value, "");
  assert.equal(cleared.fields.password.value, "");

  draft.seed("remembered@example.com");
  const seeded = fakeForm();
  draft.restore(seeded);
  assert.equal(seeded.fields.email.value, "remembered@example.com");
  assert.equal(seeded.fields.password.value, "");
});

test("credentials leave the draft only through explicit take", async () => {
  const { createEphemeralLoginDraft } = await draftApi();
  const draft = createEphemeralLoginDraft();
  const form = fakeForm();
  form.fields.email.value = " player@example.com ";
  form.fields.password.value = "temporary-secret";
  assert.deepEqual(draft.take(form), { email: "player@example.com", password: "temporary-secret" });
  assert.equal(form.fields.password.value, "");

  const replacement = fakeForm();
  draft.restore(replacement);
  assert.equal(replacement.fields.email.value, " player@example.com ");
  assert.equal(replacement.fields.password.value, "");
});

test("renderer keeps password outside store, persistence, snapshots and logs", async () => {
  const rendererRoot = path.join(__dirname, "..", "gui", "renderer");
  const [app, draft] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "login-draft.js"), "utf8"),
  ]);
  const storeInitialization = app.slice(app.indexOf("const store = createStore"), app.indexOf("let accountMenuPointerStartedInside"));
  assert.doesNotMatch(storeInitialization, /password/i);
  assert.doesNotMatch(draft, /localStorage|sessionStorage|setState|hslLauncher|ipc|console\./);
  assert.match(app, /loginDraft\.take\(form\)/);
  assert.match(app, /window\.hslLauncher\.login\(email, password\)/);
  assert.match(app, /function cleanupRendererLifecycle\(\) \{\s*loginDraft\.clear\(\)/);
  assert.match(app, /authError: presentation\.authError[\s\S]*authFormOpen: !response\.ok/);
  assert.match(app, /presentUnexpectedLoginFailure\(\)[\s\S]*authError: presentation\.authError/);
  assert.doesNotMatch(app, /appendLog\([^)]*password|details:\s*\[[^\]]*password/);
});
