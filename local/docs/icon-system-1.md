# LOCAL-LAUNCHER-ICON-SYSTEM-1

Sistema local de iconos SVG para la GUI Electron del launcher.

## Objetivo

La GUI usa iconos SVG locales, visibles mediante `<img>`, con fallback textual
seguro si el archivo todavia no existe. La variante PNG con mascaras CSS queda
descartada.

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
- renderiza el SVG local como `<img class="ui-icon__img">`;
- oculta el fallback cuando el SVG carga;
- oculta la imagen y muestra fallback si el SVG falla;
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

## CSS

El sistema SVG no usa mascaras, `--icon-url`, probe oculto ni PNG. Las clases
base son:

```text
ui-icon
ui-icon--sm
ui-icon--md
ui-icon--lg
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

## Validacion

Los tests protegen:

- nombres exactos de archivos SVG esperados;
- ruta local `./assets/icons/`;
- clase `ui-icon`;
- render visible con `ui-icon__img`;
- fallback `ui-icon__fallback`;
- ausencia de PNG, mascaras y URLs remotas en el helper;
- iconos en header, botonera, metadata, actividad, biblioteca y cuenta;
- ausencia de tokens en renderer.
