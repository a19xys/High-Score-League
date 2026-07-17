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

El modelo historico de dos copias fue sustituido por:

```text
userData/accounts/sessions/<playerKey>.json
```

Cada archivo es la unica sesion canonica de su `userId`. GUI y CLI comparten
esa autoridad. La cuenta activa es `lastActiveUserId`; `session.json` solo es
una fuente legacy que el migrador elimina tras verificar.

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
- contiene el payload canonico protegido y su `sessionRevision`;
- vive en un archivo separado por `playerKey`;
- no se envia al renderer;
- no se imprime en logs.

## Seguridad

No se guardan contrasenas.

Los tokens se guardan con el envelope de `secure-session-storage`. GUI y CLI
usan Electron `safeStorage` compatible y nunca exponen el payload al renderer.

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

1. se guarda o actualiza `accounts/sessions/<playerKey>.json` una sola vez;
2. se actualiza `known-accounts.json`;
3. se marca la cuenta como activa;
4. se recalcula estado, scope, membership, readiness y auto-sync.

## Cambiar cuenta

En el menu compacto, la fila completa de una cuenta no activa cambia a esa
cuenta:

1. la GUI pide al proceso principal activar esa cuenta;
2. el proceso principal resuelve su sesion canonica;
3. si existe y es valida, cambia solo `lastActiveUserId`;
4. si esta cerca de caducar y hay conectividad confirmada, el repositorio la renueva;
5. si el refresh funciona, incrementa la revision canonica;
6. si falta o esta revocada, conserva metadata segura y abre login.

Mensaje esperado si falla:

```text
La sesion guardada ha caducado. Inicia sesion de nuevo.
```

## Anadir cuenta

`Anadir cuenta` abre el login vacio. Tras login correcto, se guarda la cuenta
conocida y su sesion recordada.

## Cerrar sesion

Desde `LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1`, `Cerrar sesion` en el menu
compacto elimina la sesion canonica de la cuenta activa y la olvida en este
launcher.

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

Si la cuenta es la activa, tambien se limpia el pointer. Ya no se exige
cerrar sesion antes de olvidarla.

## Colas scoped

Al cambiar cuenta, cambia el pointer y `getLauncherState()` recalcula:

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
