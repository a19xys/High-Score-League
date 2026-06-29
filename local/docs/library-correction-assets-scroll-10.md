# LOCAL-LAUNCHER-LIBRARY-CORRECTION-ASSETS-SCROLL-10

Correccion de scrollbar visual, lista, foco, badges y assets de packs.

## Scrollbar

Se elimina el indicador flotante que simulaba un thumb en
`.library-section--packs::after`. Chromium/Electron no ofrece una forma fiable
y sencilla de mostrar un thumb nativo full-height cuando el contenedor no tiene
overflow.

Decision vigente:

- se conserva `overflow-y: scroll`;
- se conserva `scrollbar-gutter: stable`;
- no hay pseudo-elemento ni segunda linea azul;
- si no hay overflow, se acepta carril reservado sin thumb antes que un thumb
  falso fuera del carril.

## Lista

La estrella de favorito mantiene caja cuadrada de `28px`. La fila `Lista`
aumenta el padding izquierdo para separar favorito, miniatura y texto sin
reducir la estrella.

## Alineacion

- `Pack local` conserva `inline-flex` y el calendario vuelve a centrarse sin
  desplazamiento vertical artificial.
- `Añadir ubicación` / `Cambiar ubicación` y `Filtros` centran icono y texto
  con `align-items: center` y spans de linea estable.

## Selects Y Foco

Se mantiene un intento CSS para `option:hover`, pero `option:checked` no recibe
color especial. El popup de `select` es nativo y en Windows/Chromium puede no
respetar todo el hover.

Los campos de filtro ya no usan un `label` envolvente que enfoque el input o
select al pulsar alrededor. Ahora usan `aria-labelledby`; solo el control real
recibe foco visual.

## Estado De Semana

`ABIERTO` usa `week-status-badge week-status--open` y color verde real. La causa
del bug era `color: currentColor` en el propio badge, que heredaba blanco y
pisaba la clase `week-status--open`.

Preparado:

- `week-status--open`: verde;
- `week-status--ending`: morado;
- `week-status--closed`: amarillo warning.

## Assets Convencionales

Ademas de `metadata.assets`, el loader detecta assets convencionales en:

```text
pack/assets/
```

Prioridad:

1. `metadata.assets.cover/icon/hero/logo` valido;
2. `assets/cover.*`, `assets/icon.*`, `assets/hero.*`, `assets/logo.*`;
3. fallback visual HSL/iniciales.

Extensiones convencionales:

- `cover`, `hero`, `logo`: `.png`, `.jpg`, `.jpeg`, `.webp`;
- `icon`: `.png`, `.jpg`, `.jpeg`, `.webp`, `.ico`.

La biblioteca usa `cover` para `Portadas` e `icon` para `Lista`/`Iconos`, con
fallback entre `cover` e `icon`. `hero` y `logo` quedan disponibles para detalle
pero no se usan como fallback de cards de biblioteca.

## Seguridad

Las rutas declaradas en metadata siguen rechazando:

- URLs remotas;
- rutas absolutas;
- rutas con `../` que salgan del pack;
- extensiones no permitidas.

Los assets convencionales no bloquean el pack si faltan.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, backend, endpoints, RLS, membership,
scoped queue, auto-sync, catalogo, instalacion, desinstalacion ni estados web
reales.
