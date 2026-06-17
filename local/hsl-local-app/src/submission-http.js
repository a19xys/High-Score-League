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

function getServerMessage(body) {
  if (!body) {
    return "Sin cuerpo de respuesta";
  }

  if (typeof body === "string") {
    return body;
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  return JSON.stringify(body);
}

async function postSubmission(config, accessToken, payload) {
  const response = await fetch(getIngestUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseResponseBody(response);

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

module.exports = {
  assertSubmitConfig,
  getIngestUrl,
  getServerMessage,
  normalizeWebBaseUrl,
  parseResponseBody,
  postSubmission,
};
