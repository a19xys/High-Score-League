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

`SUPABASE_SERVICE_ROLE_KEY` solo se usa en route handlers de servidor que lo
necesitan, como cron o tareas server-side concretas. Nunca debe usarse en
componentes cliente, ni exponerse como `NEXT_PUBLIC_*`, ni pegarse en codigo
fuente.

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

La recuperación de contraseña usa el mismo canal. El email integrado es útil
para desarrollo, pero sus límites son muy reducidos: antes de habilitar el flujo
para usuarios reales se debe configurar SMTP propio. Si el proveedor ofrece
seguimiento de enlaces, hay que excluir los enlaces de Auth para que no reescriba
ni rompa el `token_hash`. SMTP, DNS, SPF y DKIM son configuración operativa y no
se aplican desde este repositorio.

## Política de contraseñas nuevas

La política canónica HSL se aplica a registros, recuperaciones y futuros cambios
de contraseña:

- mínimo 8 caracteres;
- al menos una letra minúscula (`[a-z]`);
- al menos una letra mayúscula (`[A-Z]`);
- al menos un número (`[0-9]`);
- los caracteres especiales están permitidos, pero no son obligatorios.

Login no reutiliza la política de creación de contraseñas. Comprueba que el
password no esté vacío y delega en `signInWithPassword()`; Supabase Auth es la
autoridad que determina si las credenciales proporcionadas son válidas. Crear o
cambiar una contraseña y autenticar credenciales existentes son fronteras
distintas, por lo que un cambio futuro de política no debe convertir Login en
otra autoridad de validación.

Esta misma política debe configurarse manualmente en **Authentication → Password
policy** del dashboard de Supabase:

```text
Minimum password length: 8
Required character classes: lowercase, uppercase, digits
Special characters required: no
```

El código no confirma que esos ajustes remotos ya estén aplicados.

## Recuperación de contraseña

El flujo web usa exclusivamente Supabase Auth:

```text
/forgot-password
  → resetPasswordForEmail(email, redirectTo=<origen>/auth/recovery/start)
  → email de Supabase
  → GET /auth/recovery/start?token_hash=...
  → cookie HttpOnly temporal + redirect limpio a /auth/recovery
  → POST humano /auth/recovery/verify
  → verifyOtp({ token_hash, type: "recovery" })
  → sesión recovery de Supabase + marker HttpOnly temporal
  → /reset-password
  → updateUser({ password })
  → signOut({ scope: "global" })
  → /login?passwordReset=success
```

La clasificación de la solicitud prioriza el `code` semántico, después un
`status` fiable y, sólo cuando no existe `code`, un fallback textual estrecho
para rate limit. Cualquier error no nulo que no esté reconocido falla de forma
cerrada y presenta un mensaje sanitizado:

- `error === null`: solicitud aceptada con el mensaje genérico;
- `user_not_found`: el mismo resultado público genérico, únicamente como defensa
  de compatibilidad anti-enumeración;
- `over_email_send_rate_limit`, `over_request_rate_limit` o `status === 429`:
  esperar antes de reintentar;
- `email_address_invalid`: introducir un email válido;
- cualquier otro error, conocido o futuro: recuperación no disponible.

El éxito normal y el fallback defensivo `user_not_found` son indistinguibles. El
flujo no consulta `auth.users`, perfiles, RPCs ni APIs admin, por lo que no
convierte la existencia del email en una señal visible. Tampoco expone códigos,
mensajes raw ni detalles de SMTP.

### Staging resistente a prefetch

El primer GET del correo nunca llama a `verifyOtp`. Sólo acepta un único
`token_hash` no vacío y acotado, lo guarda durante 15 minutos en la cookie
`hsl_password_recovery_staged` (`HttpOnly`, `SameSite=Lax`, `Secure` en
producción y `Path=/auth/recovery`) y redirige inmediatamente a una URL sin
token. El hash no entra en HTML, estado React, `localStorage` ni
`sessionStorage`.

La página limpia exige pulsar **Continuar**, que hace un POST. Ese POST consume
la cookie, llama a `verifyOtp` como recovery y elimina siempre el staging. Los
tokens ausentes, caducados, usados o inválidos convergen en el mismo error
seguro.

