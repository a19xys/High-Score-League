# Deep link local de importación de packs v1

## Contrato estable

El launcher para Windows reconoce exclusivamente:

```text
highscoreleague://import-pack/<packId>
```

La gramática exacta exige `scheme=highscoreleague:`, host `import-pack`, un único segmento de ruta y ausencia de query, fragmento, puerto y credenciales. El identificador remoto cumple:

```regex
^[a-z0-9][a-z0-9_-]{0,127}$
```

El URI sólo transporta `packId`. Nunca transporta URL de descarga, ruta local, token, hash, tamaño, object key, proveedor de almacenamiento, `gameId` ni `weekId`. Estas identidades no son intercambiables: `packId` identifica la unidad instalable; `gameId`, el juego; y `weekId`, la jornada competitiva. La regex remota no cambia la compatibilidad de los packs locales legacy.

## Arranque e instancia única

En arranque en frío se analiza todo `process.argv`, sin asumir que el enlace sea el último argumento. Cero candidatos no produce intent; más de un candidato `highscoreleague:` hace que esa invocación sea ambigua y no produzca intent.

En arranque en caliente la segunda instancia analiza su propio `argv` y llama a `requestSingleInstanceLock(additionalData)` con esta única forma normalizada:

```json
{
  "packDeepLink": {
    "version": 1,
    "type": "import-pack",
    "packId": "space-invaders-week-1"
  }
}
```

La primaria revalida la estructura y, haya o no intent válido, conserva el comportamiento de restaurar, mostrar y enfocar su ventana. La URL original no se conserva.

## Cola y presentación

`main` mantiene una cola sólo en memoria, FIFO, deduplicada por `packId` y limitada a ocho identidades distintas. Cada entrada recibe UUID y fecha interna. `peek` no consume; Cancelar o un resultado terminal sí. No hay persistencia ni polling.

El renderer avisa al alcanzar el milestone `interactive`. A partir de ahí, `main` anuncia que existe trabajo y el renderer consulta la cabeza. Una recarga puede volver a consultar la misma entrada. El renderer la difiere mientras haya `busy`, MAME en curso, otro diálogo, overlay/selector, login, activación de Biblioteca o una actualización de Windows pendiente. Una transición normal de estado vuelve a intentar la presentación; no se usan temporizadores de readiness.

## IPC renderer ↔ main

El preload expone sólo estas operaciones semánticas:

```text
getPendingPackImportIntent()
onPackImportIntentAvailable(callback)
acceptPackImportIntent(intentId)
cancelPackImportIntent(intentId)
```

La vista de intent es exactamente:

```js
{ intentId, packId, alreadyInstalled, libraryReady }
```

No cruza al renderer la URL original, `downloadUrl`, token, ruta temporal ni una API genérica para abrir/importar recursos. La red sigue en `main`; se mantienen `contextIsolation`, sandbox, `nodeIntegration: false` y `connect-src 'none'`.

## Autoridad local antes de red

Antes de sesión o red, `librarySnapshotAuthority` refresca la Biblioteca y compara el `packId` canónico exacto. Si ya está instalado, termina con `already-installed` y no resuelve sesión, descarga ni crea temporales. Si el directorio no está configurado o disponible, devuelve `library-unavailable` y reutiliza el selector actual de Biblioteca; el intent permanece pendiente para reanudarlo tras una elección válida. El importador conserva su barrera contra duplicados para carreras.

## Contrato remoto reservado

El cliente queda preparado para un endpoint futuro, todavía no desplegado por esta tarea:

```http
GET /api/launcher/packs/<packId>/download
Authorization: Bearer <sesión canónica>
Accept: application/json
```

El origen procede del `hslOrigin` confiable del producto. Se reutilizan `resolveCanonicalSessionResult` y `executeCanonicalAuthenticatedRequest`, incluido un único refresh canónico y segundo intento tras 401.

Descriptor v1:

```json
{
  "version": 1,
  "packId": "space-invaders-week-1",
  "artifact": {
    "sizeBytes": 31457280,
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "downloadUrl": "https://objects.example/temporary.zip?signature=..."
  }
}
```

El JSON se limita a 32 KiB. Se exige versión 1, identidad exacta, tamaño entero positivo dentro del máximo local (1 GiB), SHA-256 hexadecimal de 64 caracteres y URL HTTPS absoluta sin credenciales, fragmento ni host localhost. Se permiten query strings firmadas. No se aceptan `http:`, `file:`, `ftp:`, `data:`, `javascript:` ni rutas locales.

