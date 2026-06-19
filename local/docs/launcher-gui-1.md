# LOCAL-LAUNCHER-GUI-1

Primer prototipo visual minimo del launcher local.

## Alcance implementado

- GUI Electron provisional, sin empaquetado.
- Entrada: `npm run gui` dentro de `local/hsl-local-app`.
- UI separada en main/preload, servicio local, renderer, componentes y estilos.
- Acciones conectadas a la logica existente: diagnostico, play, practice, submit-all, sync-plugin y logout local.
- Estado visible de sesion local, modo dev bridge/pack, juego configurado, week, cola pending/sent/failed y salida de acciones.
- Login completo queda en CLI para no introducir manejo de password en el prototipo GUI.

## Limites

- El juego fijo sigue siendo `invaders`, igual que el MVP local actual.
- No hay selector de packs, multi-juego, auto-submit, capturas manuales ni reglas nuevas de partida.
- `sync-plugin` solo se habilita cuando la configuracion parece modo desarrollo puente.
- No se cambia `config.json`; la GUI solo lee la configuracion efectiva.

## Estructura

- `gui/main.js`: proceso principal Electron e IPC.
- `gui/preload.js`: API segura para renderer.
- `gui/launcher-service.js`: puente fino hacia modulos CLI existentes.
- `gui/renderer/`: HTML, estado, componentes y estilos.
