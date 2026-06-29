# LOCAL-LAUNCHER-HERO-LOGO-LIST-PRELOAD-13

Pulido acotado de assets visuales en el launcher local.

## Alcance

- Solo cambia presentacion del renderer y precarga visual de imagenes.
- No cambia MAME, runtime, plugin, captura, payloads, endpoints, RLS,
  membership, scoped queue, auto-sync, catalogo, configuracion ni menu de
  cuenta.
- No cambia el contrato de packs ni la resolucion de rutas de assets.
- Mantiene la estabilidad de `LOCAL-LAUNCHER-RENDER-STATE-STABILITY-AUDIT-12`:
  las preferencias visibles siguen ganando ante persistencias tardias y los
  iconos no vuelven a un estado pendiente visible.

## Hero Y Logo

El logo del pack activo ya no se renderiza junto al titulo de la ficha. Ahora
se coloca dentro del banner de detalle como overlay centrado:

```text
hero o cover como fondo escenico
+ overlay sutil
+ logo o icon centrado
```

El banner conserva altura controlada:

- `aspect-ratio: 1920 / 620`;
- `max-height: 220px`;
- `overflow: hidden`;
- `object-fit: cover` para la imagen ambiental.

No se usa `max-height: none`. El fondo se recorta dentro del stage y aplica un
leve oscurecimiento/blur para que el logo tenga lectura sin convertir el hero
en una tarjeta gigante.

Si no existe `hero`, se usa `cover`. Si no existe `logo`, se usa `icon`. Si no
hay imagen ambiental, se mantiene el placeholder HSL; si hay logo sobre
placeholder, el texto interno del placeholder queda oculto para no competir.

## Lista

La vista `Lista` conserva el tamano visual de icono (`42px`) y anade una ventana
redondeada con clipping:

- `width` y `height` fijos de `42px`;
- `overflow: hidden`;
- `border-radius: 8px`;
- `object-fit: cover` en la imagen.

Esto evita que iconos con bordes o transparencias sobresalgan de la fila sin
reducir el tamano percibido.

## Precarga Al Seleccionar Pack

Al seleccionar un pack desde la biblioteca, el renderer precarga los assets que
se veran en la ficha de detalle:

- del pack visible: `hero || cover` y `logo || icon`;
- del estado devuelto tras activar el pack: `game.assets.hero || cover` y
  `game.assets.logo || icon`.

La precarga usa `new Image()` y un timeout de `600ms`. No bloquea
indefinidamente: si una imagen no carga a tiempo, la activacion sigue y el
navegador la terminara de resolver por su cuenta.

Cada seleccion incrementa una secuencia local. Si el usuario selecciona otro
pack mientras el anterior sigue activandose, solo la ultima secuencia puede
actualizar el estado visible. Esto mantiene la regla de "ultima seleccion gana"
sin tocar la logica de preferencias de biblioteca.

Mientras una seleccion esta en curso, el pack pendiente recibe
`pack-card--pending` y `aria-busy="true"`. La activacion no bloquea la
seleccion de otro pack, pero otras acciones globales siguen usando el estado
`busy` existente.

## Validacion

Los tests cubren:

- logo centrado dentro de `game-hero-stage`;
- hero acotado, sin `max-height: none`;
- lista con clipping redondeado;
- ausencia de `ui-icon--pending`;
- precarga con `DETAIL_ASSET_PRELOAD_TIMEOUT_MS = 600`;
- proteccion por `libraryPackSelectionSequence`.