Sólo la petición HSL lleva bearer. La petición al artefacto lleva únicamente `Accept: application/zip`, usa `redirect: "error"` y no conoce R2, S3 ni otro proveedor. La URL temporal no se registra ni se devuelve al renderer.

## Streaming, verificación e importación

El artefacto se lee por chunks desde `ReadableStream` y se escribe en un ZIP aleatorio dentro de un directorio temporal. Cada chunk incrementa el contador y el SHA-256; no se llama a `arrayBuffer()` para el ZIP completo. La descarga aborta si supera el tamaño declarado o el máximo local. Al finalizar deben coincidir exactamente bytes y hash. Timeout, señal externa, suspensión y shutdown cancelan la operación.

Tras verificar, el ZIP pasa al importador existente:

```js
importPackFromZip(zipPath, config, { expectedPackId })
```

La validación temporal exige `pack.json.packId === expectedPackId` antes del rename atómico; si no, lanza `PackImportError` con `unexpected_pack_id`. Las importaciones manuales omiten esa opción y mantienen su contrato anterior. El ZIP remoto y su directorio temporal se eliminan en `finally` tanto en éxito como en error, cancelación, fallo de integridad o rechazo del importador.

La ruta de éxito reutiliza `importPackFromZipForGui`/`activateImportedPack`: refresca `librarySnapshotAuthority`, localiza la ruta final, activa el pack y obtiene el nuevo estado del launcher. No existe una segunda autoridad de selección o membership.

## Resultados de producto

La frontera devuelve una clasificación segura, sin excepciones crudas:

```text
imported
already-installed
cancelled
library-unavailable
requires-login
offline
pack-unavailable
remote-error
download-integrity-failed
invalid-pack
unexpected-pack-id
```

Un 404/410/503 se presenta como pack no disponible. Un fallo de transporte se presenta como falta de conexión; un fallo de tamaño/hash como integridad; un ZIP rechazado como pack inválido. Un duplicado detectado al finalizar converge a `already-installed`. Ninguno de estos fallos modifica por sí solo la autoridad global de conectividad HSL.

## Registro Windows NSIS

electron-builder 26.15.7 incluye `build/installer.nsh`. `customInstall` crea por usuario:

```text
HKCU\Software\Classes\highscoreleague
HKCU\Software\Classes\highscoreleague\DefaultIcon
HKCU\Software\Classes\highscoreleague\shell\open\command
```

El comando queda conceptualmente como:

```text
"<instalación>\High Score League.exe" "%1"
```

`customUnInstall` elimina `HKCU\Software\Classes\highscoreleague`. No hay registro automático durante `npm run gui`; no cambian instalación per-user, one-click, updater, versión ni publicación.

## QA manual Windows

Usar un installer local en una cuenta o VM desechable; no publicar el artefacto ni sustituir una instalación 0.2.0 preservada.

1. Instalar y consultar `reg query HKCU\Software\Classes\highscoreleague /s`. Verificar `URL Protocol`, exe entrecomillado y `"%1"` entrecomillado.
2. Con launcher cerrado: `Start-Process "highscoreleague://import-pack/space-invaders-test"`. Debe abrir una instancia y conservar el intent hasta el diálogo.
3. Repetir con launcher abierto y luego minimizado. No debe aparecer una segunda ventana; la primaria se restaura y enfoca.
4. Abrir MAME y lanzar el enlace. No debe interrumpirse la partida; el diálogo aparece al volver y liberarse `busy`.
5. Repetir con otro modal/selector abierto. El modal no se sustituye y el intent se presenta después.
6. Usar un `packId` ya instalado. Debe mostrar “Este pack ya está en tu biblioteca” con cero red.
7. Sin endpoint remoto, confirmar un pack no instalado. Debe mostrar “no disponible”, sin crash, carpeta parcial ni ZIP residual.
8. Probar Biblioteca ausente: elegir una carpeta válida y comprobar que reaparece el mismo intent.
9. Desinstalar y confirmar que `reg query HKCU\Software\Classes\highscoreleague /s` ya no encuentra la clave.

La web no debe exponer este deep link hasta que exista una versión publicada del launcher que incluya el contrato. El catálogo/backend, almacenamiento y botón web pertenecen a `WEB-PACK-DISTRIBUTION-R2-1` y `WEB-PACK-IMPORT-DEEPLINK-1`.
