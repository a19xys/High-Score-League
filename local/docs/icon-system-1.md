# LOCAL-LAUNCHER-ICON-SYSTEM-1

Sistema local de iconos PNG para la GUI Electron del launcher.

## Objetivo

La GUI usa iconos locales PNG blancos, normalmente con fondo transparente. Los
componentes renderizan iconos por nombre logico, buscan PNG locales y mantienen
fallback seguro si el archivo aun no existe.

No se toca MAME, runtime, plugin, captura, payload, `duplicateKey`, endpoints,
RLS, membership, scoped queue, auto-sync, contratos de pack, catalogo remoto,
descarga/instalacion, competicion v2, legacy ni `config.json`.

## Carpeta

Los PNG de la app viven en:

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
renderIcon("download", { className: "action-icon", label: "Jugar" })
```

El helper:

- mapea nombre logico a `./assets/icons/<archivo>.png`;
- no usa URLs remotas;
- no inserta SVG raw;
- escapa fallback y clases;
- usa un `<img>` oculto solo como probe de carga;
- aplica el PNG como `mask-image` / `-webkit-mask-image`;
- pinta el icono con `background: currentColor`;
- muestra fallback textual si el PNG falta;
- usa `aria-hidden="true"` para iconos decorativos o `aria-label` si se pasa
  `label`.

## Tintado

Los PNG deben ser blancos sobre transparencia. La app los pinta con mascara CSS:

```css
mask: var(--icon-url) center / contain no-repeat;
-webkit-mask: var(--icon-url) center / contain no-repeat;
background: currentColor;
```

Asi cada boton, chip o estado controla el color mediante `color`, sin necesitar
varias versiones del mismo PNG.

## Renombres desde la fase SVG

| Antes | Ahora | Uso |
| --- | --- | --- |
| `play.svg` | `download.png` | Boton Jugar |
| `manual.svg` | `book-open.png` | Boton Manual |
| `developer.svg` | `publisher.png` | Desarrollador/Publicadora |
| `year.svg` | `calendar.png` | Ano y semana/temporada |
| `playtime.svg` | `clock.png` | Tiempo jugado |
| `star-filled.svg` | `star.png` | Favorito activo |

## CSS

Las clases base son:

```text
ui-icon
ui-icon--sm
ui-icon--md
ui-icon--lg
action-icon
meta-icon
status-icon
library-view-icon
favorite-icon
account-icon
```

`ui-icon` convive con los slots anteriores (`icon-slot--play`, etc.) para que
los estilos existentes sigan encontrando nombres de zona, pero el archivo real
lo resuelve el helper PNG.

## Usos

Header:

- `app.png` para el icono HSL;
- `sun.png` y `moon.png` para tema;
- `status-online.png`, `status-offline.png`, `status-reconnecting.png` para
  conexion;
- `user.png` para estado sin cuenta.

Botonera principal:

- `download.png` para `Jugar`;
- `practice.png` para `Practicar`;
- `book-open.png` para `Manual`;
- `ranking.png` para `Ranking`.

Metadata del juego:

- `publisher.png` para desarrollador o publicadora;
- `calendar.png` para ano;
- `genre.png` para genero;
- `clock.png` para tiempo de juego;
- `calendar.png` tambien para semana/temporada.

Actividad local:

- `sync-ok.png`;
- `sync-pending.png`;
- `sync-error.png`.

Biblioteca:

- `view-covers.png`;
- `view-list.png`;
- `view-icons.png`;
- `star-empty.png`;
- `star.png`;
- `calendar.png`;
- `check.png`;
- `warning.png`;
- `error.png`.

Menu de cuenta:

- `user.png`;
- `check.png`;
- `add.png`;
- `logout.png`;
- `forget-account.png`;
- `email.png`;
- `password.png`.

## Iconos que debe anadir el usuario

| Archivo esperado | Uso en la interfaz | Prioridad |
| --- | --- | --- |
| `app.png` | Icono de app en header | Recomendado |
| `sun.png` | Tema claro | Recomendado |
| `moon.png` | Tema oscuro | Recomendado |
| `status-online.png` | Estado conectado | Recomendado |
| `status-offline.png` | Estado sin Internet | Recomendado |
| `status-reconnecting.png` | Estado reconectando | Recomendado |
| `user.png` | Cuenta generica o sin cuenta | Recomendado |
| `download.png` | Boton Jugar | Recomendado |
| `practice.png` | Boton Practicar | Recomendado |
| `book-open.png` | Boton Manual | Recomendado |
| `ranking.png` | Boton Ranking | Recomendado |
| `publisher.png` | Metadata Desarrollador/Publicadora | Recomendado |
| `calendar.png` | Ano y semana/temporada | Recomendado |
| `genre.png` | Metadata Genero | Recomendado |
| `clock.png` | Metadata Tiempo jugado | Recomendado |
| `sync-ok.png` | Actividad sincronizada | Recomendado |
| `sync-pending.png` | Actividad pendiente | Recomendado |
| `sync-error.png` | Actividad con error | Recomendado |
| `view-covers.png` | Vista Portadas | Recomendado |
| `view-list.png` | Vista Lista | Recomendado |
| `view-icons.png` | Vista Iconos | Recomendado |
| `star-empty.png` | Favorito vacio | Recomendado |
| `star.png` | Favorito activo | Recomendado |
| `check.png` | Cuenta activa y estados correctos | Recomendado |
| `warning.png` | Avisos | Recomendado |
| `error.png` | Errores | Recomendado |
| `info.png` | Fallback para iconos desconocidos | Recomendado |
| `add.png` | Anadir cuenta | Recomendado |
| `logout.png` | Cerrar sesion | Recomendado |
| `forget-account.png` | Olvidar cuenta | Recomendado |
| `email.png` | Campo email del login | Recomendado |
| `password.png` | Campo contrasena del login | Recomendado |
| `close.png` | Cierre de overlays preparado | Opcional |
| `connection.png` | Estado generico de conexion preparado | Opcional |

## Fallbacks

Si falta un PNG:

- el probe oculto marca el icono como missing;
- no hay imagen rota visible;
- se muestra un fallback corto (`HSL`, `>`, `P`, `OK`, etc.);
- no se hacen requests externos;
- no se rompe el render;
- no se muestran secretos.

## Validacion

Los tests protegen:

- nombres exactos de archivos PNG esperados;
- ruta local `./assets/icons/`;
- clase `ui-icon`;
- mascara CSS con `currentColor`;
- fallback `ui-icon__fallback`;
- ausencia de URLs remotas;
- iconos en header, botonera, metadata, actividad, biblioteca y cuenta;
- ausencia de tokens en renderer.
