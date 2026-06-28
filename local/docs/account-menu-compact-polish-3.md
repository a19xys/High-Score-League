# LOCAL-LAUNCHER-ACCOUNT-MENU-COMPACT-POLISH-3

Compactacion visual del menu de cuenta como selector de perfiles.

## Aplicado

- El chip del header con sesion muestra solo el avatar/siglas; el correo queda
  en `title` y `aria-label`.
- El chip sin sesion muestra `Sin sesión`.
- La cabecera interna del menu mantiene la cuenta actual con avatar/siglas y
  correo visible dentro del panel.
- La lista de cuentas reduce altura y separacion, manteniendo el correo visible
  por fila tras `LOCAL-LAUNCHER-ACCOUNT-MENU-LAYOUT-CORRECTION-4`.
- `Cuentas` queda mas cerca de la lista y con menos letter-spacing.
- El boton global `Cerrar sesión` se retira de la UI normal.
- `Olvidar cuenta` queda integrado visualmente en cada fila, como accion propia
  y separada del boton de cambio.
- El avatar de filas usa caja cuadrada centrada para que iniciales como `TG`
  no queden descuadradas.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-LAYOUT-CORRECTION-4

El ajuste final evita una lista criptica de solo siglas: el header conserva solo
avatar, pero el menu abierto muestra cuenta actual completa y emails visibles
en cada fila.

## Conservado

`Añadir cuenta`, `Cancelar`, `Escape`, login fallido, login correcto, cambio de
cuenta y olvido de cuenta siguen usando los flujos existentes.

Olvidar una cuenta, incluida la activa, no borra puntuaciones locales,
pending/sent/failed, colas scoped, packs, logs, preferencias ni metadata.

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS, membership,
scoped queue, auto-sync, packs, `config.json`, biblioteca, footer ni metadata
del juego.
