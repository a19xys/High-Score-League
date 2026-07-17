# LOCAL-LAUNCHER-AUTH-GUI-1

Login y logout visual minimo para la GUI local.

## Que permite

- Iniciar sesion desde el panel `Cuenta` de la GUI Electron.
- Usar email y contrasena contra Supabase Auth con la anon key configurada.
- Guardar una unica sesion canonica por `userId` compartida con la CLI.
- Cerrar sesion desde la GUI eliminando solo la sesion local.
- Mantener la CLI `login`, `auth-status` y `logout`; `auth-token` se retiro por
  no tener consumidores y por ampliar innecesariamente la superficie sensible.

## Seguridad

- La contrasena solo vive durante el submit del formulario.
- La contrasena no se guarda en archivos ni en el estado global del renderer.
- El estado enviado al renderer no incluye `access_token` ni `refresh_token`.
- Los errores visuales son mensajes amables y no imprimen secretos.
- No se usa `service_role`; la app local sigue requiriendo anon key.

## Flujo visual

Sin sesion:

```text
No conectado
Inicia sesion para subir puntuaciones a High Score League.
Iniciar sesion
```

Formulario:

```text
Email
Contrasena
Entrar
Cancelar
```

Con sesion:

```text
Cuenta conectada
player@example.com
Sesion local activa.
Cerrar sesion
```

## Logout

Cerrar sesion elimina el envelope canonico de la cuenta activa y su metadata
mediante el mismo repositorio que la CLI. `session.json` solo puede ser una
fuente legacy pendiente de migracion. Logout no borra packs, `recent.json`,
eventos `pending`, `sent`, `failed`, favoritos, logs ni preferencias.

## Subidas

`Subir pendientes` queda deshabilitado si no hay sesion conectada y muestra:

```text
Inicia sesion para subir puntuaciones.
```

Jugar competicion, practicar, abrir pack y diagnosticar siguen disponibles sin
sesion.

## Limites

- No hay registro de usuario.
- No hay recuperacion de contrasena.
- No hay magic links, OAuth ni perfil completo.
- No hay gestion avanzada de cuenta.
- No se hacen cambios en Supabase, la web ni el endpoint ingest.
