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
  listado tecnico de JSON.
- Las rutas, `dev bridge`, `sync-plugin` y logs crudos quedan en herramientas
  de desarrollo o detalles plegables.
- Los mensajes muestran primero un resumen amigable y dejan los detalles
  técnicos en `Ver detalles técnicos`.
- El tema oscuro y claro usan los tokens visuales de la web: superficies,
  bordes, badges y boton turquesa.

## Limites

- El juego fijo sigue siendo `invaders`, igual que el MVP local actual.
- No hay selector de packs, multi-juego, auto-submit, capturas manuales ni reglas nuevas de partida.
- `sync-plugin` solo se habilita cuando la configuracion parece modo desarrollo puente.
- No se cambia `config.json`; la GUI solo lee la configuración efectiva.

## Estructura

- `gui/main.js`: proceso principal Electron e IPC.
- `gui/preload.js`: API segura para renderer.
- `gui/launcher-service.js`: puente fino hacia modulos CLI existentes.
- `gui/renderer/`: HTML, estado, componentes y estilos.
