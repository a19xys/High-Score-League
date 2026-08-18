import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";

function renderDialogButton(button) {
  const action = button.action ? `data-action="${escapeHtml(button.action)}"` : "";
  const icon = button.icon
    ? renderIcon(button.icon, { className: "app-dialog__button-icon", size: "sm" })
    : "";
  const variant = button.variant || "secondary";
  const autofocus = button.autofocus ? "data-dialog-initial-focus" : "";

  return `
    <button class="app-dialog__button app-dialog__button--${escapeHtml(variant)}" type="button" ${action} ${autofocus}>
      ${icon}
      <span>${escapeHtml(button.label)}</span>
    </button>
  `;
}

function renderImportPackDialog() {
  const titleId = "app-dialog-import-pack-title";
  const descriptionId = "app-dialog-import-pack-description";
  const buttons = [
    { action: "import-pack-zip", autofocus: true, icon: "zip", label: "Archivo ZIP", variant: "primary" },
    { action: "import-pack-folder", icon: "folder", label: "Carpeta", variant: "primary" },
    { action: "close-dialog", label: "Cancelar", variant: "secondary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--import-pack" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Importar pack</p>
          <h2 id="${titleId}">¿Qué quieres importar?</h2>
          <p id="${descriptionId}">Elige el tipo de pack. Después, podrás escoger su ruta desde el explorador de archivos.</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--import-pack">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderForgetAccountDialog(dialog) {
  const titleId = "app-dialog-forget-account-title";
  const descriptionId = "app-dialog-forget-account-description";
  const accountLabel = dialog.email ? ` (${dialog.email})` : "";
  const buttons = [
    { action: "close-dialog", autofocus: true, label: "Cancelar", variant: "secondary" },
    { action: "confirm-forget-account", label: "Olvidar cuenta", variant: "primary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--forget-account" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Cuenta recordada</p>
          <h2 id="${titleId}">¿Olvidar esta cuenta?</h2>
          <p id="${descriptionId}">Se quitará la cuenta${escapeHtml(accountLabel)} y su sesión guardada de este dispositivo. Las puntuaciones y colas locales se conservarán.</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--forget-account">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

function rejectedLocationCopy(classification) {
  const copies = {
    "pack-root": {
      description: "Has elegido la carpeta de un juego. La Biblioteca necesita la carpeta que contiene los packs. La Biblioteca anterior se mantiene.",
      title: "Has elegido la carpeta de un pack",
    },
    "inside-pack": {
      description: "Estás dentro de un pack. Elige la carpeta que contiene los packs. La Biblioteca anterior se mantiene.",
      title: "Esta carpeta forma parte de un pack",
    },
    "unsupported-layout": {
      description: "Cada pack debe ser hijo directo de la Biblioteca. No se cargarán packs profundos ni se cambiará la Biblioteca anterior.",
      title: "Los packs están demasiado profundos",
    },
    missing: {
      description: "No se encuentra la carpeta elegida. La Biblioteca anterior se mantiene.",
      title: "No se encuentra esta carpeta",
    },
    inaccessible: {
      description: "No se puede acceder a la carpeta elegida. Comprueba sus permisos o el acceso a la unidad. La Biblioteca anterior se mantiene.",
      title: "No se puede acceder a esta carpeta",
    },
    "invalid-file": {
      description: "La ubicación elegida no es una carpeta. La Biblioteca anterior se mantiene.",
      title: "Elige una carpeta",
    },
  };
  return copies[classification] || copies.inaccessible;
}

function renderLibraryLocationDialog(dialog) {
  const titleId = "app-dialog-library-location-title";
  const descriptionId = "app-dialog-library-location-description";
  const currentRootUnavailable = dialog.issue === "current-root-unavailable";
  const currentRootMissing = dialog.classification === "missing";
  const copy = currentRootUnavailable
    ? {
      description: currentRootMissing
        ? "La Biblioteca recordada no se encuentra. Puedes reintentar la misma ubicación o elegir otra sin olvidar la actual al cancelar."
        : "No se puede acceder a la Biblioteca recordada. Puedes reintentar o elegir otra carpeta sin olvidar la actual al cancelar.",
      title: currentRootMissing ? "No se encuentra la Biblioteca" : "No se puede acceder a la Biblioteca",
    }
    : rejectedLocationCopy(dialog.classification);
  const buttons = [
    { action: "detect-library-location", autofocus: true, icon: "refresh", label: "Detectar packs", variant: "primary" },
    { action: "choose-library-location", icon: "folder", label: "Cambiar carpeta", variant: "secondary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--pack-directory app-dialog--library-location" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog data-library-location-issue="${escapeHtml(dialog.issue || "rejected-candidate")}">
        <div class="app-dialog__header">
          <p class="eyebrow">Ubicación de Biblioteca</p>
          <h2 id="${titleId}">${copy.title}</h2>
          <p id="${descriptionId}">${copy.description}</p>
          ${dialog.feedback ? `<p class="app-dialog__feedback" role="status">${escapeHtml(dialog.feedback)}</p>` : ""}
        </div>
        <div class="app-dialog__actions app-dialog__actions--pack-directory app-dialog__actions--library-root">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderWindowsUpdateDialog() {
  const titleId = "app-dialog-windows-update-title";
  const descriptionId = "app-dialog-windows-update-description";
  const buttons = [
    { action: "decline-windows-update", autofocus: true, label: "Ahora no", variant: "secondary" },
    { action: "accept-windows-update", label: "Actualizar", variant: "primary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--windows-update" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Actualización disponible</p>
          <h2 id="${titleId}">Actualizar High Score League</h2>
          <p id="${descriptionId}">Hay una nueva versión de High Score League. ¿Quieres actualizar ahora?</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--windows-update">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderWindowsUpdateErrorDialog() {
  const titleId = "app-dialog-windows-update-error-title";
  const descriptionId = "app-dialog-windows-update-error-description";
  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--windows-update" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Actualización</p>
          <h2 id="${titleId}">No se pudo descargar la actualización</h2>
          <p id="${descriptionId}">No se pudo descargar la actualización. Puedes seguir usando High Score League y se volverá a comprobar la próxima vez que abras la aplicación.</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--windows-update">
          ${renderDialogButton({ action: "close-dialog", autofocus: true, label: "Cerrar", variant: "secondary" })}
        </div>
      </section>
    </div>
  `;
}

export function renderAppDialog(state) {
  if (state?.activeDialog?.type === "windows-update") {
    return renderWindowsUpdateDialog();
  }

  if (state?.activeDialog?.type === "windows-update-error") {
    return renderWindowsUpdateErrorDialog();
  }

  if (state?.activeDialog?.type === "forget-account") {
    return renderForgetAccountDialog(state.activeDialog);
  }

  if (state?.activeDialog?.type === "library-location") {
    return renderLibraryLocationDialog(state.activeDialog);
  }

  if (state?.activeDialog?.type === "import-pack") {
    return renderImportPackDialog();
  }

  return "";
}
