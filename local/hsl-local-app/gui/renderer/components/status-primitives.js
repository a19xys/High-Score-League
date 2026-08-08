import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";

const SEVERITY_CLASSES = Object.freeze({
  neutral: "badge-muted",
  info: "badge-info",
  progress: "badge-progress",
  success: "badge-ok",
  warning: "badge-warn",
  error: "badge-error",
  blocked: "badge-blocked",
});
const STATUS_BEACON_TONES = new Set(["error", "info", "neutral", "success", "warning"]);
const STATUS_BEACON_VARIANTS = new Set(["connection", "pack"]);

export function renderStatusBeacon(tone, options = {}) {
  const safeTone = STATUS_BEACON_TONES.has(tone) ? tone : "neutral";
  const safeVariant = STATUS_BEACON_VARIANTS.has(options.variant) ? options.variant : "pack";
  const className = options.className ? ` ${escapeHtml(options.className)}` : "";
  const label = String(options.label || "");
  const accessibility = options.decorative === true
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escapeHtml(label)}"`;

  return `<span class="status-beacon status-beacon--${safeTone} status-beacon--${safeVariant}${className}" ${accessibility}></span>`;
}

export function renderStatusBadge(model, { className = "" } = {}) {
  if (!model) return "";
  const severity = model.severity || "neutral";
  const semanticClass = SEVERITY_CLASSES[severity] || SEVERITY_CLASSES.neutral;
  return `
    <span class="badge state-badge ${semanticClass} state-badge--${escapeHtml(severity)} ${escapeHtml(className)}" data-severity="${escapeHtml(severity)}" title="${escapeHtml(model.description || model.title)}">
      ${renderIcon(model.icon || "info", { className: "status-icon", size: "sm" })}
      <span>${escapeHtml(model.title)}</span>
    </span>
  `;
}

export function renderContextNotice(model, { className = "" } = {}) {
  if (!model) return "";
  const severity = model.severity || "neutral";
  return `
    <section class="state-notice state-notice--${escapeHtml(severity)} ${escapeHtml(className)}" data-severity="${escapeHtml(severity)}">
      <div class="state-notice__icon" aria-hidden="true">${renderIcon(model.icon || "info", { size: "sm" })}</div>
      <div class="state-notice__copy">
        <strong>${escapeHtml(model.title)}</strong>
        ${model.description ? `<p>${escapeHtml(model.description)}</p>` : ""}
      </div>
    </section>
  `;
}

export function renderAvailabilityButton(model, { className = "", iconClassName = "action-icon", labelClassName = "action-button-label", type = "button" } = {}) {
  const disabled = !model.available;
  const reasonReference = disabled && model.reason ? `aria-describedby="${escapeHtml(model.reasonId)}"` : "";
  const title = disabled && model.reason ? model.reason : model.label;
  return `
    <button class="${escapeHtml(className)}" type="${escapeHtml(type)}" data-action="${escapeHtml(model.action)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(model.label)}" ${reasonReference} ${disabled ? "disabled aria-disabled=\"true\"" : ""}>
      ${renderIcon(model.icon, { className: `${iconClassName} icon-slot icon-slot--${model.icon}` })}
      <span class="${escapeHtml(labelClassName)}">${escapeHtml(model.label)}</span>
    </button>
  `;
}

export function renderBlockingReasons(models) {
  const blocked = models.filter((model) => !model.available && model.reason);
  if (blocked.length === 0) return "";
  return `
    <div class="action-block-reasons" aria-label="Motivos de acciones no disponibles">
      ${blocked.map((model) => `
        <p class="action-block-reason" id="${escapeHtml(model.reasonId)}">
          <strong>${escapeHtml(model.label)}:</strong> ${escapeHtml(model.reason)}
        </p>
      `).join("")}
    </div>
  `;
}
