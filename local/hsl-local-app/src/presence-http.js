const { executeRemoteRequest } = require("./remote-request");

function parseBody(text) {
  try { return JSON.parse(text || "{}"); }
  catch { return null; }
}

async function requestLauncherPresence(options = {}) {
  const origin = String(options.webBaseUrl || "").replace(/\/$/, "");
  if (!origin || !options.accessToken) return { failureType: "configuration", ok: false };
  const result = await executeRemoteRequest({
    fetchImpl: options.fetchImpl,
    init: {
      body: JSON.stringify(options.payload),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
      method: options.method || "POST",
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs || 10_000,
    url: `${origin}/api/launcher/presence`,
  });
  if (!result.ok) return result;
  const body = parseBody(result.bodyText);
  const status = Number(result.httpStatus);
  return status >= 200 && status < 300 && body?.ok === true
    ? { body, httpStatus: status, ok: true }
    : {
        body,
        failureType: status === 401 || status === 403 ? "auth" : status >= 500 ? "server" : "domain",
        httpStatus: status,
        ok: false,
        response: result.response,
      };
}

module.exports = { requestLauncherPresence };

