import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import { deriveRemoteAvailability } from "../remote-availability.js";

function valueOrDash(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

function detailRow(label, value) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(valueOrDash(value))}</dd>
    </div>
  `;
}

function renderReadinessChecks(readiness) {
  if (!readiness?.checks?.length) {
    return "";
  }

  return `
    <div>
      <dt>Preparación del pack</dt>
      <dd>
        <ul class="readiness-check-list">
          ${readiness.checks.map((check) => `
            <li>
              <span class="check-level check-level--${escapeHtml(check.level)}">${escapeHtml(check.level)}</span>
              <strong>${escapeHtml(check.label)}</strong>
              <span>${escapeHtml(check.message)}</span>
              ${check.technicalDetails?.length
                ? `<small>${escapeHtml(check.technicalDetails.join(" | "))}</small>`
                : ""}
            </li>
          `).join("")}
        </ul>
      </dd>
    </div>
  `;
}

export function renderDevTools(state) {
  const data = state.data;
  const developerToolsEnabled = data?.developerToolsEnabled === true;
  const disabled = state.busy ? "disabled" : "";
  const syncDisabled = state.busy || !data?.bridge?.devBridge ? "disabled" : "";
  const metadataWarnings = data?.bridge?.packMetadataWarnings || data?.game?.metadataWarnings || [];
  const metadataLabel = metadataWarnings.length > 0
    ? metadataWarnings.join(" | ")
    : data?.bridge?.packMetadataLoaded
      ? "metadata.json cargado"
      : "sin metadata local";
  const membership = data?.membership;
  const autoSync = data?.autoSync;
  const readiness = data?.readiness;
  const library = data?.library;
  const runtime = data?.runtime;
  const runtimeConfigured = Boolean(runtime?.configured);
  const runtimeAvailable = Boolean(runtime?.available);
  const runtimeButtonLabel = runtimeConfigured ? "Cambiar MAME" : "Elegir mame.exe";
  const packDirectory = library?.directory || {};
  const packDirectoryConfigured = Boolean(packDirectory.path);
  const packDirectoryLabel = packDirectoryConfigured ? "Cambiar carpeta" : "Elegir carpeta";
  const libraryWarnings = [
    library?.error,
    ...(library?.warnings || []),
  ].filter(Boolean);
  const modeLabel = data?.bridge?.packOpened
    ? "pack abierto"
    : data?.bridge?.devBridge
      ? "modo desarrollo puente"
      : data?.bridge?.mode || "desconocido";
  const remoteAvailable = deriveRemoteAvailability(state.connectivity).available;
  const forceAccountSync = developerToolsEnabled
    ? `<button class="tool-button" type="button" data-action="force-account-sync" ${disabled || !remoteAvailable ? "disabled" : ""}>
        Forzar sincronizacion de cuentas elegibles
        <small>Solo desarrollo</small>
      </button>`
    : "";
  const forceRankingRefresh = developerToolsEnabled
    ? `<button class="tool-button" type="button" data-action="force-ranking-refresh" ${disabled || !remoteAvailable ? "disabled" : ""}>
        Forzar comprobacion de rankings
        <small>Solo desarrollo</small>
      </button>`
    : "";

  return `
    <section class="panel dev-tools">
      <div class="panel-heading compact">
        <div>
          <h2>Configuración y diagnóstico</h2>
          <p>Opciones técnicas separadas del flujo normal de juego.</p>
        </div>
      </div>
      <div class="dev-actions">
        <button class="tool-button" type="button" data-action="import-pack" ${disabled}>
          Importar pack
          <small>ZIP o carpeta</small>
        </button>
        <button class="tool-button" type="button" data-action="choose-pack-directory" ${disabled}>
          ${escapeHtml(packDirectoryLabel)}
          <small>Biblioteca de packs</small>
        </button>
        <button class="tool-button" type="button" data-action="rescan-pack-directory" ${disabled}>
          Reescanear biblioteca
          <small>${library?.totals?.packs || 0} packs detectados</small>
        </button>
        <button class="tool-button" type="button" data-action="open-pack-directory" ${disabled || !packDirectoryConfigured ? "disabled" : ""}>
          Abrir carpeta de packs
          <small>${packDirectory.exists ? "Carpeta disponible" : "Revisar carpeta"}</small>
        </button>
        <button class="tool-button" type="button" data-action="choose-shared-mame-runtime" ${disabled}>
          ${escapeHtml(runtimeButtonLabel)}
          <small>Runtime MAME compartido</small>
        </button>
        <button class="tool-button" type="button" data-action="open-shared-mame-runtime" ${disabled || !runtime?.mameExecutablePath ? "disabled" : ""}>
          Abrir carpeta MAME
          <small>${runtimeAvailable ? "mame.exe encontrado" : "Revisar ruta"}</small>
        </button>
        <button class="tool-button" type="button" data-action="diagnose" ${disabled}>
          Diagnosticar
        </button>
        <button class="tool-button" type="button" data-action="check-membership" ${disabled || !remoteAvailable ? "disabled" : ""}>
          Comprobar de nuevo
          <small>Temporada</small>
        </button>
        <button class="tool-button" type="button" data-action="open-membership-url" ${disabled || !membership?.joinUrl ? "disabled" : ""}>
          Abrir temporada
          <small>Web</small>
        </button>
        <button class="tool-button" type="button" data-action="sync-plugin" ${syncDisabled}>
          Sincronizar plugin
          <small>Legacy / deprecated</small>
        </button>
        ${forceAccountSync}
        ${forceRankingRefresh}
        <button class="tool-button" type="button" data-action="logout" ${disabled}>
          Cerrar sesión local
        </button>
      </div>
      <details class="technical-details">
        <summary>Detalles técnicos</summary>
        <dl>
          <div>
            <dt>Modo</dt>
            <dd>${escapeHtml(modeLabel)}</dd>
          </div>
          <div>
            <dt>Pack / MAME</dt>
            <dd>${escapeHtml(data?.bridge?.workingDir || data?.bridge?.packRoot || data?.bridge?.packPath || "sin ruta activa")}</dd>
          </div>
          <div>
            <dt>Metadata</dt>
            <dd>${escapeHtml(metadataLabel)}</dd>
          </div>
          ${detailRow("Directorio de packs", packDirectory.path)}
          ${detailRow("Directorio existe", packDirectory.exists === undefined ? null : String(Boolean(packDirectory.exists)))}
          ${detailRow("Directorio parece pack", packDirectory.looksLikePackRoot === undefined ? null : String(Boolean(packDirectory.looksLikePackRoot)))}
          ${detailRow("Biblioteca packs", library?.totals?.packs || 0)}
          ${detailRow("Biblioteca packs inválidos", library?.totals?.packsWithErrors || 0)}
          ${detailRow("Locations legacy detectadas", library?.legacy?.locationsDetected || 0)}
          ${detailRow("Migración legacy", library?.legacy?.migration)}
          ${detailRow("Biblioteca warnings", libraryWarnings.length ? libraryWarnings.join(" | ") : "sin warnings")}
          ${detailRow("Runtime MAME compartido", runtimeConfigured ? "configurado" : "no configurado")}
          ${detailRow("mame.exe compartido", runtimeAvailable ? "encontrado" : "no disponible")}
          ${detailRow("Ruta MAME compartido", runtime?.mameExecutablePath)}
          ${detailRow("Version MAME", runtime?.version)}
          ${detailRow("Runtime warnings", runtime?.warnings?.length ? runtime.warnings.join(" | ") : "sin warnings")}
          ${detailRow("Comprobación de temporada", membership?.status || "sin comprobación")}
          ${detailRow("Configuracion remota", data?.remoteConfiguration?.status)}
          ${detailRow("Origen HSL", data?.remoteConfiguration?.hslOrigin)}
          ${detailRow("Fuente del origen HSL", data?.remoteConfiguration?.source)}
          ${detailRow("Herramientas de desarrollo", developerToolsEnabled ? "activadas" : "desactivadas")}
          ${detailRow("URL consultada", membership?.request?.url)}
          ${detailRow("HTTP status", membership?.response?.httpStatus)}
          ${detailRow("Body status", membership?.response?.bodyStatus)}
          ${detailRow("Body ok", membership?.response?.bodyOk)}
          ${detailRow("Mensaje", membership?.response?.bodyMessage || membership?.message)}
          ${detailRow("Motivo técnico", membership?.technicalReason)}
          ${detailRow("Comprobado", membership?.checkedAt)}
          ${detailRow("WeekId", membership?.weekId)}
          ${detailRow("SeasonId", membership?.seasonId)}
          ${detailRow("Auto-sync estado", autoSync?.status)}
          ${detailRow("Auto-sync motivo", autoSync?.reason)}
          ${detailRow("Auto-sync último intento", autoSync?.lastAttemptAt)}
          ${detailRow("Auto-sync último éxito", autoSync?.lastSuccessAt)}
          ${detailRow("Auto-sync pending antes", autoSync?.pendingBefore)}
          ${detailRow("Auto-sync pending despues", autoSync?.pendingAfter)}
          ${renderReadinessChecks(readiness)}
          <div>
            <dt>Cola</dt>
            <dd>${escapeHtml(data?.queue?.pending?.dir || "sin ruta activa")}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>${escapeHtml(data?.scope?.scopedQueueRoot || "sin scope activo")}</dd>
          </div>
          <div>
            <dt>Staging plugin</dt>
            <dd>${escapeHtml(data?.scope?.stagingPendingDir || "sin staging activo")}</dd>
          </div>
          <div>
            <dt>Sesión</dt>
            <dd>${escapeHtml(data?.session?.sessionRevision || "sin revision")}</dd>
          </div>
        </dl>
      </details>
    </section>
  `;
}
