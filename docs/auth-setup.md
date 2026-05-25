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

## Email y SMTP

En desarrollo puede desactivarse temporalmente la confirmación de email para
evitar límites de envío y rate limits mientras se prueba el flujo.

El proveedor integrado de email de Supabase tiene límites bajos. Para usuarios
reales conviene configurar SMTP propio y activar confirmación cuando el flujo ya
esté cerrado.

## Registro

La ruta `/register` pide:

- email;
- contraseña;
- confirmación de contraseña;
- username;
- initials.

Reglas:

- `username`: `^[a-z][a-z0-9_]{2,19}$`
- `initials`: `^[A-Z0-9]{3}$`
- Las siglas se transforman a mayúsculas antes de validar y guardar.

Al llamar a `supabase.auth.signUp`, la app guarda `username` e `initials` en
`options.data`. Si Supabase devuelve sesión inmediata, la app crea
automáticamente `public.profiles` y redirige a `/profile`.

Si Supabase exige confirmación de email, no se crea perfil todavía. El usuario
confirma el correo, inicia sesión en `/login` y la app crea el perfil
automáticamente desde `user_metadata`.

## Login

La ruta `/login` usa email y contraseña con `supabase.auth.signInWithPassword`.
Tras login correcto llama al helper `ensureProfileForCurrentUser`.

Si el perfil existe o se puede crear desde metadata, redirige a `/profile`. Si
faltan datos o hay un conflicto de username/siglas, `/profile` muestra un
formulario para completar o corregir el perfil.

## Perfil real

`/profile` es el centro de gestión del perfil real. Muestra:

- sesión activa;
- email;
- username e initials reales si existen;
- formulario para crear o actualizar username e initials.

La app no envía `is_admin`, no permite activar admin y no usa service role.

`/profile/setup` queda como ruta legacy y enlaza a `/profile`; ya no forma parte
del flujo normal.

## Primer admin

El primer admin debe crearse manualmente desde Supabase SQL Editor después de
registrar el usuario.

Si el perfil ya existe:

```sql
update public.profiles
set is_admin = true
where id = 'USER_ID';
```

Si el perfil aún no existe, el usuario puede completarlo desde `/profile`, o se
puede crear manualmente con SQL respetando las reglas de `username` e `initials`.

## Logout

El cierre de sesión está disponible en `/profile`. Llama a
`supabase.auth.signOut()`, refresca la navegación y redirige a `/login`.

## Estado actual

Las páginas principales siguen usando datos mock. Auth solo añade estado real de
sesión, perfil real y rutas mínimas para preparar la siguiente fase.
