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
