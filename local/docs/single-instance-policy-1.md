# LOCAL SINGLE INSTANCE POLICY 1

La GUI Electron usa `app.requestSingleInstanceLock()` antes de `whenReady`.

- Si no obtiene el lock, la instancia secundaria llama a `app.quit()` y no
  inicializa ventana, IPC, health, membership ni autoenvio.
- La instancia primaria escucha `second-instance`.
- Si la ventana esta minimizada, la restaura; despues la muestra y enfoca.
- Los argumentos de la segunda instancia no se interpretan ni se usan para
  abrir URLs o ejecutar acciones.

Esta politica evita dos coordinadores de cola, dos ciclos de health y carreras
sobre las sesiones o ficheros scoped. Las pruebas unitarias cubren rechazo de
secundaria y restauracion/foco de la primaria; la validacion GUI de prelaunch
incluye lanzar una segunda instancia real.
