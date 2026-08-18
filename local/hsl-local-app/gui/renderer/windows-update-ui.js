export function isWindowsUpdateUiStable(state = {}, pending = {}) {
  return state.busy !== true
    && !state.activeDialog
    && !state.activeOverlay
    && state.accountMenuOpen !== true
    && state.authFormOpen !== true
    && state.libraryActivationInProgress !== true
    && !state.pendingLibraryPackId
    && state.rankingOpening !== true
    && state.startup?.visible === false
    && Object.keys(state.pendingFavoriteKeys || {}).length === 0
    && pending.themeWrites !== true
    && pending.libraryPreferenceWrites !== true;
}

export function shouldPresentWindowsUpdate(state = {}, pending = {}) {
  return state.windowsUpdate?.enabled === true
    && state.windowsUpdate?.state === "available"
    && state.windowsUpdate?.declinedThisRun !== true
    && isWindowsUpdateUiStable(state, pending);
}

export function windowsUpdateDialogPatch(state = {}, pending = {}) {
  if (!shouldPresentWindowsUpdate(state, pending)) return null;
  return {
    activeDialog: {
      type: "windows-update",
      version: state.windowsUpdate?.updateVersion || null,
    },
  };
}

export async function prepareAndAcceptWindowsUpdate(actions) {
  actions.beginBusy();
  await actions.waitForTheme();
  await actions.flushLibraryPreferences();
  return actions.accept();
}
