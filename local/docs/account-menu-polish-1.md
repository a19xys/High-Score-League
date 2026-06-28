# LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

Pulido del menu de cuenta como selector compacto de perfiles.

## Objetivo

El menu de cuenta deja de parecer una lista administrativa y pasa a funcionar
como selector de perfil:

- chip de cabecera compacto con siglas o `Sin sesión`;
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

Desde `LOCAL-LAUNCHER-ACCOUNT-MENU-COMPACT-POLISH-3`, el boton global
`Cerrar sesion` ya no se muestra en la UI normal. La forma visible de cerrar y
olvidar la cuenta activa es el icono `Olvidar cuenta` integrado en su fila.

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
- `forget-account.svg`: olvidar cuenta;
- `email.svg`: campo email;
- `password.svg`: campo contrasena.

Si esos SVG aun no existen, el renderer usa fallbacks discretos sin cambiar
login, cambio de cuenta, cierre de sesion ni borrado de puntuaciones.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-BEHAVIOR-2

El comportamiento fino posterior deja el menu con apertura limpia, CTA fijo
`Añadir cuenta`, cierre por `pointerdown` exterior, `Cancelar`/`Escape` con
limpieza de formulario y estado sin cuenta `No has iniciado sesión`.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-COMPACT-POLISH-3

El menu queda mas denso: header con siglas o `Sin sesión`, filas mas bajas,
titulo `Cuentas` menos espaciado, correo secundario y `Olvidar cuenta`
integrado en cada fila sin boton global `Cerrar sesion`.
