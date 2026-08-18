# Windows auto-update 1

## Alcance y arquitectura

La primera build consciente de actualizaciones es `0.2.0`. La autoridad de versión continúa siendo `local/hsl-local-app/package.json.version`; `app.getVersion()`, `clientVersion`, renderer, Playtime y submissions derivan de ella. No hay una versión duplicada en `config.json` ni en la configuración pública de producto.

El main process posee una autoridad independiente, `WindowsUpdateService`, sobre `electron-updater` exactamente `6.8.9`. No forma parte de `launcherStateAuthority` ni de las autoridades competitivas. El servicio expone al renderer únicamente estado sanitizado y cuatro operaciones estrechas por preload: leer estado, suscribirse, aceptar y declinar. Nunca expone URLs, rutas temporales, headers, respuestas GitHub ni errores brutos.

Se usa la rama estable 6.x porque es compatible con Electron 43, electron-builder 26 y el NSIS actual. En esta versión el setter runtime `autoUpdater.channel` también activa `allowDowngrade`; por ello no se usa. `latest` procede exclusivamente de la configuración de electron-builder y del `app-update.yml` generado.

El updater real solo se habilita cuando se cumplen todas estas condiciones:

- app empaquetada;
- Windows (`win32`);
- `resources/app-update.yml` presente;
- ejecución distinta del harness `HSL_PACKAGED_SMOKE_FILE`.

Desarrollo, Linux/macOS, `package:win --dir` sin configuración NSIS y smoke empaquetado quedan deshabilitados antes de cargar `electron-updater`: no hacen requests ni muestran UI.

## Política explícita del updater

La configuración aplicada en main es:

```text
autoDownload = false
autoInstallOnAppQuit = false
allowPrerelease = false
allowDowngrade = false
disableDifferentialDownload = false
disableWebInstaller = true
```

No hay polling, timers de update, reintento en proceso, botón manual ni `nsis-web`. `electron-updater` conserva la autoridad SemVer: solo una versión estable superior es elegible; HSL no reimplementa esa comparación.

## Lifecycle de comprobación y UI

1. Renderer termina el bootstrap y emite el milestone real `interactive`.
2. Main marca `checkAttempted` antes de la operación asíncrona y llama una sola vez a `checkForUpdates()`.
3. Sin update, vuelve a `idle`. Un fallo queda como código sanitizado en diagnóstico, sin Busy ni diálogo.
4. Con update, main conserva `available`; renderer espera a estar estable.
5. La estabilidad exige que no existan Busy, diálogo, overlay, menú/login activo, activación/importación/mutación importante, startup visible, Ranking abriéndose, escritura de preferencias/tema ni Favoritos pendientes. MAME y práctica ya mantienen el Busy de producto, así que nunca se interrumpen para mostrar una update.
6. `app-dialog` presenta: «Hay una nueva versión de High Score League. ¿Quieres actualizar ahora?». `Ahora no` recibe el foco inicial; Escape y backdrop ejecutan el mismo decline real.
7. Declinar fija `declinedThisRun`, no descarga ni persiste una preferencia. El proceso siguiente comprueba otra vez.

## Aceptación, descarga e instalación

`Actualizar` cierra el diálogo y entra en Busy de forma síncrona, antes del primer `await`, con `Descargando actualización...`. A continuación espera la cola de tema, vacía y espera la cola ya existente de preferencias de Biblioteca, y solo entonces solicita la descarga a main. Los Favoritos no adquieren un segundo mecanismo de flush: el diálogo se difiere hasta que `pendingFavoriteKeys` esté vacío.

Solo la aceptación explícita puede llamar a `downloadUpdate()`, y llamadas duplicadas comparten una única operación. El progreso público se limita al porcentaje. Un error de descarga:

- no cierra ni instala;
- libera Busy;
- deja la app utilizable;
- guarda solo un código sanitizado;
- muestra feedback no catastrófico mediante `app-dialog` y el log existente.

Tras `update-downloaded`, si el update todavía posee el lifecycle y no ha empezado un cierre normal, se llama una sola vez a `quitAndInstall(true, true)`, sin segunda confirmación. La instalación es silenciosa y solicita relanzar HSL.

## Coordinador de salida

El `ExitCoordinator` reutiliza exactamente el drain normal (Playtime, Presence, perfiles, membership, sesiones, auto-submit, Connectivity, Ranking, Week Capabilities y demás autoridades existentes):

```text
cierre normal
→ before-quit
→ preventDefault / drain idempotente
→ cierre final armado
→ app.quit()
→ el segundo before-quit deja salir
```

Para update el orden es deliberadamente distinto:

```text
update-downloaded tras aceptación
→ marcar intención update
→ quitAndInstall(true, true)
→ NSIS se inicia y electron-updater solicita app.quit()
→ before-quit HSL
→ el mismo drain idempotente
→ app.quit() final
```

