# LOCAL-LAUNCHER-RENDER-STATE-STABILITY-AUDIT-12

Auditoria y estabilizacion minima de render, estado, preferencias e iconos de
la biblioteca local.

## Renderer

El renderer actual usa un store pequeno en `gui/renderer/state.js`. Cada
`store.setState()` llama a `render()` en `gui/renderer/app.js`.

`render()` reconstruye todo `#app` con `innerHTML`: header, biblioteca,
resizer, detalle, footer y overlay. Antes de hacerlo guarda `scrollTop` de
`.game-scroll` y `.library-section--packs`, y despues lo restaura. No conserva
foco ni nodos DOM de inputs, selects, botones, cards o imagenes.

Consecuencias:

- cambiar vista reconstruye toda la biblioteca y tambien el panel derecho;
- cambiar `ORDENAR` reconstruye filtros, lista de packs, iconos y selects;
- abrir/cerrar filtros reconstruye el arbol completo;
- los nodos `<img>` de iconos de la interfaz se recrean en cada render;
- los `<img>` de assets de packs tambien se recrean al cambiar vista o filtros;
- el scroll principal se conserva solo en los dos contenedores citados.

No se hizo un refactor grande para render incremental. La estabilizacion se
limita a que las respuestas asincronas no vuelvan a pisar el estado visible y a
que los iconos ya cargados no pasen otra vez por un estado visual indefinido.

## Estado Y Persistencia

Estados revisados:

- `libraryView`;
- `librarySidebarWidth`;
- `libraryQuery`;
- `librarySeason`;
- `librarySortBy`;
- `librarySortDirection`;
- `libraryFavoriteFilter`;
- `libraryFiltersOpen`;
- `selectedPack` via `state.data`;
- `activeAccount/session` via `state.data.session`.

Persistencia revisada:

- `libraryView`, `librarySortBy`, `librarySortDirection` y `sidebarWidth` viven
  en `userData/.../preferences/library.json`;
- con sesion se guardan por `playerKey`;
- sin sesion usan fallback global;
- favoritos siguen separados en `favorites.json` por cuenta activa.

La causa real o riesgo principal era que `persistLibraryPreferences()` esperaba
`setLibraryPreferences` y, cuando el servicio devolvia `state`, el renderer
volvia a aplicar `state.library.preferences` sobre `libraryView`,
`librarySortBy`, `librarySortDirection` y `librarySidebarWidth`.

Si dos escrituras terminaban fuera de orden, o si una lectura inicial tardia
llegaba despues de una interaccion del usuario, una preferencia antigua podia
devolver la UI a una vista o a un orden anterior.

Regla vigente:

```text
El estado visible del usuario gana inmediatamente.
La persistencia es write-only para la UI visible.
Una respuesta tardia no puede rehidratar vista, orden ni anchura.
```

## Cambios Aplicados

- Se anadio una revision local de preferencias en el renderer.
- La hidratacion desde `getState()` solo aplica preferencias si no hubo una
  interaccion local mas reciente durante la peticion.
- Las preferencias se hidratan una vez por scope de preferencias.
- Las escrituras de preferencias ya no aplican `response.state` al estado
  visible.
- Cada escritura manda el snapshot visible completo de preferencias, no solo el
  campo cambiado, para que dos escrituras parciales concurrentes no dejen en
  disco una combinacion antigua.
- Las escrituras obsoletas no generan logs de error si ya hubo una escritura
  mas reciente.
- `libraryView` pasa a persistirse con el mismo debounce que `ORDENAR`.

Esto mantiene el cambio de vista inmediato y evita que una escritura tardia
reconstruya la UI o recupere un valor viejo.

## Ordenar

`Temporada` solo actualiza estado local. `ORDENAR` hacia dos cosas:

1. actualizaba estado local;
2. disparaba persistencia de preferencias.

El primer render al cambiar el `select` es normal porque la lista se reordena.
El problema de estabilidad venia de renders posteriores provocados por la
respuesta de persistencia, que podia llegar cuando el usuario intentaba abrir
el select otra vez. Esos renders desmontaban el `select` nativo y cerraban el
popup.

La correccion evita el render posterior de persistencia. `ORDENAR` queda mas
parecido a `Temporada`: el estado local cambia al instante y cualquier guardado
en disco queda desacoplado del control nativo.

No se uso `setTimeout` ni un hack de foco.

## Iconos

`renderIcon()` renderiza SVG locales con `<img>` y fallback textual. El fallback
CSS ya estaba oculto por defecto, pero cada render creaba nuevos `<img>`.
Aunque el navegador tuviera la imagen en cache, el `onload` volvia a ejecutarse
para todos los iconos montados otra vez.

Riesgos detectados:

- si un icono aun no habia marcado `loaded`, podia pasar visualmente por un
  estado intermedio durante remounts frecuentes;
- si un SVG faltaba, el fallback podia aparecer correctamente, pero fallbacks
  como `D` o `F` no deben aparecer para iconos que existen;
- una solucion con clase `pending` visible o transiciones globales podria
  provocar parpadeo en toda la interfaz.

Cambio aplicado:

- `renderIcon()` mantiene una cache ligera en `globalThis.__hslIconLoadState`;
- si un icono ya cargo una vez, se renderiza con `ui-icon--loaded` desde el
  inicio;
- si un icono fallo de verdad, se renderiza con `ui-icon--missing`;
- el fallback sigue oculto por defecto y solo se muestra en `ui-icon--missing`;
- no se introdujo estado `pending`.

Confirmacion:

```text
fallback visible solo tras error real
sin pending global
sin parpadeo provocado por clases de carga en cada render
```

## Hero Y Assets

No se redisenaron hero ni logo.

Regla preservada:

```text
El hero crece hasta un limite y despues hace zoom/crop.
No usar max-height: none en .game-hero-stage.
```

El comportamiento vigente mantiene `max-height: 220px` en `.game-hero-stage`.
El logo dentro del hero queda pendiente para una tarea visual posterior.

Lista e Iconos tampoco se redisenaron. Queda pendiente mantener assets reales
grandes dentro de una caja redondeada que contenga bien las esquinas, sin
reducir su tamano visual.

## No Tocado

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS,
membership, scoped queue, auto-sync, catalogo, instalacion, desinstalacion,
estados remotos reales, `config.json`, menu de cuenta, panel derecho completo
ni logica competitiva.

## Tests

Se actualizaron tests de contrato para proteger:

- persistencia de vista mediante debounce;
- ausencia de reaplicacion de `response.state` sobre preferencias visibles;
- guardas contra lecturas tardias de preferencias;
- cache de carga de iconos;
- fallback de iconos solo via estado `missing`;
- ausencia de `ui-icon--pending`;
- `max-height: 220px` del hero y ausencia de `max-height: none`;
- mantenimiento de tiles de `Iconos` en `122px` y assets de `Lista`/`Iconos`
  sin reduccion nueva.

## Pendientes

- Refactor incremental del renderer para no reconstruir todo `#app` en cada
  cambio de estado.
- Logo dentro del hero sin romper el limite de altura y crop.
- Assets reales de `Lista` e `Iconos` grandes dentro de caja redondeada.
- Prueba manual en Electron con cambios rapidos de vista, `ORDENAR` y resize de
  sidebar.
