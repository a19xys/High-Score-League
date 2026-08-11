const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

test("avatar central usa imagen local, luego iniciales y finalmente icono", async () => {
  const { renderAccountAvatar } = await import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href);
  const local = renderAccountAvatar({ avatarLocalUrl: "file:///C:/cache/avatar.webp", initials: "AA" });
  const initials = renderAccountAvatar({ avatarLocalUrl: null, initials: "BB" });
  const fallback = renderAccountAvatar({ avatarLocalUrl: null, initials: null });
  const rejectedRemote = renderAccountAvatar({ avatarLocalUrl: "https://remote.example/avatar.webp", initials: "CC" });
  assert.match(local, /account-mini-avatar__image/);
  assert.match(local, /src="file:\/\/\/C:\/cache\/avatar.webp"/);
  assert.match(local, /account-mini-avatar__initials">AA</);
  assert.match(initials, /account-mini-avatar__initials">BB</);
  assert.doesNotMatch(initials, /<img/);
  assert.match(fallback, /data-icon="user"/);
  assert.match(rejectedRemote, /account-mini-avatar__initials">CC</);
  assert.doesNotMatch(rejectedRemote, /remote\.example/);
});

test("cero cuentas renderiza solo el formulario y una cuenta recordada conserva el menú normal", async () => {
  const { renderAccountControl } = await import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href);
  const base = {
    accountMenuOpen: true,
    authEmail: "",
    authError: null,
    authFormOpen: true,
    busy: false,
    connectivity: { reachability: "connected" },
    data: {
      accounts: { knownAccounts: [] },
      remoteConfiguration: { status: "configured" },
      session: { hasSession: false },
    },
    theme: "dark",
  };
  const emptyHtml = renderAccountControl(base);
  const emptyMenu = emptyHtml.slice(emptyHtml.indexOf('<div class="account-menu'));
  assert.match(emptyMenu, /account-menu--empty/);
  assert.match(emptyMenu, /data-auth-form/);
  assert.match(emptyMenu, /account-login-form--empty/);
  for (const copy of ["Sin sesión", "Vuelve a iniciar sesión", "Cuentas", "Sin cuentas recordadas", "Añadir cuenta"]) {
    assert.doesNotMatch(emptyMenu, new RegExp(copy));
  }

  const normalHtml = renderAccountControl({
    ...base,
    data: {
      ...base.data,
      accounts: { knownAccounts: [{ email: "old@example.test", initials: "OE", requiresLogin: true, userId: "old" }] },
    },
  });
  assert.doesNotMatch(normalHtml, /account-menu--empty/);
  assert.match(normalHtml, />Cuentas</);
  assert.match(normalHtml, /data-action="add-account"/);
});

test("header sin sesión conserva semántica pero muestra avatar user grande sin copy visual", async () => {
  const { renderAccountControl } = await import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href);
  const html = renderAccountControl({
    accountMenuOpen: false,
    busy: false,
    data: { accounts: { knownAccounts: [] }, session: { hasSession: false } },
  });
  const button = html.match(/<button class="session-chip[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(button, /account-mini-avatar--empty-user/);
  assert.match(button, /data-icon="user"/);
  assert.match(button, /data-icon="chevron-right"/);
  assert.match(button, /aria-label="Sin sesi/);
  assert.doesNotMatch(button, /session-chip__empty/);
  assert.doesNotMatch(button, />Sin sesi[^<]*</);
  assert.equal((button.match(/data-action="toggle-account-menu"/g) || []).length, 1);
});

test("cuenta usa una sola superficie visual y conserva dos botones semanticos", async () => {
  const [{ renderAccountControl }, styles] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  const html = renderAccountControl({
    accountMenuOpen: true,
    busy: false,
    connectivity: { reachability: "connected" },
    data: {
      accounts: { knownAccounts: [{ email: "one@example.test", hasSavedSession: true, initials: "OE", isActive: false, userId: "user-1" }] },
      session: { hasSession: false },
    },
    theme: "dark",
  });
  assert.match(html, /class="account-row__surface"/);
  assert.match(html, /<button class="account-row__button"[^>]*data-action="switch-account"/);
  assert.match(html, /<button class="account-forget-button"[^>]*data-action="remove-known-account"/);
  assert.match(styles, /\.account-row__button:hover,[\s\S]*?background: transparent/);
  assert.match(styles, /\.account-row:not\(\.account-row--active\) \.account-row__surface:hover\s*\{[\s\S]*?background:/);
  assert.match(styles, /\.account-row__surface:focus-within\s*\{[\s\S]*?outline:/);
  assert.match(styles, /\.account-row--active \.account-row__email\s*\{\s*color: var\(--circuit\)/);
  assert.match(styles, /\.account-forget-button:hover,[\s\S]*?background:/);
});

test("la imagen ocupa el avatar circular con cover", async () => {
  const styles = await fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8");
  const imageRule = styles.match(/\.account-mini-avatar__image\s*\{[^}]*\}/)?.[0] || "";
  assert.match(imageRule, /width: 100%/);
  assert.match(imageRule, /height: 100%/);
  assert.match(imageRule, /object-fit: cover/);
  assert.match(styles, /\.account-mini-avatar\s*\{[\s\S]*?overflow: hidden/);
  assert.match(styles, /\.account-mini-avatar\s*\{[\s\S]*?display: inline-flex[\s\S]*?align-items: center[\s\S]*?justify-content: center/);
  assert.match(styles, /\.account-mini-avatar__fallback\s*\{[\s\S]*?align-items: center[\s\S]*?justify-content: center/);
  assert.match(styles, /\.account-mini-avatar--empty-user \.account-icon\.ui-icon\s*\{[\s\S]*?width: 24px[\s\S]*?height: 24px/);
});

test("formulario integrado, submit neutro-reactivo y email sin clipping", async () => {
  const [styles, header, app] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
  ]);
  assert.match(header, /class="tool-button account-login-submit" type="submit"/);
  assert.match(header, /class="tool-button account-primary icon-slot-button"[^>]*data-action="add-account"/);
  assert.match(styles, /\.account-login-form\s*\{[\s\S]*?background: transparent[\s\S]*?box-shadow: none/);
  assert.match(styles, /\.account-login-form--empty\s*\{[\s\S]*?border: 0[\s\S]*?padding: 0/);
  assert.doesNotMatch(styles, /\.account-login-submit\s*\{/);
  assert.doesNotMatch(styles, /\.account-login-submit:hover/);
  assert.match(styles, /\[data-theme="dark"\] \.account-primary:hover:not\(:disabled\)[\s\S]*?border-color: var\(--circuit\)[\s\S]*?background: color-mix/);
  assert.match(styles, /\.account-mini-avatar__fallback\s*\{[\s\S]*?line-height: 1\.25/);
  assert.match(styles, /\.known-accounts \.account-mini-avatar__fallback\s*\{[\s\S]*?display: flex[\s\S]*?font-weight: inherit/);
  assert.match(styles, /button:focus-visible,[\s\S]*?outline: 2px solid var\(--circuit\)/);
  assert.match(styles, /\.account-row__email\s*\{[\s\S]*?overflow: hidden[\s\S]*?line-height: 1\.3[\s\S]*?text-overflow: ellipsis[\s\S]*?white-space: nowrap/);
  assert.match(app, /function openCleanAccountMenuState\(state\)[\s\S]*knownAccounts \|\| \[\]\)\.length === 0[\s\S]*authFormOpen: empty/);
  assert.match(app, /action === "toggle-account-menu"[\s\S]*resetLoginDraft\(\)[\s\S]*openCleanAccountMenuState\(accountState\)/);
  assert.match(app, /action === "cancel-login"[\s\S]*resetLoginDraft\(\)[\s\S]*closeAccountMenuState\(\)/);
});
