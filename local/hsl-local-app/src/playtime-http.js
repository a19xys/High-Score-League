const { executeRemoteRequest } = require("./remote-request");

function parseBody(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

function retryAfterMs(response, now = Date.now()) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function postPlayTimeEvent(options = {}) {
  const origin = String(options.webBaseUrl || "").replace(/\/$/, "");
  if (!origin || !options.accessToken) {
    return { failureType: "configuration", ok: false, terminal: false };
  }
  const result = await executeRemoteRequest({
    fetchImpl: options.fetchImpl,
    init: {
      body: JSON.stringify(options.event),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs || 15000,
    url: `${origin}/api/launcher/playtime/ingest`,
  });
  if (!result.ok) return { ...result, terminal: false };
  const body = parseBody(result.bodyText);
  const status = Number(result.httpStatus);
  if (status >= 200 && status < 300 && body?.ok === true) {
    return { body, duplicate: body.duplicate === true, httpStatus: status, ok: true, terminal: false };
  }
  const retryable = status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
  return {
    body,
    failureType: status === 429 ? "throttled" : status >= 500 ? "server" : status === 401 || status === 403 ? "auth" : "domain",
    httpStatus: status,
    ok: false,
    retryAfterMs: retryAfterMs(result.response),
    terminal: !retryable,
  };
}

module.exports = { postPlayTimeEvent, retryAfterMs };
