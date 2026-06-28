# LOCAL-LAUNCHER-ACCOUNT-MENU-BEHAVIOR-2

Pulido fino del comportamiento del menu de cuenta.

## Aplicado

- Abrir el menu de cuenta siempre parte de formulario cerrado, sin email,
  contrasena ni error anterior.
- El CTA principal del menu siempre dice `Añadir cuenta`.
- `Cancelar`, `Escape` y las acciones largas cierran el menu y limpian el
  formulario.
- El cierre por click exterior se decide por el `pointerdown`: seleccionar o
  copiar texto desde dentro del menu no lo cierra aunque el mouseup termine
  fuera.
- Sin cuenta activa, cabecera y menu muestran `No has iniciado sesión`.
- El avatar sin cuenta usa un unico fallback visual.

No se toca MAME, runtime, plugin, capturas, colas, packs, descargas,
membership, endpoints ni sincronizacion.

## Continuidad LOCAL-LAUNCHER-FAVORITES-SCOPED-2

Los favoritos de biblioteca se separan por cuenta activa en
`userData/players/<playerKey>/preferences/favorites.json`. Cerrar sesion u
olvidar una cuenta no borra esos favoritos; sin sesion se usa el fallback
anonimo `userData/library/favorites.json`.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-COMPACT-POLISH-3

El pulido compacto posterior cambia el chip sin sesion a `Sin sesión`, muestra
solo siglas en el header con sesion, elimina el boton global `Cerrar sesión` de
la UI normal e integra `Olvidar cuenta` dentro de cada fila.
