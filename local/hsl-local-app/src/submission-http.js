function assertSubmitConfig(config) {
  if (!config.webBaseUrl || typeof config.webBaseUrl !== "string") {
    throw new Error("config.json debe incluir webBaseUrl");
  }

  if (!config.defaultWeekId || typeof config.defaultWeekId !== "string") {
    throw new Error("config.json debe incluir defaultWeekId");
  }
}

function normalizeWebBaseUrl(webBaseUrl) {
  return String(webBaseUrl || "").replace(/\/+$/, "");
}

function getIngestUrl(config) {
  return `${normalizeWebBaseUrl(config.webBaseUrl)}/api/submissions/ingest`;
}

async function parseResponseBody(response) {
  const text = await response.text();

  return parseResponseText(text);
}

function parseResponseText(text) {

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      rawText: text,
    };
  }
}

async function postSubmission(config, accessToken, payload, options = {}) {
  const requestResult = await executeRemoteRequest({
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    url: getIngestUrl(config),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  });

  if (!requestResult.ok) return requestResult;

  const body = parseResponseText(requestResult.bodyText);

  return {
    body,
    ok: true,
    responseOk: requestResult.response.ok,
    retryAfterHeader: requestResult.response.headers?.get?.("retry-after") || null,
    status: requestResult.httpStatus,
  };
}

module.exports = {
  assertSubmitConfig,
  getIngestUrl,
  normalizeWebBaseUrl,
  parseResponseBody,
  parseResponseText,
  postSubmission,
};
const { executeRemoteRequest } = require("./remote-request");
