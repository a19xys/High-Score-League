# LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

Pulido del menu de cuenta como selector compacto de perfiles.

## Objetivo

El menu de cuenta deja de parecer una lista administrativa y pasa a funcionar
como selector de perfil:

- chip de cabecera con cuenta conectada o `Sin cuenta conectada`;
- avatar compacto con iniciales reales o estado vacio;
- bloque superior con la cuenta activa;
- lista de cuentas recordadas como filas completas;
- check visual para la cuenta seleccionada;
- accion secundaria de olvidar cuenta como icono;
- login compacto dentro del mismo menu.

No se toca MAME, runtime, plugin, captura, payload, `duplicateKey`, endpoints,
RLS, membership, scoped queue, auto-sync, contratos de pack ni `config.json`.

## Interfaz

La lista del menu usa el titulo `Cuentas`. Ya no muestra microcopy de seguridad,
badges `Activa`, textos `Cambio rapido disponible`, botones `Cambiar`, botones
`Quitar` ni ayuda larga bajo el formulario.

Las filas no activas son botones completos con `data-action="switch-account"`.
La fila activa no dispara cambio de cuenta; muestra `aria-current="true"` y un
check con etiqueta accesible `Cuenta seleccionada`.

Cada fila mantiene un boton pequeno para olvidar la cuenta en este launcher:
`data-action="remove-known-account"` con `aria-label="Olvidar cuenta"`.

## Login

El formulario del menu conserva email y contrasena, pero queda compacto:

```text
Email
Contrasena
Entrar
Cancelar
```

No se muestran textos sobre tokens, colas o seguridad en la primera capa. Esa
informacion queda documentada y protegida por tests.

## Cerrar Sesion Y Olvidar

`Cerrar sesion` desde el menu compacto cierra la sesion activa y olvida esa
cuenta recordada en este dispositivo. Esto elimina la fila de
`known-accounts.json` y su sesion recordada por cuenta, si existe.

`Olvidar cuenta` hace lo mismo para la cuenta seleccionada. Si la cuenta
olvidada es la activa, tambien se cierra la sesion local activa.

Ninguna de estas acciones borra:

- puntuaciones locales;
- pending/sent/failed;
- colas scoped;
- packs;
- logs;
- preferencias;
- metadata de packs.

## Validacion

Los tests protegen:

- ausencia de tokens en renderer;
- ausencia de microcopy antiguo;
- filas de cuenta como selector compacto;
- check de cuenta activa;
- boton de olvidar cuenta;
- estado sin cuenta sin iniciales inventadas;
- cierre de sesion que olvida la cuenta activa.

## Continuidad LOCAL-LAUNCHER-ICON-SYSTEM-1

El menu de cuenta usa `renderIcon()` para:

- `user.svg`: cuenta generica o sin cuenta;
- `check.svg`: cuenta activa;
- `add.svg`: anadir cuenta;
- `logout.svg`: cerrar sesion;
- `forget-account.svg`: olvidar cuenta;
- `email.svg`: campo email;
- `password.svg`: campo contrasena.

Si esos SVG aun no existen, el renderer usa fallbacks discretos sin cambiar
login, cambio de cuenta, cierre de sesion ni borrado de puntuaciones.