Tras verificar, el servidor crea un marker `HttpOnly` sin email, UUID, token ni
password, también con 15 minutos de vida y limitado a `/reset-password`. Este
marker es una guardia del flujo de la aplicación, no una prueba criptográfica de
identidad por sí solo. El formulario sólo se renderiza si existen a la vez esa
guardia y una sesión Supabase confirmada mediante `getUser()`; Supabase Auth
sigue siendo la autoridad de identidad. La validación de la política y la
confirmación se repiten en el POST antes de `updateUser()`.

La actualización mantiene una taxonomía acotada y siempre conserva el formulario
cuando el password no se ha cambiado:

- `same_password`: elegir una contraseña distinta;
- `weak_password`: revisar los requisitos de seguridad, sin mostrar razones raw;
- cualquier otro error o excepción: fallo genérico de actualización;
- actualización correcta: ejecutar después `signOut({ scope: "global" })`.

Ningún error de `updateUser()` ejecuta logout ni destruye la sesión recovery o el
marker, de modo que el usuario puede corregir el password y reintentar.

Si la contraseña se actualiza pero falla `signOut({ scope: "global" })`, la UI
no declara éxito: conserva markers efímeros para ofrecer un reintento que sólo
completa la revocación. En éxito se eliminan los markers y la sesión web, no se
inicia sesión automáticamente y se vuelve a Login.

Las páginas y respuestas sensibles son dinámicas/no-store y noindex. No se
registran passwords, token hashes, cookies de recovery, tokens ni sesiones.

### URL Configuration y plantilla Reset password

En **Authentication → URL Configuration** se deben autorizar sólo los destinos
que se usen realmente, sin comodines amplios en producción:

```text
Producción: https://high-score-league.vercel.app/auth/recovery/start
Desarrollo: http://localhost:3000/auth/recovery/start
```

En **Authentication → Email Templates → Reset password**, el enlace debe llevar
primero a la frontera anti-prefetch usando `.RedirectTo` y `.TokenHash`:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}">
  Cambiar contraseña
