# LOCAL SINGLE INSTANCE POLICY 1

La GUI Electron usa `app.requestSingleInstanceLock()` antes de `whenReady`.

- Si no obtiene el lock, la instancia secundaria llama a `app.quit()` y no
  inicializa ventana, IPC, health, membership ni autoenvio.
- La instancia primaria escucha `second-instance`.
- Si la ventana esta minimizada, la restaura; despues la muestra y enfoca.
- Los argumentos de la segunda instancia no se interpretan ni se usan para
  abrir URLs o ejecutar acciones.

Esta politica evita dos coordinadores GUI de cola y dos ciclos GUI de health.
Reduce carreras dentro de Electron, pero no protege frente a una CLI u otro
proceso que comparta `userData`. Las pruebas unitarias cubren rechazo de
secundaria y restauracion/foco de la primaria; lanzar una segunda instancia del
ejecutable empaquetado sigue siendo validacion manual de prelaunch.

El lock de instancia GUI no sustituye la coordinacion con CLI. Login, refresh,
revoke, remove y migración por cuenta usan un lock filesystem por `userId`;
`known-accounts.json` usa otro y la migración completa añade
`canonical-migration.lock`. El orden es migración, usuario y metadata. Los
locks vacíos/truncados requieren gracia, dos lecturas estables y cuarentena
verificada; un PID vivo no se elimina. Timeout/cancelación no equivalen a
logout y los locks se liberan en `finally` cuando termina la operación.

Política completa, límites de PID reuse y drain:
[canonical-account-sessions-stabilization-2.md](canonical-account-sessions-stabilization-2.md).
