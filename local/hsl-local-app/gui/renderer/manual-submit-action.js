export function deriveManualSubmitAction(state = {}) {
  const data = state.data || {};
  const pending = data.queue?.pending || {};
  const pendingCount = Number(pending.count ?? data.queue?.totals?.pending) || 0;
  const validPendingCount = Number(pending.validCount) || 0;
  const result = { enabled: false, pendingCount, reason: null, validPendingCount };
  if (state.connectivity?.reachability !== "connected") return { ...result, reason: "Necesitas conexion para subir las puntuaciones." };
  if (!data.session?.hasSession) return { ...result, reason: "Inicia sesion para subir las puntuaciones." };
  if (!data.scope) return { ...result, reason: "Selecciona un pack con una cola valida." };
  if (state.busy || data.autoSync?.status === "syncing") return { ...result, reason: "Las puntuaciones se estan subiendo." };
  if (pendingCount === 0) return { ...result, reason: "No hay puntuaciones pendientes en este pack." };
  if (validPendingCount === 0) return { ...result, reason: "Esta puntuacion necesita atencion antes de reintentarse." };
  if (data.membership?.canSubmit === false || data.readiness?.canSubmit === false) {
    return { ...result, reason: data.membership?.message || data.readiness?.message || "La temporada no permite enviar esta puntuacion." };
  }
  return { ...result, enabled: true, reason: "Subir puntuaciones pendientes de este pack." };
}
