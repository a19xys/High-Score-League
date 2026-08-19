function focusPrimaryWindow(window) {
  if (!window || window.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore?.();
  window.show?.();
  window.focus?.();
  return true;
}

const { parsePackDeepLinkAdditionalData } = require("../src/pack-deeplink");

function installSingleInstancePolicy(app, getWindow, options = {}) {
  const acquired = app.requestSingleInstanceLock(options.additionalData || {});
  if (!acquired) return false;
  app.on("second-instance", (_event, _commandLine, _workingDirectory, additionalData) => {
    focusPrimaryWindow(getWindow?.());
    const intent = parsePackDeepLinkAdditionalData(additionalData);
    if (intent) options.onPackDeepLink?.(intent);
  });
  return true;
}

module.exports = {
  focusPrimaryWindow,
  installSingleInstancePolicy,
};
