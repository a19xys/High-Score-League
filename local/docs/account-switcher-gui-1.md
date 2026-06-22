# LOCAL-ACCOUNT-SWITCHER-GUI-1

Selector basico de cuenta en la GUI sin mezclar colas locales.

> Nota: `LOCAL-ACCOUNT-SWITCHER-GUI-2` amplía este modelo con sesiones
> recordadas por cuenta para cambiar sin introducir contrasena mientras la
> sesion local guardada sea valida o refrescable. Este documento queda como
> base historica del selector y del archivo `known-accounts.json`.

## Objetivo

La GUI muestra con claridad que cuenta esta activa, permite recordar cuentas
conocidas de forma segura y permite cambiar de cuenta iniciando sesion de nuevo.

Esta version conserva el modelo simple:

```text
una sola sesion activa real
+
cuentas conocidas solo como datos de presentacion
```

No guarda varias sesiones activas, no guarda refresh tokens de cuentas
anteriores y no guarda contrasenas.

## Archivo persistente

Las cuentas conocidas se guardan en:

```text
userData/accounts/known-accounts.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-19T00:00:00.000Z",
  "lastActiveUserId": "uuid-o-null",
  "accounts": [
    {
      "userId": "uuid",
      "email": "usuario@example.com",
      "displayName": null,
      "initials": "UE",
      "avatarUrl": null,
      "lastUsedAt": "2026-06-19T00:00:00.000Z",
      "addedAt": "2026-06-19T00:00:00.000Z"
    }
  ]
}
```

## Datos guardados

Solo se guardan datos seguros de presentacion:

- `userId`;
- `email`;
- `displayName`;
- `initials`;
- `avatarUrl`;
- `addedAt`;
- `lastUsedAt`.

No se guarda:

- contrasena;
- `access_token`;
- `refresh_token`;
- cabecera `Authorization`;
- `session.json` completo;
- Supabase anon key;
- service role.

## Login

Despues de un login correcto, la GUI:

1. guarda la sesion activa en el `session.json` existente;
2. anade o actualiza la cuenta en `known-accounts.json`;
3. marca esa cuenta como `lastActiveUserId`;
4. recalcula estado del launcher, scope, membership, readiness y auto-sync.

No hay login real contra cuentas recordadas sin contrasena. Cambiar cuenta pide
login de nuevo.

## Cambiar cuenta

`Cambiar` prellena el email de una cuenta conocida en el formulario de login.
El usuario debe introducir la contrasena. Si el login funciona, esa cuenta pasa
a ser la unica sesion activa real.

Esto evita guardar varias sesiones completas y mantiene el MVP conservador.

## Anadir cuenta

`+ Anadir cuenta` abre el formulario de login vacio. Tras login correcto, esa
cuenta se anade a cuentas conocidas.

No se implementa registro desde la app, deep link, device code ni vinculacion
web en esta tarea.

## Cerrar sesion

Cerrar sesion elimina solo la sesion activa. No borra:

- cuentas conocidas;
- packs;
- pending/sent/failed;
- colas scoped;
- puntuaciones locales.

La GUI muestra:

```text
Sesion cerrada. Tus puntuaciones locales siguen guardadas.
```

## Quitar cuenta recordada

`Quitar` elimina la cuenta de `known-accounts.json` si no es la cuenta activa.
No borra `userData/players/<playerKey>`, no borra colas y no mueve
puntuaciones.

Si el usuario intenta quitar la cuenta activa, la GUI pide cerrar sesion antes.

## Colas separadas

La cola competitiva sigue separada por cuenta y pack:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

Cambiar cuenta no mezcla ni migra puntuaciones. Al entrar con otra cuenta,
`getLauncherState()` recalcula el scope activo y muestra solo la cola de esa
cuenta y pack.

## Membership, readiness y auto-sync

Al cambiar cuenta, hacer login o cerrar sesion:

- membership se recalcula;
- readiness se recalcula;
- auto-sync se recalcula;
- sin sesion no hay scope competitivo activo;
- practica puede seguir disponible si el pack esta listo;
- auto-sync no se dispara sin sesion ni membership segura.

## Lo que queda pendiente

- Selector final de multiples sesiones activas.
- Vinculacion desde la web.
- Deep link.
- Device code flow.
- Registro desde la app.
- Avatar real remoto si se decide sincronizar perfiles.
