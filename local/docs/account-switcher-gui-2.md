# LOCAL-ACCOUNT-SWITCHER-GUI-2

Cambio real de cuenta sin contrasena cuando existe una sesion local recordada.

## Por que existe

`LOCAL-ACCOUNT-SWITCHER-GUI-1` recordaba cuentas conocidas con datos seguros de
presentacion, pero para cambiar de cuenta pedia login de nuevo.

En un ordenador compartido, el flujo normal debe ser:

```text
jugador A juega
jugador B pulsa su fila de cuenta
la GUI activa su sesion local guardada
cada jugador ve solo su cola scoped
```

Esta segunda version anade sesiones recordadas por cuenta.

## Modelo

Se mantiene compatibilidad con el sistema actual:

```text
userData/session.json
```

Ese archivo sigue siendo la sesion activa real para CLI, GUI y codigo
existente.

Ademas, la GUI guarda sesiones recordadas por cuenta en:

```text
userData/accounts/sessions/<playerKey>.json
```

`known-accounts.json` sigue siendo solo presentacion:

```text
userData/accounts/known-accounts.json
```

## Cuenta conocida vs sesion recordada

Cuenta conocida:

- aparece en el selector;
- guarda `userId`, email, siglas, avatar/display opcionales y fechas;
- no contiene tokens.

Sesion recordada:

- permite cambiar sin contrasena;
- contiene la misma estructura de sesion que `session.json`;
- vive en un archivo separado por `playerKey`;
- no se envia al renderer;
- no se imprime en logs.

## Seguridad

No se guardan contrasenas.

Los tokens de sesiones recordadas se guardan bajo el mismo modelo de confianza
que el `session.json` existente en `userData`. No se implementa cifrado propio
ni `safeStorage` en esta fase para no introducir una capa parcial dificil de
probar desde CLI/tests.

El renderer solo recibe:

```js
{
  userId,
  email,
  displayName,
  initials,
  avatarUrl,
  lastUsedAt,
  isActive,
  hasSavedSession
}
```

No recibe `access_token`, `refresh_token`, `Authorization`, contrasena,
`session.json`, anon key ni service role.

## Login

Tras login correcto:

1. se guarda `session.json` como antes;
2. se guarda o actualiza `accounts/sessions/<playerKey>.json`;
3. se actualiza `known-accounts.json`;
4. se marca la cuenta como activa;
5. se recalcula estado, scope, membership, readiness y auto-sync.

## Cambiar cuenta

En el menu compacto, la fila completa de una cuenta no activa cambia a esa
cuenta:

1. la GUI pide al proceso principal activar esa cuenta;
2. el proceso principal busca su sesion recordada;
3. si existe y es valida, la escribe como `session.json`;
4. si esta cerca de caducar, intenta refrescar con Supabase;
5. si el refresh funciona, actualiza la sesion recordada y activa;
6. si falta o falla, borra el acceso rapido y abre login con email prellenado.

Mensaje esperado si falla:

```text
La sesion guardada ha caducado. Inicia sesion de nuevo.
```

## Anadir cuenta

`Anadir cuenta` abre el login vacio. Tras login correcto, se guarda la cuenta
conocida y su sesion recordada.

## Cerrar sesion

Desde `LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1`, `Cerrar sesion` en el menu
compacto cierra la sesion activa `session.json` y olvida esa cuenta en este
launcher. Si habia una sesion recordada para esa cuenta, tambien se elimina.

No elimina:

- packs;
- pending/sent/failed;
- colas scoped;
- puntuaciones locales.

El mensaje de seguridad se mantiene en logs/resultados, no como microcopy de
primera capa.

## Olvidar cuenta en este dispositivo

El icono `Olvidar cuenta` elimina:

- la fila de `known-accounts.json`;
- la sesion recordada `accounts/sessions/<playerKey>.json`.

No elimina:

- `userData/players/<playerKey>/...`;
- pending;
- sent;
- failed;
- packs;
- logs;
- metadata.

Si la cuenta es la activa, tambien se cierra `session.json`. Ya no se exige
cerrar sesion antes de olvidarla.

## Colas scoped

Al cambiar cuenta, `session.json` cambia y `getLauncherState()` recalcula:

- `playerKey`;
- `packKey`;
- cola visible;
- membership;
- readiness;
- auto-sync.

No se mueven archivos y no se fusionan colas.

## Limites

- No hay deep link.
- No hay device code flow.
- No hay registro desde app.
- No hay vinculacion web.
- No hay cifrado propio de sesiones recordadas.

## Integración en el revamp

La cabecera muestra una cuenta compacta y el panel de cuenta conserva cambio,
alta y cierre de sesión. El revamp no cambia el formato de sesiones recordadas
ni expone tokens al renderer.

## LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

El menu de cuenta queda como selector compacto de perfiles:

- titulo `Cuentas`;
- filas completas para cambiar de cuenta;
- check visual para la cuenta activa;
- boton de olvidar por icono;
- formulario de login compacto;
- sin badges `Activa`, texto `Cambio rapido disponible`, botones `Cambiar` o
  `Quitar`, ni explicaciones largas de seguridad en la primera capa.

El comportamiento funcional cambia solo en la reaccion normal de cuenta:
cerrar sesion y olvidar la cuenta activa eliminan tambien la cuenta recordada y
su sesion recordada local, sin borrar puntuaciones ni colas scoped.
