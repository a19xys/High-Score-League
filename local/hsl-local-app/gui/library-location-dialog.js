function libraryLocationDialogOptions(context = {}) {
  return {
    buttonLabel: "Elegir directorio",
    ...(context.defaultPath ? { defaultPath: context.defaultPath } : {}),
    message: "Elige la carpeta que contiene todos tus packs locales",
    properties: ["openDirectory"],
    title: "Directorio de packs de High Score League",
  };
}

async function showLibraryLocationDialog({ dialog, getSelectionContext, parentWindow }) {
  if (!dialog?.showOpenDialog) throw new TypeError("dialog.showOpenDialog is required");
  if (typeof getSelectionContext !== "function") throw new TypeError("getSelectionContext is required");
  const context = await getSelectionContext();
  return dialog.showOpenDialog(parentWindow, libraryLocationDialogOptions(context));
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
  libraryLocationDialogOptions,
  showLibraryLocationDialog,
};
