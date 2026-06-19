# LOCAL-LAUNCHER-GUI-1

Primer prototipo visual minimo del launcher local.

## Alcance implementado

- GUI Electron provisional, sin empaquetado.
- Entrada: `npm run gui` dentro de `local/hsl-local-app`.
- UI separada en main/preload, servicio local, renderer, componentes y estilos.
- Acciones conectadas a la logica existente: diagnostico, play, practice, submit-all, sync-plugin y logout local.
- Estado visible de sesión local, modo dev bridge/pack, juego configurado, week, cola pending/sent/failed y salida de acciones.
- Login completo queda en CLI para no introducir manejo de password en el prototipo GUI.

## Polish 1

- La pantalla prioriza el juego activo, el estado para competir y el botón
  `Jugar competición`.
- La cola `pending` se presenta como cola de seguridad de puntuaciones, no como
  listado técnico de JSON.
- Las rutas, `dev bridge`, `sync-plugin` y logs crudos quedan en herramientas
  de desarrollo o detalles plegables.
- Los mensajes muestran primero un resumen amigable y dejan los detalles
  técnicos en `Ver detalles técnicos`.
- El tema oscuro y claro usan los tokens visuales de la web: superficies,
  bordes, badges y botón turquesa.

## Pack open 1

- La GUI añade `Abrir pack` como acción secundaria del panel del juego.
- Electron abre un diálogo de carpeta y el proceso principal carga `pack.json`
  desde la carpeta elegida.
- El pack activo se guarda solo en memoria durante la sesión de la GUI.
- Si el pack es válido, la GUI usa su ROM, week, web URL, rutas MAME y cola
  `plugins/<pluginName>/events/{pending,sent,failed}`.
- Si el usuario cancela, falta `pack.json` o el pack es inválido, se muestra un
  mensaje amigable y no se cambia el pack activo.
- `config.json` no se modifica.

Documento específico: [`launcher-pack-open-1.md`](launcher-pack-open-1.md).

## Dev pack manifest 1

- Se añade `local/examples/pack.hsl-invaders-flat.example.json` para el pack
  de desarrollo actual con `mame.exe`, `roms/` y `plugins/` en la raíz.
- Para probar `Abrir pack` con `C:/Users/u/Downloads/hsl-invaders/`, copia ese
  ejemplo como `pack.json` en la raíz del pack y rellena `weekId`.
- Este ejemplo plano no sustituye el layout final distribuible con MAME dentro
  de `mame/`.

## Pack remember 1

- Al abrir un pack válido, la GUI recuerda su carpeta en
  `userData/packs/recent.json`.
- Al iniciar, intenta recargar automáticamente el último pack si sigue
  existiendo y su `pack.json` sigue siendo válido.
- Si falla, muestra un aviso amable y mantiene el fallback de desarrollo puente.
- No copia packs, no borra eventos y no implementa lista multi-pack.

## Limites

- El juego fijo sigue siendo `invaders`, igual que el MVP local actual.
- No hay selector de packs, multi-juego, auto-submit, capturas manuales ni reglas nuevas de partida.
- `sync-plugin` solo se habilita cuando la configuración parece modo desarrollo puente.
- No se cambia `config.json`; la GUI solo lee la configuración efectiva.
- No hay lista de packs recientes ni multi-pack completo.

## Estructura

- `gui/main.js`: proceso principal Electron e IPC.
- `gui/preload.js`: API segura para renderer.
- `gui/launcher-service.js`: puente fino hacia modulos CLI existentes.
- `gui/renderer/`: HTML, estado, componentes y estilos.
