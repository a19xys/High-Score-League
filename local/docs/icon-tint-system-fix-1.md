# LOCAL-LAUNCHER-ICON-TINT-SYSTEM-FIX-1

## Causa

El sistema anterior renderizaba cada SVG local como:

```html
<img class="ui-icon__img" src="./assets/icons/play.svg" alt="">
```

Aunque el wrapper `.ui-icon` recibiera `color: currentColor`, el navegador no
aplica ese color al contenido interno de una imagen externa. Por eso los SVG
blancos seguian viendose blancos.

## Solucion elegida

Se eligio CSS mask con `background-color: currentColor`.

Motivos:

- funciona con SVG blancos y con SVG que contienen PNG monocromo embebido;
- no requiere inyectar SVG raw ni sanitizar markup en runtime;
- mantiene el color controlado por CSS desde el wrapper;
- conserva el helper sin carga asincrona;
- permite mantener el `<img>` existente como detector de `onload`/`onerror`.

No se eligio inline SVG porque aumenta la complejidad de sanitizacion y carga.
No se eligio `filter` porque acopla el color a filtros dificiles de mantener.

## Contrato visual

La caja exterior sigue siendo `.ui-icon` y sus variantes:

```text
ui-icon
action-icon
status-icon
favorite-icon
app-brand-icon
library-open-icon
library-refresh-icon
library-view-icon
```

El nuevo `.ui-icon__glyph` ocupa `width: 100%` y `height: 100%`, igual que antes
lo hacia la imagen visible. Los tamanos, gaps y alineaciones se controlan en las
mismas clases de contexto.

## Fallback

El fallback textual no se muestra durante el render normal. El helper conserva
el `<img class="ui-icon__img">` con `onload` y `onerror`:

- `onload` marca `ui-icon--loaded`;
- `onerror` marca `ui-icon--missing`;
- `ui-icon--missing` oculta glyph/img y muestra `ui-icon__fallback`.

## Assets

Solo se usan assets locales bajo:

```text
local/hsl-local-app/gui/renderer/assets/icons/
```

No se tocan assets de packs. Para nuevos iconos de la app, usar SVG
monocromos, con `viewBox` y sin `script`, `foreignObject` ni handlers inline.
