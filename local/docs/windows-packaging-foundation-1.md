# Windows packaging foundation

## Build Windows x64

El producto se construye desde `local/hsl-local-app` con Node/npm y Windows x64. No requiere un 7-Zip global: `7zip-bin` es una dependencia exclusiva de build.

```powershell
npm ci
npm run prepare:mame
npm run package:win
npm run smoke:packaged
npm run dist:win
```

`prepare:mame` lee `mame-runtime-manifest.json`, usa la caché de desarrollo `.cache/mame/<version>`, descarga únicamente el asset oficial si no está cacheado, exige el SHA-256 homologado, extrae el SFX completo y valida recursos críticos y `mame.exe -help`. Un asset cacheado con SHA incorrecto aborta; con un asset correcto el proceso funciona offline (`node scripts/prepare-mame.js --offline`).

`prepare:package` no reutiliza ese árbol extraído de desarrollo: vuelve a verificar el SFX y crea desde cero `.cache/product/mame/<version>/runtime`. `electron-builder` toma MAME exclusivamente de ese staging de producto, cuya versión se deriva del mismo manifest. Así, una modificación previa de cualquiera de los dos árboles de caché no pasa silenciosamente a la distribución. `.cache` y `dist` están ignorados por Git.

`package:win` genera `dist/win-unpacked`; `dist:win` genera el instalador NSIS x64 per-user y one-click `High Score League Setup <version>.exe`. El código queda en ASAR. MAME y el plugin son `extraResources`.

La configuración pública inmutable vive en `product-public-config.json` y se valida al cargar la configuración de electron-builder. Solo contiene HSL origin, Supabase URL y publishable key. El build rechaza `sb_secret_*` y JWT `service_role`.

## Contrato de runtime

MAME 0.287 x64 es la versión homologada; no se consulta `latest`. Cambiarla exige modificar explícitamente el manifest y su SHA.

```text
resources/app.asar                         código HSL inmutable
resources/mame/0.287/                      distribución binaria oficial completa, inmutable
resources/hsl/mame-plugin/hsl-score/       fuente competitiva HSL inmutable
%APPDATA%/High Score League/               estado persistente
  runtime/mame/state/                      cfg fallback, nvram, inp, sta, snap, diff, comments, share, ini y home
  runtime/runs/<runId>/                    plugin/adaptador/config/eventos de cada competición
```

En una app empaquetada, `process.resourcesPath/mame/0.287/mame.exe` gana y no se escribe `mame-runtime.json`. En desarrollo se conserva la selección externa de `userData/runtime/mame-runtime.json`.

Práctica v2 usa el runtime elegido, ROM y recursos del pack primero, recursos stock después, rutas mutables bajo `userData`, `inipath` controlado y `-noplugins`.

Competición v2 copia por run la allowlist de `hsl-score`, el adapter del pack, un `config.lua` generado y únicamente el `plugins/boot.lua` del runtime MAME realmente seleccionado. Usa `inipath` propio sin heredar `plugin.ini`, `pluginspath=<run>/plugins`, `-plugins -plugin hsl-score` y eventos bajo el run. El resto de plugins stock no se copia ni queda visible para el bootstrap.

Los `launchArgs` del pack conservan opciones de emulación/presentación, pero no pueden controlar ROM/art/sample paths, BGFX/HLSL/hash/ctrlr/font/language/INI paths, home/plugin policy ni directorios mutables. Se reconocen mayúsculas, formas inline y aliases documentados.

## Versión y actualización futura

`package.json.version` es la única autoridad de versión. Electron la entrega con `app.getVersion()` al preload mediante un argumento estrecho; renderer, Playtime y submissions reciben esa versión sin exponer Node.

Una futura actualización debe poder reemplazar `app.asar`, MAME y los recursos HSL. Debe conservar todo `userData`. Esta base no incorpora `electron-updater`, feed, Releases ni `latest.yml` como infraestructura de publicación.

## Checklist manual Windows

- Ejecutar `dist:win`, instalar `High Score League Setup <version>.exe` y confirmar GUI, nombre, icono y versión (no CLI).
- Primer arranque: login sin `config.json`, Biblioteca disponible y runtime bundled 0.287 sin pedir `mame.exe`.
- Práctica v2: ROM, artwork y samples correctos; `hsl-score` y plugins stock desactivados.
- Competición v2: run aislado, adapter/config correctos, solo `hsl-score`, captura y eventos en staging HSL.
- Reiniciar y comprobar sesiones, cuentas, Biblioteca, preferencias, tema, Playtime, colas y estado MAME.
- Desinstalar y comprobar que `%APPDATA%\High Score League` permanece.
- Reinstalar y confirmar que el estado anterior reaparece.
