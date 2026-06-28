# LOCAL-LAUNCHER-LIBRARY-CARDS-1

Pulido de la biblioteca local de packs.

## Vistas

La biblioteca mantiene exactamente tres vistas:

- `Portadas`: grid visual de cards con cover/icon/logo, estrella, estado arriba
  a la derecha, titulo y semana.
- `Lista`: filas compactas con miniatura, titulo, semana y estado a la derecha.
- `Iconos`: grid denso de iconos pequenos con nombre corto.

No existe `Vista de logos` ni una vista `Logos`.

## Cards

Las cards ya no muestran botones `Activo`, `Seleccionar` o `Ya activo`. La card
completa activa el pack cuando el pack es seleccionable. El pack activo se marca
con borde/acento y badge `Activa`.

La primera capa muestra:

- titulo bonito;
- semana/temporada limpia;
- estrella de favorito;
- estado `Activa`, `Instalado`, `Inactiva`, `Con avisos` o `Con errores`;
- badge discreto `Legacy` cuando corresponde.

La primera capa no muestra:

- UUIDs;
- `packId` tecnico como protagonista;
- `weekId` largo;
- rutas locales;
- `packVersion`;
- explicaciones deprecated;
- botones tecnicos dentro de la card.

## Titulo Y Semana

El titulo se resuelve con esta prioridad:

```text
metadata.title
pack.title
gameId humanizado
packId humanizado
rom humanizada
Pack local
```

Ejemplo:

```text
space-invaders-dev-pack -> Space Invaders
```

La semana usa `weekNumber` si existe. Si solo hay un `weekId` simple como
`week-1`, se muestra `Semana 1`. Si el identificador no es legible, no se usa
como texto protagonista.

## Favoritos

La estrella es funcional y local. Se guarda en:

```text
userData/library/favorites.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "favorites": {
    "space-invaders-week-1": true
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

Los favoritos no requieren sesion, no se envian al backend y no tocan scoped
queue ni puntuaciones.

## Preferencias

La ultima vista y la anchura de la sidebar se guardan por usuario logueado en:

```text
userData/players/<playerKey>/preferences/library.json
```

Sin sesion se usa fallback global:

```text
userData/library/preferences.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "libraryView": "covers",
  "sidebarWidth": 440,
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

Vistas validas:

```text
covers
list
icons
```

Una vista invalida vuelve a `covers`. JSON corrupto no crashea y usa defaults.

## Sidebar

La biblioteca tiene un resizer vertical entre la sidebar y el detalle. Puede
arrastrarse con el raton o ajustarse con teclado:

- flecha izquierda/derecha;
- `Home` vuelve al ancho por defecto.

Limites:

```text
minimo: 360px
default: 440px
maximo: 600px
```

La anchura se guarda en la misma preferencia de biblioteca.

## Legacy

Los packs legacy siguen operativos y filtrables, pero ya no forman un grupo
protagonista por defecto. Se integran como juegos normales y muestran badge
discreto `Legacy`.

## No Cambia

No se toca MAME, runtime, plugin, captura v2, payload, duplicateKey, endpoints,
RLS, membership, auto-sync, scoped queue, contrato de packs, catalogo remoto,
descarga/instalacion, competicion v2 ni `config.json`.

## Pendiente

- Favoritos con ordenacion o filtro especifico.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

El pulido futuro del menu de cuenta ya queda aplicado en una tarea posterior:
selector compacto, filas completas para cambiar, check de cuenta activa, boton
de olvidar por icono y login compacto. No cambia favoritos, preferencias de
biblioteca ni seleccion de packs.

## Continuidad LOCAL-LAUNCHER-ICON-SYSTEM-1

La biblioteca usa el sistema local de iconos para `view-covers.svg`,
`view-list.svg`, `view-icons.svg`, `star-empty.svg`, `star-filled.svg`,
`calendar.svg`, `check.svg`, `warning.svg` y `error.svg`. La persistencia de
favoritos y preferencias no cambia.
