# LOCAL-LAUNCHER-FAVORITES-SCOPED-2

Separacion de favoritos de biblioteca por cuenta activa.

## Aplicado

- Con sesion activa, los favoritos se guardan en:

```text
userData/players/<playerKey>/preferences/favorites.json
```

- Sin sesion, se mantiene el fallback anonimo:

```text
userData/library/favorites.json
```

- El renderer no cambia contrato visual: sigue recibiendo `pack.favorite` en el
  estado de biblioteca.
- Cambiar de cuenta refresca las estrellas visibles porque el estado lee el
  mapa de favoritos del `playerKey` activo.
- Cerrar sesion o olvidar una cuenta no borra favoritos, colas ni puntuaciones
  locales.

## Migracion

No se migran automaticamente favoritos antiguos desde `userData/library` a una
cuenta. Ese archivo queda como favoritos anonimos para evitar mezclar
preferencias entre jugadores.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, instalacion,
competicion v2, configuracion ni rediseño de biblioteca.
