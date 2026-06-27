# LOCAL-LAUNCHER-UX-REVAMP-1

## Implementado

La GUI se reorganizó como launcher de jugador:

- cabecera HSL compacta con cuenta, tema y estado `Conectado`, `Sin Internet` o
  `Reconectando`;
- biblioteca y detalle del juego como primera capa;
- `Jugar` como acción principal;
- `Practicar`, `Ver manual` y `Ver ranking` como acciones secundarias;
- actividad local resumida;
- cuenta y cambio de cuenta conservados;
- runtime, directorio, readiness, diagnose, logs y `sync-plugin` bajo
  `Opciones avanzadas`.

No se eliminó ninguna función existente. No se muestran tokens ni el contenido
completo de `session.json`.

## Prueba

```powershell
npm.cmd --prefix local/hsl-local-app test
npm.cmd --prefix local/hsl-local-app run gui
```

## LOCAL-LAUNCHER-SHELL-LAYOUT-2

El revamp queda reestructurado como app de escritorio de dos paneles. El header
permanece fijo, `app-main` ocupa el resto de la ventana, la biblioteca izquierda
tiene scroll propio y el detalle derecho deja de compartir hero con una columna
de cola local.

Actividad local se muestra como resumen compacto y `Ver detalles` abre un
drawer. `Opciones avanzadas` tambien abre un drawer con diagnostico, runtime,
directorio de packs, readiness, membership, colas, legacy y mensajes. La cuenta
completa pasa al menu compacto del header. El minimo de ventana es `1200x780`.

## LOCAL-LAUNCHER-SHELL-BUGFIX-3

Se corrigen bugs estructurales del shell: header y main a ancho completo,
backdrop separado del drawer, `drawer-header` y `drawer-body`, scroll interno
del drawer, Escape para cerrar overlays y menu de cuenta, panel derecho con
scroll interno y cards sin assets mas compactas. No cambia ningun flujo
funcional.

## LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

La capa visual inicial se simplifica sin tocar flujos funcionales. El header
prepara slot de icono de app, elimina el eyebrow `HSL`, mantiene conexión,
tema y cuenta compacta, y retira `Actualizar estado` de la primera capa.

El panel derecho queda centrado en hero, título, metadata compacta, chips de
estado humanos, botonera `Jugar`/`Practicar`/`Manual`/`Ranking` y actividad
local resumida dentro del pack. `Comprobar de nuevo`, diagnóstico, runtime,
directorio, readiness técnico, membership técnico, logs y `sync-plugin` siguen
en avanzado, abierto con `Ctrl+Shift+D`.

La biblioteca muestra `Biblioteca` + contador, búsqueda compacta, temporada y
vistas `Portadas`, `Lista`, `Iconos`. `Reescanear` pasa a `Gestionar
biblioteca` y el filtro `Estado` sale de la primera capa.
