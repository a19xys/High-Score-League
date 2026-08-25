const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function presentationApi() {
  const file = path.join(__dirname, "..", "gui", "renderer", "login-presentation.js");
  return import(pathToFileURL(file).href);
}

test("login presentation reserves the credentials copy for auth_failed", async () => {
  const { LOGIN_CREDENTIALS_ERROR, presentLoginResult } = await presentationApi();
  const presentation = presentLoginResult({ ok: false, status: "auth_failed" });

  assert.equal(presentation.authError, LOGIN_CREDENTIALS_ERROR);
  assert.equal(presentation.summary, LOGIN_CREDENTIALS_ERROR);
});

test("login presentation explains local persistence without blaming credentials", async () => {
  const { presentLoginResult } = await presentationApi();
  const presentation = presentLoginResult({
    ok: false,
    status: "session_persistence_failed",
    summary: "raw summary must not replace the product copy",
  });

  assert.match(presentation.authError, /autenticado/i);
  assert.match(presentation.authError, /guardar la sesión/i);
  assert.doesNotMatch(presentation.authError, /email o la contraseña no son correctos/i);
  assert.equal(presentation.summary, presentation.authError);
});

test("unexpected IPC login failure uses a generic presentation", async () => {
  const { presentUnexpectedLoginFailure } = await presentationApi();
  const presentation = presentUnexpectedLoginFailure();

  assert.match(presentation.authError, /No se pudo completar el inicio de sesión/i);
  assert.doesNotMatch(presentation.authError, /email o la contraseña no son correctos/i);
  assert.equal(presentation.summary, presentation.authError);
});

test("login log presentation keeps success and every classified failure distinct", async () => {
  const { presentLoginResult } = await presentationApi();

  assert.equal(presentLoginResult({ ok: true, status: "ok" }).summary, "Login correcto.");
  assert.match(presentLoginResult({ ok: false, status: "auth_failed" }).summary, /email o la contraseña/i);
  assert.match(presentLoginResult({ ok: false, status: "session_persistence_failed" }).summary, /guardar la sesión/i);
  assert.match(presentLoginResult({ ok: false, status: "unknown" }).summary, /No se pudo completar el inicio de sesión/i);
});
