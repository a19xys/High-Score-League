export const COPY = {
  actions: {
    diagnose: "Diagnóstico",
    logout: "Cerrar sesión",
    play: "Jugar competición",
    practice: "Practicar",
    refresh: "Actualizar estado",
    submit: "Subir pendientes",
    syncPlugin: "Sincronizar plugin",
  },
  launcherSubtitle: "Tu compañero local para jugar la liga.",
};

export function formatCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function getPackLabel(bridge) {
  if (bridge?.devBridge) {
    return "Pack de desarrollo cargado";
  }

  if (bridge?.packLoaded) {
    return "Pack cargado correctamente";
  }

  return "Configuración local preparada";
}

export function getReadyLabel(data) {
  if (!data) {
    return "Leyendo estado local";
  }

  if (!data.session?.hasSession) {
    return "Puedes jugar; conecta tu cuenta para subir puntuaciones.";
  }

  if (data.queue?.totals?.pending > 0) {
    return "Listo para competir, con puntuaciones guardadas por subir.";
  }

  return "Listo para competir";
}

export function getQueueSummary(queue) {
  const pending = queue?.totals?.pending || 0;

  if (pending === 0) {
    return "No hay puntuaciones pendientes.";
  }

  return `${formatCount(pending, "puntuación pendiente", "puntuaciones pendientes")} guardadas localmente.`;
}
