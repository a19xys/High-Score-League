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
    { action: "close-dialog", label: "Cancelar", variant: "ghost" },
  ];

  return `
    <div class="app-dialog-layer" data-dialog-backdrop>
      <section class="app-dialog app-dialog--import-pack" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" data-dialog>
        <div class="app-dialog__header">
          <p class="eyebrow">Importar pack</p>
          <h2 id="${titleId}">¿Qué quieres importar?</h2>
          <p id="${descriptionId}">Elige el tipo de pack. Después, podrás escoger su ruta desde el explorador de archivos.</p>
        </div>
        <div class="app-dialog__actions">
          ${buttons.map(renderDialogButton).join("")}
        </div>
      </section>
    </div>
  `;
}

export function renderAppDialog(state) {
  if (state?.activeDialog?.type === "import-pack") {
    return renderImportPackDialog();
  }

  return "";
}
