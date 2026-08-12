function libraryLocationDialogOptions(context = {}) {
  return {
    buttonLabel: "Elegir directorio",
    ...(context.defaultPath ? { defaultPath: context.defaultPath } : {}),
    message: "Elige la carpeta que contiene todos tus packs locales",
    properties: ["openDirectory"],
    title: "Directorio de packs de High Score League",
  };
}

function firstConfigurationDefaultPath(context, getSystemPath) {
  if (context?.defaultPath || context?.configured !== false || typeof getSystemPath !== "function") {
    return context?.defaultPath || null;
  }

  for (const name of ["documents", "home"]) {
    try {
      const directoryPath = getSystemPath(name);
      if (typeof directoryPath === "string" && directoryPath.trim()) return directoryPath;
    } catch {
      // Electron can fail to resolve a redirected system folder. Home is the fallback.
    }
  }

  return null;
}

async function showLibraryLocationDialog({ dialog, getSelectionContext, getSystemPath, parentWindow }) {
  if (!dialog?.showOpenDialog) throw new TypeError("dialog.showOpenDialog is required");
  if (typeof getSelectionContext !== "function") throw new TypeError("getSelectionContext is required");
  const context = await getSelectionContext();
  return dialog.showOpenDialog(parentWindow, libraryLocationDialogOptions({
    ...context,
    defaultPath: firstConfigurationDefaultPath(context, getSystemPath),
  }));
}

async function applyLibraryLocationCandidate({
  chooseCandidate,
  directoryPath,
  readAcceptedState,
  readStableState,
  runAcceptedMutation,
}) {
  const response = await chooseCandidate(directoryPath);

  if (!response.ok) {
    return {
      ...response,
      state: await readStableState(),
    };
  }

  return runAcceptedMutation(async () => ({
    ...response,
    state: await readAcceptedState(),
  }));
}

module.exports = {
  applyLibraryLocationCandidate,
  firstConfigurationDefaultPath,
  libraryLocationDialogOptions,
  showLibraryLocationDialog,
};
