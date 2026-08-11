const {
  isCanonicalSessionResult,
  isSessionRemoteUsableNow,
  requiresSessionLogin,
} = require("./session-result");

async function executeCanonicalAuthenticatedRequest(options = {}) {
  const resolveSession = options.resolveSession;
  const execute = options.execute;
  if (typeof resolveSession !== "function" || typeof execute !== "function") {
    throw new TypeError("resolveSession y execute son obligatorios.");
  }

  let sessionResult = options.sessionResult;
  if (sessionResult === undefined) {
    try {
      sessionResult = await resolveSession({ force: false });
    } catch (error) {
      sessionResult = error?.sessionResult || null;
      return { error, sessionResult, status: requiresSessionLogin(sessionResult) ? "requires-login" : "deferred" };
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!isCanonicalSessionResult(sessionResult)) {
      return { sessionResult, status: "deferred", reason: "invalid-session-result" };
    }
    if (requiresSessionLogin(sessionResult)) {
      return { sessionResult, status: "requires-login" };
    }
    if (!isSessionRemoteUsableNow(sessionResult, options.remoteUsableOptions || {})) {
      return { sessionResult, status: "deferred", reason: sessionResult.reason || sessionResult.status };
    }

    const accessToken = sessionResult.storedSession?.session?.access_token;
    if (!accessToken) {
      return { sessionResult, status: "deferred", reason: "remote-credential-missing" };
    }

    const requestResult = await execute({ accessToken, attempt, sessionResult });
    if (requestResult?.response?.status !== 401) {
      return { attempt, requestResult, sessionResult, status: "response" };
    }
    if (attempt === 1) {
      return {
        attempt,
        requestResult,
        sessionResult,
        status: "credential-rejected",
        reason: "second-401-after-canonical-refresh",
      };
    }

    try {
      sessionResult = await resolveSession({ force: true, previousResult: sessionResult });
    } catch (error) {
      sessionResult = error?.sessionResult || null;
      return { error, sessionResult, status: requiresSessionLogin(sessionResult) ? "requires-login" : "deferred" };
    }
  }

  return { sessionResult, status: "deferred", reason: "unreachable" };
}

module.exports = {
  executeCanonicalAuthenticatedRequest,
};
