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
  assert.doesNotMatch(local, />AA</);
  assert.match(initials, />BB</);
  assert.doesNotMatch(initials, /<img/);
  assert.match(fallback, /data-icon="user"/);
  assert.match(rejectedRemote, />CC</);
  assert.doesNotMatch(rejectedRemote, /remote\.example/);
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
});
