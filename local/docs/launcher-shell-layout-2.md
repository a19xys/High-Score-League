# LOCAL-LAUNCHER-SHELL-LAYOUT-2

La GUI local se reorganiza como shell de escritorio de dos paneles.

## Layout

- `app-shell` ocupa `100vh`, usa header fijo y evita scroll global en `body`.
- `app-main` ocupa el resto de la ventana.
- La biblioteca vive en el panel izquierdo con scroll propio.
- El detalle del juego vive en el panel derecho con una columna estable.
- Actividad local y opciones avanzadas se abren como drawer sobre la app.

El minimo de ventana Electron queda en `1200x780`. El CSS sigue degradando con
overflow interno, pero la app no intenta ser una experiencia movil.

## Header

El header muestra marca HSL, titulo del launcher, subtitulo corto, estado de
conexion, refresco, tema y cuenta compacta. La cuenta abre un menu con:

- cuenta activa;
- formulario de inicio de sesion;
- cuentas recordadas;
- cambio rapido si existe sesion guardada;
- quitar cuenta recordada;
- cerrar sesion sin borrar puntuaciones.

El bloque grande de cuenta ya no forma parte de la primera capa.

## Primera Capa

La pantalla principal queda centrada en jugar:

- biblioteca local;
- pack seleccionado;
- estado resumido;
- `Jugar`;
- `Practicar`;
- `Ver manual`;
- `Ver ranking`;
- actividad local resumida;
- entrada a opciones avanzadas.

La cola local ya no vive dentro del hero del juego.

## Actividad Local

La primera capa muestra solo resumen:

```text
Actividad local
0 pendientes · 6 enviadas · 0 errores
Ver detalles
```

El drawer de actividad conserva `Subir pendientes`, pendientes, enviadas,
`Puntuaciones con error`, restauracion de failed y detalles tecnicos del scope
activo. No muestra JSON crudo ni tokens.

## Opciones Avanzadas

La pantalla principal muestra una entrada compacta. El drawer avanzado contiene
diagnostico, runtime MAME, directorio de packs, readiness tecnico, membership,
colas, legacy/deprecated, mensajes y `sync-plugin`.

Las rutas largas, `session.json`, staging, scope, HTTP status/body, runtime y
legacy quedan fuera de la primera capa.

## Biblioteca

La biblioteca conserva busqueda, filtros, temporadas y tres vistas oficiales:

- Vista de portadas.
- Vista de lista.
- Vista de iconos.

No existe `Vista de logos`. La gestion del directorio queda como accion
secundaria `Gestionar biblioteca`.

## No Cambia

Esta tarea no toca MAME, runtime, plugin, payload, duplicateKey, endpoints,
RLS, membership, scoped queue, auto-sync, contrato de packs, catalogo,
descarga, favoritos, competicion v2 ni legacy funcional.

## Bugfix LOCAL-LAUNCHER-SHELL-BUGFIX-3

La consolidacion posterior corrige problemas estructurales del shell:

- `html`, `body`, `#app`, header y main ocupan todo el ancho.
- El drawer separa `drawer-header` y `drawer-body`, con scroll solo en el body.
- El backdrop usa `data-overlay-backdrop`; los clicks internos no cierran el
  drawer por propagacion.
- `Escape` cierra drawers y menu de cuenta.
- El panel derecho usa scroll interno robusto en alturas reducidas.
- Las cards sin assets se compactan y `Legacy` queda como badge secundario.

## Visual Foundation LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

La estructura de shell se conserva, pero la primera capa se limpia:

- header con slot de icono local y sin eyebrow `HSL`;
- controles superiores en píldoras para conexión, tema y cuenta;
- sin botón de refresco visible en el header;
- detalle del pack con chips humanos y sin identificadores técnicos;
- botonera 2x2: `Jugar`, `Practicar`, `Manual`, `Ranking`;
- actividad local integrada como subtarjeta del pack;
- `Opciones avanzadas` fuera de la primera capa, accesible con
  `Ctrl+Shift+D`;
- biblioteca más ancha, con contador `pack`, sin filtro `Estado` visible y sin
  `Reescanear` protagonista.

El drawer avanzado sigue conteniendo diagnóstico, runtime MAME, directorio de
packs, membership, readiness, colas, legacy y `sync-plugin`. El drawer de
actividad conserva pendientes, enviadas, failed recuperable y subida manual.

## Continuidad LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1

El shell de dos columnas se conserva. La biblioteca reduce ligeramente su ancho
maximo y el panel derecho usa una ficha mas contenida: banner horizontal,
detalle scrolleable, metadata legible, acciones 2x2 y actividad integrada. Los
drawers y atajos avanzados no cambian.
