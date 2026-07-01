# LOCAL-LAUNCHER-ICON-SYSTEM-1

Sistema local de iconos SVG para la GUI Electron del launcher.

## Objetivo

La GUI usa iconos SVG locales con un glyph visible tintable mediante mascara
CSS y `currentColor`. El `<img>` local se conserva solo como detector de
carga/error para mantener el fallback textual seguro si el archivo no existe.

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS,
membership, scoped queue, auto-sync, contratos de pack, catalogo remoto,
descarga/instalacion, competicion v2 ni `config.json`.

## Carpeta

Los SVG de la app viven en:

```text
local/hsl-local-app/gui/renderer/assets/icons/
```

La carpeta pertenece a la app Electron, no a los packs. Los assets de packs
siguen viviendo en `pack/assets/` y se resuelven con el loader de metadata.

## Helper

El helper esta en:

```text
local/hsl-local-app/gui/renderer/components/icon.js
```

Uso:

```js
renderIcon("play", { className: "action-icon", label: "Jugar" })
```

El helper:

- mapea nombre logico a `./assets/icons/<archivo>.svg`;
- no usa URLs remotas;
- no inserta SVG raw;
- escapa fallback y clases;
- renderiza el icono visible como `<span class="ui-icon__glyph">`;
- aplica `--icon-url: url('./assets/icons/<archivo>.svg')` al wrapper;
- usa `background-color: currentColor` y mascara CSS para tintar el glyph;
- mantiene `<img class="ui-icon__img">` como detector invisible de carga/error;
- oculta el fallback cuando el SVG carga;
- oculta el glyph/imagen y muestra fallback si el SVG falla;
- recuerda en memoria los iconos ya cargados o fallidos para que un re-render
  normal no vuelva a pasar por un estado visual intermedio;
- usa `aria-hidden="true"` para iconos decorativos o `aria-label` si se pasa
  `label`.

## Nombres restaurados

| Uso | Archivo SVG |
| --- | --- |
| Boton Jugar | `play.svg` |
| Boton Manual | `manual.svg` |
| Desarrollador/Publicadora | `developer.svg` |
| Ano | `year.svg` |
| Tiempo jugado | `playtime.svg` |
| Favorito activo | `star-filled.svg` |
| Favorito vacio | `star-empty.svg` |
| Semana/temporada | `calendar.svg` |
| Ver detalles | `chevron-right.svg` |

## CSS

El sistema SVG no usa SVG inline, probe oculto ni PNG externos. Las clases base
son:

```text
ui-icon
ui-icon--sm
ui-icon--md
ui-icon--lg
ui-icon__glyph
ui-icon__img
ui-icon__fallback
action-icon
meta-icon
status-icon
library-view-icon
favorite-icon
account-icon
```

`ui-icon` convive con los slots anteriores (`icon-slot--play`, etc.) para que
los estilos existentes sigan encontrando nombres de zona, pero el archivo real
lo resuelve el helper SVG.

## Usos

Header:

- `app.svg` para el icono HSL;
- `sun.svg` y `moon.svg` para tema;
- `status-online.svg`, `status-offline.svg`, `status-reconnecting.svg` para
  conexion;
- `user.svg` para estado sin cuenta.

Botonera principal:

- `play.svg` para `Jugar`;
- `practice.svg` para `Practicar`;
- `manual.svg` para `Manual`;
- `ranking.svg` para `Ranking`.

Metadata del juego:

- `developer.svg` para desarrollador o publicadora;
- `year.svg` para ano;
- `genre.svg` para genero;
- `playtime.svg` para tiempo de juego;
- `calendar.svg` para semana/temporada.

Actividad local:

- `sync-ok.svg`;
- `sync-pending.svg`;
- `sync-error.svg`.
- `chevron-right.svg` para `Ver detalles`.

Biblioteca:

- `view-covers.svg`;
- `view-list.svg`;
- `view-icons.svg`;
- `star-empty.svg`;
- `star-filled.svg`;
- `calendar.svg`;
- `check.svg`;
- `warning.svg`;
- `error.svg`.

Menu de cuenta:

- `user.svg`;
- `check.svg`;
- `add.svg`;
- `logout.svg`;
- `forget-account.svg`;
- `email.svg`;
- `password.svg`.

## Iconos que debe anadir el usuario

```text
app.svg
sun.svg
moon.svg
status-online.svg
status-offline.svg
status-reconnecting.svg
user.svg
play.svg
practice.svg
manual.svg
ranking.svg
developer.svg
year.svg
genre.svg
playtime.svg
calendar.svg
chevron-right.svg
sync-ok.svg
sync-pending.svg
sync-error.svg
view-covers.svg
view-list.svg
view-icons.svg
star-empty.svg
star-filled.svg
check.svg
warning.svg
error.svg
info.svg
add.svg
logout.svg
forget-account.svg
email.svg
password.svg
close.svg
connection.svg
```

## Fallbacks

Si falta un SVG:

- el `img` marca el icono como missing;
- no queda imagen rota visible;
- se muestra un fallback corto (`HSL`, `>`, `P`, `OK`, etc.);
- no se hacen requests externos;
- no se rompe el render;
- no se muestran secretos.

Desde `LOCAL-LAUNCHER-RENDER-STATE-STABILITY-AUDIT-12`, el fallback permanece
oculto por defecto y solo se muestra tras un `onerror` real. Si un icono ya
cargo una vez, los renders posteriores nacen con `ui-icon--loaded`; si fallo,
nacen con `ui-icon--missing`. No se usa una clase `pending` visible.

## Tintado

Desde `LOCAL-LAUNCHER-ICON-TINT-SYSTEM-FIX-1`, el icono visible ya no es el
`img`, porque CSS `color`/`currentColor` no puede cambiar el fill interno de un
SVG cargado como imagen externa. El wrapper define el color efectivo y el glyph
lo adopta con:

```css
.ui-icon__glyph {
  background-color: currentColor;
  -webkit-mask-image: var(--icon-url);
  mask-image: var(--icon-url);
}
```

El glyph ocupa `width: 100%` y `height: 100%`, por lo que mantiene la misma caja
que antes ocupaba el `img`. Las clases de contexto (`action-icon`,
`status-icon`, `favorite-icon`, `app-brand-icon`, `library-view-icon`, etc.)
siguen controlando tamano, color y alineacion desde el wrapper.

Los SVG pueden ser blancos o contener un PNG monocromo embebido: para la mascara
lo importante es la silueta/alpha, no el color interno. Para nuevos iconos, la
regla sigue siendo usar assets locales monocromos con `viewBox` y sin scripts ni
contenido activo.

## Validacion

Los tests protegen:

- nombres exactos de archivos SVG esperados;
- ruta local `./assets/icons/`;
- clase `ui-icon`;
- render visible con `ui-icon__glyph`;
- tintado con `currentColor` mediante `mask-image` y `-webkit-mask-image`;
- detector local invisible con `ui-icon__img`;
- fallback `ui-icon__fallback`;
- ausencia de PNG externos, SVG inline y URLs remotas en el helper;
- iconos en header, botonera, metadata, actividad, biblioteca y cuenta;
- ausencia de tokens en renderer.
