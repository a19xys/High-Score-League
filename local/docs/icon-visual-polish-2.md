# LOCAL-LAUNCHER-ICON-VISUAL-POLISH-2

Pulido visual de iconos, botones, metadata, portadas y barra inferior del
launcher.

## Aplicado

- El boton de tema queda como icono puro, sin texto visible.
- El estado de conexion queda como punto coloreado + texto, sin SVG.
- Los contenedores de iconos dejan de pintar fondos coloreados por defecto.
- Los botones `Jugar`, `Practicar`, `Manual` y `Ranking` ganan tamano,
  alineacion e iconos mas visibles.
- `Ver detalles` pasa a boton ovalado con `chevron-right.svg`.
- La metadata del juego reserva siempre cuatro huecos: desarrollador, ano,
  genero y tiempo jugado. Si falta un dato se muestra `Sin datos`.
- Las portadas de biblioteca usan `aspect-ratio: 2 / 3` para caratulas 600x900.
- Los iconos de vistas `Portadas`, `Lista` e `Iconos` quedan mas compactos.
- Se anade footer visual con `check.svg`, `Launcher actualizado` y `v1.0.0`.

## Fuera de alcance

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS,
membership, scoped queue, auto-sync, contrato de packs, catalogo, descarga,
instalacion ni competicion v2.

Quedan para tareas futuras favoritos scoped, comportamiento fino del menu de
cuenta, controles de biblioteca y estabilidad completa de vista `Iconos`.
