export const LOGIN_CREDENTIALS_ERROR = "El email o la contraseña no son correctos. Inténtalo de nuevo.";
export const LOGIN_PERSISTENCE_ERROR = "La cuenta se ha autenticado, pero High Score League no ha podido guardar la sesión en este dispositivo. Inténtalo de nuevo; si continúa, abre Diagnóstico.";
export const LOGIN_UNEXPECTED_ERROR = "No se pudo completar el inicio de sesión. Inténtalo de nuevo; si continúa, abre Diagnóstico.";

const PUBLIC_STATUSES = new Set(["invalid_input", "missing_session", "not_configured"]);

export function presentLoginResult(response = {}) {
  if (response.ok === true) return { authError: null, summary: "Login correcto." };
  if (response.status === "auth_failed") {
    return { authError: LOGIN_CREDENTIALS_ERROR, summary: LOGIN_CREDENTIALS_ERROR };
  }
  if (response.status === "session_persistence_failed") {
    return { authError: LOGIN_PERSISTENCE_ERROR, summary: LOGIN_PERSISTENCE_ERROR };
  }
  if (PUBLIC_STATUSES.has(response.status) && typeof response.summary === "string" && response.summary.trim()) {
    return { authError: response.summary, summary: response.summary };
  }
  return presentUnexpectedLoginFailure();
}

export function presentUnexpectedLoginFailure() {
  return { authError: LOGIN_UNEXPECTED_ERROR, summary: LOGIN_UNEXPECTED_ERROR };
}
