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
