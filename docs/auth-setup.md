# Auth setup

High Score League tiene autenticación mínima con Supabase Auth, sin sustituir el
mockup principal.

## Variables necesarias

Crear `.env.local` con:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

No usar nunca `service_role` en frontend ni en variables `NEXT_PUBLIC_*`.

En Windows, si aparece `fetch failed` o errores de certificados al instalar o
consultar, puede hacer falta:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

## Login

La ruta `/login` usa email y contraseña con `supabase.auth.signInWithPassword`.
Si el login es correcto, redirige a `/profile/setup` para crear o revisar el
perfil real.

## Registro

La ruta `/register` usa `supabase.auth.signUp`.

Si Supabase devuelve sesión activa, la app redirige a `/profile/setup`.
Si el proyecto exige confirmación de email, la app muestra un mensaje para
revisar el correo antes de iniciar sesión.

## Perfil real

La ruta `/profile/setup` permite crear o actualizar una fila en
`public.profiles` para el usuario autenticado.

Campos gestionados desde la app:

- `id = auth.user.id`
- `username`
- `initials`

La app no envía `is_admin`, no permite activar admin y no usa service role.

Reglas:

- `username`: `^[a-z][a-z0-9_]{2,19}$`
- `initials`: `^[A-Z0-9]{3}$`
- Las siglas se transforman a mayúsculas antes de guardar.

Errores como username o siglas duplicadas se muestran como mensajes legibles.

## Primer admin

El primer admin debe crearse manualmente desde Supabase SQL Editor después de
registrar el usuario.

Si el perfil ya existe:

```sql
update public.profiles
set is_admin = true
where id = 'USER_ID';
```

Si el perfil aún no existe, el usuario puede completarlo primero desde
`/profile/setup`, o se puede crear manualmente con SQL respetando las reglas de
`username` e `initials`.

## Logout

El cierre de sesión está disponible en `/profile`. Llama a
`supabase.auth.signOut()` y redirige a `/login`.

## Estado actual

Las páginas principales siguen usando datos mock. Auth solo añade estado real de
sesión, perfil real y rutas mínimas para preparar la siguiente fase.