Así, HSL nunca apaga servicios antes de invocar la API de instalación; si `quitAndInstall` falla sin solicitar cierre, la GUI no entra en drain. En `electron-updater 6.8.9`, `NsisUpdater.doInstall()` acepta el intento de spawn y devuelve antes de que termine esa operación asíncrona, tras lo cual `BaseUpdater` programa `app.quit()`: un fallo tardío del proceso NSIS queda condicionado por ese lifecycle interno y no existe una confirmación pública previa al quit. Dos quits drenan una vez y hacen un solo quit final. Si el usuario cierra durante la descarga, el cierre normal gana, el servicio desmonta listeners/cancela cuando hay token disponible y nunca instala. Un callback `update-downloaded` tardío tampoco instala cuando el coordinador ya salió de `idle`. `shutdown()` no instala por efecto secundario, y `autoInstallOnAppQuit=false` protege además el cierre normal.

## GitHub, NSIS y artefactos

electron-builder usa un provider público sin credenciales:

```text
provider: github
owner: a19xys
repo: High-Score-League
channel: latest
private: false
```

`package:win` sigue siendo el `win-unpacked` rápido para smoke; no se considera updater-aware ni exige `app-update.yml`. `dist:win` construye el NSIS real y genera Setup, `.exe.blockmap`, `latest.yml` y `win-unpacked/resources/app-update.yml`. Ambos comandos incluyen `--publish never`; únicamente la futura pipeline puede adquirir autoridad de publicación.

`dist:win` ejecuta después `validate:update-artifacts`, un validador offline que comprueba provider/owner/repo/channel, ausencia de claves de credenciales, versión, SHA-512, tamaño cuando existe, blockmap y correspondencia con el instalador real. Compara hashes en vez de asumir que el nombre local bonito coincide con el `safeArtifactName` usado en metadata GitHub.

El soporte diferencial queda preparado con blockmaps y `disableDifferentialDownload=false`, pero es best-effort: si no se puede usar el blockmap anterior, electron-updater puede descargar el instalador completo. No se configura `previousBlockmapBaseUrlOverride`.

## Seguridad e invariante del monorepo

El modelo actual usa GitHub público por HTTPS, metadata generada por electron-builder y SHA-512 para comprobar la correspondencia e integridad del artefacto. No hay firma Authenticode. SHA-512 no autentica por sí sola al publisher si la autoridad de la Release fuese comprometida; la firma de código queda como trabajo futuro separado.

GitHub no distingue Releases de web y launcher. Invariante de distribución:

> Toda GitHub Release estable que pueda convertirse en `latest` en `a19xys/High-Score-League` debe respetar el contrato updater del Launcher y contener su metadata y artefactos correspondientes.

No debe publicarse una Release estable «solo web» que desplace `/releases/latest` sin `latest.yml` y los artefactos del launcher.

## Política de versiones

- Los commits internos pueden acumularse sin cambiar versión.
- Una funcionalidad significativa distribuible incrementa minor: `0.1.0 → 0.2.0`, luego `0.2.0 → 0.3.0`.
- Un hotfix distribuido de forma independiente incrementa patch: `0.2.0 → 0.2.1`.
- `1.0.0` se reserva para una app esencialmente terminada dentro de su alcance previsto.
- `2.0.0` se reserva para una transformación radical de producto, escala, equipo, monetización o audiencia.
- Toda versión publicada para auto-update es conceptualmente inmutable; la siguiente Release updater debe ser SemVer superior.

La transición `0.1.0 → 0.2.0` es manual porque `0.1.0` no contiene updater. La primera actualización automática real será una futura `0.2.0 → 0.2.1` o `0.2.0 → 0.3.0`; no se fabrica una Release de igual versión para probar.

## Pipeline futura (no implementada)

`LOCAL-WINDOWS-RELEASE-PIPELINE-1` deberá ejecutar:

```text
build de una versión superior
→ Setup + blockmap + latest.yml de la misma build
→ Release draft
→ subida de esos artefactos, incluidos safe artifact names
→ validación de assets/metadata
→ publicación estable
→ GitHub la convierte en latest
→ clientes instalados pueden verla
```

Esta implementación no crea tags ni Releases y no requiere `GH_TOKEN` en el cliente.

## QA manual posterior

### Última transición manual 0.1.0 → 0.2.0

1. En una instalación real `0.1.0`, conservar una sesión iniciada, Biblioteca, ruta, preferencias, tema, Favoritos, Playtime, colas y estado local representativo.
2. Ejecutar manualmente Setup `0.2.0` sin borrar `%APPDATA%\High Score League`.
3. Abrir HSL y comprobar que todo el estado anterior sigue presente.

El instalador conserva `appId`, instalación per-user y `deleteAppDataOnUninstall=false`; MAME, packs y estado mutable no cambian de autoridad.

### Sin Release superior

- Abrir `0.2.0` y comprobar que sigue usable y no aparece un popup falso.
- Si GitHub/red falla o todavía no existe una Release válida, comprobar que el fallo es silencioso y el diagnóstico solo contiene estado sanitizado.

### Primera N → N+1 real

Se hará tras `LOCAL-WINDOWS-RELEASE-PIPELINE-1`, con una Release estable realmente superior. Debe comprobar descarga, fallback completo/diferencial, drain, reemplazo, relanzamiento y preservación de userData. No pertenece a esta tarea.
