# LOCAL-LAUNCHER-SHELL-BUGFIX-3

Correccion estructural del shell de escritorio creado en
`LOCAL-LAUNCHER-SHELL-LAYOUT-2`.

## Shell y Header

`html`, `body`, `#app`, `.app-shell`, `.launcher-header` y `.app-main` ocupan
todo el ancho disponible. El shell principal ya no depende de `max-width` ni de
`margin-inline: auto` heredados de la pagina anterior. El padding queda dentro
del header y de los paneles scrolleables, no alrededor de toda la app.

## Drawers

El overlay separa backdrop y contenido:

```text
.modal-layer[data-overlay-backdrop]
  .drawer-layer
    .drawer-header
    .drawer-body
```

El backdrop cierra el drawer solo cuando el click cae sobre el backdrop real.
El boton `x` tambien cierra. Los clicks dentro de `.drawer-layer` no cierran el
drawer por burbujeo, por lo que los botones, detalles y formularios internos
siguen siendo interactuables. `Escape` cierra drawer y menu de cuenta abiertos.

El scroll vive en `.drawer-body`; `.drawer-layer` usa `overflow: hidden` y
grid `auto 1fr`. El header del drawer ya no es `sticky` dentro del mismo
contenedor scrolleable, evitando solapamientos visuales.

## Panel Derecho

El panel derecho mantiene scroll interno en `.game-scroll`. La tarjeta del
juego se alinea arriba, deja de usar distribucion vertical rigida y conserva
altura de botones para que `Jugar`, `Practicar`, `Ver manual` y `Ver ranking`
no queden tapados cuando la ventana tiene poca altura.

## Biblioteca

Las cards sin assets se compactan:

- portadas con media mas baja y altura maxima;
- lista mas compacta;
- iconos mas densos;
- placeholder HSL con iniciales mas pequeno.

## Legacy y Warnings

Legacy/deprecated sigue existiendo y sigue filtrable, pero en la primera capa
se muestra como badge pequeno `Legacy`. Las explicaciones largas permanecen en
opciones avanzadas y detalles tecnicos.

## Cuenta

El menu de cuenta no se cierra al hacer click dentro. Permite iniciar sesion,
anadir cuenta, cambiar, quitar cuenta recordada y cerrar sesion. Puede cerrarse
con click fuera o `Escape`.

## No Cambia

No se toca MAME, runtime, plugin, captura, payload, duplicateKey, endpoints,
RLS, membership, scoped queue, contrato de packs, catalogo, descarga,
favoritos, competicion v2 ni `config.json`.

## Continuidad LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

Sobre esta base estable, la siguiente limpieza visual elimina ruido de la
primera capa sin revertir los bugfixes:

- el header conserva ancho completo y sticky, pero añade slot de icono y quita
  el eyebrow `HSL`;
- los drawers mantienen backdrop/body separados y ahora avanzado se abre con
  `Ctrl+Shift+D` en vez de una tarjeta visible;
- el panel derecho sigue usando scroll interno y ahora contiene también la
  subtarjeta compacta de actividad;
- la biblioteca mantiene scroll propio y compacta cabecera, filtros y vistas;
- legacy sigue soportado y aparece solo como badge `Legacy` en primera capa.
