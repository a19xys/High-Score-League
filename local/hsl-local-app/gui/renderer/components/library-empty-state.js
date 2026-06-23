import { escapeHtml } from "./html.js";

export function renderLibraryEmptyState({ action = null, body, state, title }) {
  const disabled = state?.busy ? "disabled" : "";

  return `
    <div class="library-empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      ${action
        ? `
          <button class="tool-button account-primary" type="button" data-action="${escapeHtml(action.type)}" ${disabled}>
            ${escapeHtml(action.label)}
          </button>
        `
        : ""}
    </div>
  `;
}
