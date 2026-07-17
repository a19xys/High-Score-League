function focusPrimaryWindow(window) {
  if (!window || window.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore?.();
  window.show?.();
  window.focus?.();
  return true;
}

function installSingleInstancePolicy(app, getWindow) {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) return false;
  app.on("second-instance", () => {
    focusPrimaryWindow(getWindow?.());
  });
  return true;
}

module.exports = {
  focusPrimaryWindow,
  installSingleInstancePolicy,
};
