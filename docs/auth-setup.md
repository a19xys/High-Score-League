# Auth setup

High Score League usa Supabase Auth con email y password. Las paginas principales
usan datos reales de Supabase; Auth gestiona sesion real y perfil real.

## Variables necesarias

Crear `.env.local` con:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

`SUPABASE_SERVICE_ROLE_KEY` solo se usa en route handlers de servidor, por
ejemplo para borrar cuentas de prueba. Nunca debe usarse en componentes cliente,
ni exponerse como `NEXT_PUBLIC_*`, ni pegarse en codigo fuente.

En Windows, si aparece `fetch failed` o errores de certificados:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

## Email y SMTP

Supabase puede exigir confirmacion de email. En desarrollo puede desactivarse
temporalmente para evitar rate limits mientras se prueba el flujo.

El proveedor integrado de email de Supabase tiene limites bajos. Para usuarios
reales conviene configurar SMTP propio y activar confirmacion cuando el flujo ya
este cerrado.

## Registro

`/register` pide:

- email;
- password;
- confirmacion de password;
- username;
- initials.

Reglas:

- `username`: `^[a-z][a-z0-9_]{2,19}$`
- `initials`: `^[A-Z0-9]{3}$`
- `initials` se transforma a mayusculas antes de validar y guardar.

Al llamar a `supabase.auth.signUp`, la app guarda `username` e `initials` en
`options.data`, que Supabase conserva como `user_metadata`.

Si Supabase devuelve sesion inmediata, la app llama a
`ensureProfileForCurrentUser`, crea `public.profiles` si falta y redirige a
`/profile`.

Si Supabase exige confirmacion de email, `/register` muestra un mensaje para
revisar el correo. No redirige a `/profile/setup`.

## Login

`/login` usa `supabase.auth.signInWithPassword`.

Tras login correcto, la app llama a `ensureProfileForCurrentUser`:

- si el perfil existe, lo devuelve;
- si falta, intenta crearlo desde `user_metadata`;
- si falta metadata o hay conflicto de username/siglas, redirige a `/profile`
  para completar los datos inline.

Nunca se redirige a `/profile/setup` desde el flujo normal.

## Perfil

`/profile` es el centro único del perfil real.

Si hay sesión y perfil, muestra email, username, initials, avatar, bio pública,
fecha de creación y estadísticas reales cuando existen. Permite actualizar
username, initials, descripción, `avatar_url` como URL temporal y la preferencia
`track_play_time`. Al guardar se actualiza también `user_metadata` y se refresca
la ruta para que la navegación no requiera F5.

Si hay sesión pero no hay perfil, `/profile` muestra un formulario inline para
crearlo. Si no hay sesión, muestra enlace a `/login`.

No hay Storage de avatar todavía: `avatar_url` es texto http/https mientras se
prepara la subida real de imágenes.

`localStorage` no es fuente principal de verdad para perfiles. Solo Supabase Auth
metadata y `public.profiles` se usan para este flujo.

## Ruta legacy

`/profile/setup` queda como ruta legacy con un mensaje simple y enlace a
`/profile`. Ya no forma parte del registro ni del login.

## Borrar cuenta de prueba

En `/profile` hay una accion "Borrar mi cuenta de prueba". Requiere confirmar
escribiendo `BORRAR`.

La accion llama a `POST /auth/delete-account`, un route handler de servidor que:

- obtiene el usuario actual desde la sesion;
- usa `SUPABASE_SERVICE_ROLE_KEY` solo en servidor;
- llama a `auth.admin.deleteUser(user.id)`;
- aprovecha `on delete cascade` para eliminar `profiles`;
- cierra la sesion y devuelve al flujo de registro.

Si falta `SUPABASE_SERVICE_ROLE_KEY`, la ruta devuelve un error claro y no borra
nada.

## Primer admin

El primer admin se crea manualmente en Supabase SQL Editor despues de registrar
el usuario:

```sql
update public.profiles
set is_admin = true
where id = 'USER_ID';
```

La app nunca permite a un usuario ponerse `is_admin = true`.

## Estado actual

Auth minimo esta implementado y simplificado. Las paginas principales usan Supabase; no hay Storage real ni subida manual real de puntuaciones.


