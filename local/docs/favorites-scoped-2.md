# LOCAL-LAUNCHER-FAVORITES-SCOPED-2

Separacion de favoritos de biblioteca por cuenta activa.

## Aplicado

- Con sesion activa, los favoritos se guardan en:

```text
userData/players/<playerKey>/preferences/favorites.json
```

- Sin sesion ya no hay favoritos editables en la UI normal. El archivo global
  queda solo como legado/anónimo desactivado:

```text
userData/library/favorites.json
```

- El renderer sigue recibiendo `pack.favorite` en el estado de biblioteca con
  sesion activa.
- Cambiar de cuenta refresca las estrellas visibles porque el estado lee el
  mapa de favoritos del `playerKey` activo.
- Cerrar sesion o olvidar una cuenta no borra favoritos, colas ni puntuaciones
  locales.
- `LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2` reorganiza los controles visuales
  de biblioteca sin cambiar esta persistencia: la estrella sigue usando
  `pack.favorite` del scope activo.

## Migracion

No se migran automaticamente favoritos antiguos desde `userData/library` a una
cuenta. Ese archivo queda como legado para evitar mezclar preferencias entre
jugadores y no se usa como perfil activo normal sin sesion.

## Continuidad LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4

La UI deshabilita la estrella sin sesion, el renderer no llama al toggle y el
servicio rechaza la accion sin escribir favoritos anonimos nuevos.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, instalacion,
competicion v2, configuracion ni rediseño de biblioteca.
