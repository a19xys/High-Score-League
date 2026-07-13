import { escapeHtml } from "./html.js";

export function renderLibraryEmptyState({ action = null, actions = null, body, state, title }) {
  const disabled = state?.busy ? "disabled" : "";
  const availableActions = actions || (action ? [action] : []);

  return `
    <div class="library-empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      ${availableActions.length > 0
        ? `
          <div class="library-empty-state__actions">
            ${availableActions.map((item, index) => `
              <button class="tool-button ${index === 0 ? "account-primary" : ""}" type="button" data-action="${escapeHtml(item.type)}" ${disabled}>
                ${escapeHtml(item.label)}
              </button>
            `).join("")}
          </div>
        `
        : ""}
    </div>
  `;
}