</a>
```

`resetPasswordForEmail()` deriva el origen desde la web actual y añade siempre
`/auth/recovery/start`; no acepta `next`, `returnTo`, `redirect` ni `origin` de
query params.

### Estado de implantación

La clasificación cerrada, las guardias de flujo, la validación local/server, la
actualización y el logout global están implementados en código. Siguen pendientes
de configuración y verificación externas el SMTP, la plantilla Reset password,
las Redirect URLs y la Password Policy del proyecto Supabase. El repositorio no
demuestra que esos ajustes estén aplicados ni que el recovery por email real se
haya probado.

### Revocación global y launcher

El logout global revoca las sesiones renovables y refresh tokens del usuario,
incluido el del launcher. No invalida instantáneamente access-token JWT ya
emitidos: estos pueden seguir siendo válidos hasta su `exp`. Cada navegador y el
launcher quedan obligados a reautenticarse cuando el access token expire o
necesiten refrescarlo; el launcher debe converger entonces a su estado existente
**Requiere iniciar sesión**. Este flujo no añade integración directa, polling ni
deep links al launcher.

### QA manual pendiente

Con una cuenta real y el SMTP/configuración remota preparados:

1. solicitar recovery y abrir el correo;
2. confirmar que el GET inicial no consume el enlace y que la URL queda limpia;
3. pulsar Continuar y rechazar 7 caracteres o una contraseña sin número;
4. aceptar una contraseña de 8 caracteres con mayúscula, minúscula y número;
5. comprobar el mensaje final en Login y el login manual con la nueva clave;
6. comprobar que otra sesión web y el launcher exigen login al expirar/refrescar;
7. comprobar enlace reutilizado, caducado e inválido.

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

Una identidad autenticada en `auth.users` y un perfil HSL activo son estados
distintos. Durante el bootstrap puede existir sesión Auth sin fila en
`public.profiles`. `0032_profile_bootstrap_rls.sql` añade una excepción SELECT
estrecha para que ese usuario vea únicamente su propia fila no anonimizada al
ejecutar el `INSERT ... RETURNING` de `ensureProfileForCurrentUser`; no habilita
la lectura de perfiles ajenos. Después de crearla,
`public.has_active_profile()` vuelve a gobernar el acceso normal. La migración
queda pendiente de aplicación manual en Supabase.

## Perfil

`/profile` es el centro único del perfil real. Comparte sistema visual y capa de
datos competitivos con `/players/[username]`; la composición y decisiones están
documentadas en `docs/profile-revamp.md`.

Si hay sesión y perfil, muestra identidad, fecha de creación, resultados
oficiales, mejores marcas y envíos propios. El email vive solo en el bloque
privado de sesión. Permite actualizar username, initials, descripción,
avatar mediante `MediaUpload` y las preferencias de visibilidad
`play_time_public` y `presence_public`. La UI las presenta como acciones de
ocultación: desmarcadas publican la información y marcadas persisten `false`.
Al guardar se actualiza también `user_metadata` y se refresca la ruta.

Si hay sesión pero no hay perfil, `/profile` muestra un formulario inline para
crearlo. Si no hay sesión, muestra enlace a `/login`.

El avatar usa `MediaUpload` y `avatar_storage_path` con fallback a `avatar_url` y
siglas. `0024_media_uploads.sql` ya está aplicada en el entorno remoto actual.
En una instalación nueva, `0024_media_uploads.sql` y `0025_play_time.sql` deben
aplicarse, en ese orden, antes del código que consulta sus funciones
respectivas. `0026_submission_detected_at_window.sql` ya está aplicada en el
Supabase remoto actual. `0027_profile_anonymization.sql` también está aplicada
remotamente; no debe reaplicarse.

El contrato de Playtime registra eventos identificados de práctica y
competición. `play_time_public` solo decide si otros jugadores pueden ver el
agregado; el propietario siempre lo ve. La privacidad se aplica en RLS y
`track_play_time` queda legacy, sin gobernar el registro ni convertirse
automáticamente en consentimiento público. Playtime no representa presencia ni
última actividad.

`localStorage` no es fuente principal de verdad para perfiles. Solo Supabase Auth
metadata y `public.profiles` se usan para este flujo.

## Ruta legacy

`/profile/setup` queda como ruta legacy con un mensaje simple y enlace a
`/profile`. Ya no forma parte del registro ni del login.

## Anonimización de cuenta

El borrado físico de actividad histórica continúa deshabilitado.
`POST /api/profile/anonymize` orquesta una baja irreversible: primero ejecuta la
RPC de tombstone en base de datos, después elimina solo `avatars/<uid>/`, limpia
metadata personal de Auth y finalmente usa `auth.admin.deleteUser(id, true)`
para hacer soft-delete del usuario Auth. La clave `service_role` solo existe en
servidor y nunca se expone al navegador.

El UUID y la historia competitiva sobreviven. El usuario retirado no puede
volver a autenticarse ni recrear un perfil. Las policies y endpoints verifican
`profiles.anonymized_at is null`, por lo que un token antiguo tampoco concede
operaciones. El último administrador activo está protegido. Repetir la petición
tras un fallo parcial es seguro y continúa la limpieza externa.

La UI exige escribir el username exacto y marcar una confirmación. Al completar
invalida cachés conocidas, cierra la sesión global y vuelve a `/`. No se afirma
un borrado legal exhaustivo: comentarios y mensajes libres históricos se
conservan y podrían contener datos que requieren moderación aparte.

## Privacidad de Presence

`presence_public` es una preferencia independiente. Desde
`0029_profile_privacy_defaults.sql`, los perfiles nuevos parten en `true` y la
UI permite optar por ocultarla; los valores históricos se conservan porque un
`false` antiguo no permite distinguir una elección explícita del default
anterior. Al pasar a `false`, la barrera de base de datos elimina
inmediatamente todas las sesiones efímeras. La anonimización también fuerza
`false` y limpia Presence.

El heartbeat web usa la cookie de sesión canónica. El launcher usa el bearer de
la única cuenta activa y la misma política de renovación canónica que el resto
de peticiones autenticadas. Ambos endpoints derivan el UUID del jugador del
token y rechazan campos extra, por lo que no se acepta `playerId`, actividad
launcher desde el browser ni títulos arbitrarios. La lectura de perfil exige un
viewer autenticado y activo y devuelve solo el agregado sanitizado.

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

Auth mínimo está implementado y simplificado. Las páginas principales usan
Supabase; el Storage público cubre imágenes administrables, pero no hay Storage
privado ni subida manual real de puntuaciones.


