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

function renderUnavailablePackDirectoryDialog() {
  const titleId = "app-dialog-pack-directory-title";
  const descriptionId = "app-dialog-pack-directory-description";
  const buttons = [
    { action: "choose-unavailable-pack-directory", autofocus: true, icon: "folder", label: "Elegir carpeta", variant: "primary" },
    { action: "close-dialog", label: "Cancelar", variant: "secondary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--pack-directory" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Biblioteca no disponible</p>
          <h2 id="${titleId}">No se encuentran los packs</h2>
          <p id="${descriptionId}">El launcher no puede acceder a la biblioteca. Selecciónala de nuevo o elige otra carpeta.</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--pack-directory">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderRejectedLibraryRootDialog(dialog) {
  const titleId = "app-dialog-library-root-title";
  const descriptionId = "app-dialog-library-root-description";
  const packRoot = dialog.classification === "pack-root";
  const insidePack = dialog.classification === "inside-pack";
  const unsupported = dialog.classification === "unsupported-layout";
  const title = packRoot
    ? "Has elegido la carpeta de un pack"
    : insidePack
      ? "Esta carpeta forma parte de un pack"
      : unsupported
        ? "Los packs están demasiado profundos"
        : "Esta carpeta no puede usarse como biblioteca";
  const description = packRoot
    ? "Esta carpeta contiene un juego concreto. Elige la carpeta que contiene todos tus packs."
    : insidePack
      ? "Has elegido una carpeta interna de un juego. Selecciona la carpeta que contiene todos tus packs."
      : unsupported
        ? "Cada pack debe estar en una subcarpeta directa de la biblioteca. No se cargarán packs de niveles más profundos."
        : "La carpeta elegida no es una raíz de biblioteca válida. La biblioteca anterior se mantiene sin cambios.";
  const suggestedLabel = insidePack ? "Usar biblioteca detectada" : "Usar carpeta superior";
  const buttons = [
    ...(dialog.suggestedRootPath
      ? [{ action: "use-suggested-library-root", autofocus: true, icon: "folder", label: suggestedLabel, variant: "primary" }]
      : []),
    {
      action: "choose-other-library-root",
      autofocus: !dialog.suggestedRootPath,
      icon: "folder",
      label: "Elegir otra carpeta",
      variant: dialog.suggestedRootPath ? "secondary" : "primary",
    },
    { action: "close-dialog", label: "Cancelar", variant: "secondary" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--pack-directory" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Ubicación de biblioteca</p>
          <h2 id="${titleId}">${title}</h2>
          <p id="${descriptionId}">${description}</p>
        </div>
        <div class="app-dialog__actions app-dialog__actions--pack-directory app-dialog__actions--library-root">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

export function renderAppDialog(state) {
  if (state?.activeDialog?.type === "library-root-rejected") {
    return renderRejectedLibraryRootDialog(state.activeDialog);
  }

  if (state?.activeDialog?.type === "pack-directory-unavailable") {
    return renderUnavailablePackDirectoryDialog();
  }

  if (state?.activeDialog?.type === "import-pack") {
    return renderImportPackDialog();
  }

  return "";
}
