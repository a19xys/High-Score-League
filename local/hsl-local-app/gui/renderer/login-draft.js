function formField(form, name) {
  return form?.elements?.namedItem?.(name) || form?.querySelector?.(`[name="${name}"]`) || null;
}

export function createEphemeralLoginDraft() {
  let email = "";
  let password = "";
  let focus = null;

  function capture(form) {
    if (!form) return;
    const emailField = formField(form, "email");
    const passwordField = formField(form, "password");
    email = String(emailField?.value || "");
    password = String(passwordField?.value || "");
    const active = form.ownerDocument?.activeElement;
    const activeName = active === emailField ? "email" : active === passwordField ? "password" : null;
    focus = activeName ? {
      name: activeName,
      direction: active.selectionDirection || "none",
      end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
      start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
    } : null;
  }

  function restore(form) {
    if (!form) return;
    const emailField = formField(form, "email");
    const passwordField = formField(form, "password");
    if (emailField) emailField.value = email;
    if (passwordField) passwordField.value = password;
    const active = focus ? formField(form, focus.name) : null;
    if (active) {
      active.focus?.({ preventScroll: true });
      if (focus.start !== null && focus.end !== null) {
        active.setSelectionRange?.(focus.start, focus.end, focus.direction);
      }
    }
  }

  function seed(nextEmail = "") {
    email = String(nextEmail || "");
    password = "";
    focus = null;
  }

  function clear() {
    email = "";
    password = "";
    focus = null;
  }

  function take(form) {
    capture(form);
    const credentials = { email: email.trim(), password };
    const passwordField = formField(form, "password");
    if (passwordField) passwordField.value = "";
    password = "";
    focus = null;
    return credentials;
  }

  return { capture, clear, restore, seed, take };
}
