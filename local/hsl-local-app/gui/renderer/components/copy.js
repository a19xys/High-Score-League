export const COPY = {
  actions: {
    diagnose: "Diagnóstico",
    logout: "Cerrar sesión",
    openPack: "Abrir pack",
    play: "Jugar",
    practice: "Practicar",
    refresh: "Actualizar estado",
    submit: "Subir pendientes",
    syncPlugin: "Sincronizar plugin",
  },
  launcherSubtitle: "Tu compañero para jugar la liga.",
};

export function formatCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function getPackLabel(bridge) {
  if (bridge?.packOpened) {
    return "Pack cargado";
  }

  if (bridge?.devBridge) {
    return "Pack de desarrollo cargado";
  }

  if (bridge?.packLoaded) {
    return "Pack cargado";
  }

  return "Configuración local preparada";
}

export function getReadyLabel(data) {
  if (!data) {
    return "Leyendo estado local";
  }

  if (!data.session?.hasSession) {
    return "Inicia sesión para competir; puedes practicar sin cuenta.";
  }

  if (data.queue?.totals?.pending > 0) {
    return "Hay puntuaciones guardadas por subir.";
  }

  return "Todo listo para jugar.";
}

export function getQueueSummary(queue) {
  const pending = queue?.totals?.pending || 0;

  if (pending === 0) {
    return "No hay puntuaciones pendientes.";
  }

  return `${formatCount(pending, "puntuación pendiente", "puntuaciones pendientes")} guardadas localmente.`;
}
