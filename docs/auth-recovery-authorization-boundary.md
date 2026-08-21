# Recovery authorization boundary

## Contrato de seguridad

Una sesión creada por Supabase mediante `verifyOtp({ type: "recovery" })` es
una sesión Auth real, pero no es una sesión de producto de High Score League.
La autoridad es el JWT verificado:

```text
claims verificadas + role=authenticated + sub válido
  + amr ausente                         → product (compatibilidad legacy)
  + amr válido sin recovery             → product
  + amr válido con method=recovery      → recovery
  + amr presente pero malformado        → invalid / fail closed
```

`getClaims()` verifica primero el token. Sólo una clasificación `product` puede
continuar a `getUser()` en fronteras de producto, y entonces se exige
`claims.sub === user.id`. El workflow Recovery usa la variante deliberada que
también obtiene el usuario para comprobar esa coherencia antes de cambiar el
password.

La cookie `hsl_password_recovery_authorized` sólo demuestra que el navegador
recorrió el POST humano de HSL. No es autoridad de autorización. El formulario
requiere a la vez marker válido, claims verificadas con AMR Recovery y usuario
coherente.

## Una sola sesión Supabase

No hay segundo namespace SSR, JWT propio, rol Auth personalizado ni session
bridge. `verifyOtp()` sustituye la sesión SSR activa del navegador por la sesión
Recovery. Por ello, si el navegador ya tenía login normal, converge a una sola
identidad restringida: navegación de cuenta, perfil, Home privada, Presence y
admin quedan desactivados mientras Recovery esté activa.

Un JWT Recovery vivo cuyo marker HSL haya caducado sigue sin ser product. La UI
de `/reset-password` ofrece `POST /reset-password/cancel`, que ejecuta logout
local, limpia el estado HSL y vuelve a Login. El éxito de cambio de password
mantiene logout global para revocar los refresh tokens restantes.

## Fronteras de aplicación

La autoridad común vive en `lib/auth/session-context.ts`:

- `getVerifiedSessionContext`: verifica y clasifica claims;
- `getVerifiedProductIdentity`: no pide usuario si la clase no es product;
- `getVerifiedSessionIdentity`: reservado para workflows que necesitan validar
  también el usuario Recovery;
- `extractBearerAccessToken`: acepta exactamente un header `Bearer <token>`.

`getServerSession()` expone `recovery` de forma explícita y sólo transforma
`product` + usuario coherente en `signed-in`. `hasServerSession()` sólo es true
para `signed-in`. `SiteNav` consume ese resultado central; no vuelve a decidir
por su cuenta. Root Layout activa Presence y el current user de hover cards sólo
para `signed-in`.

Bearer auditados:

- `POST /api/submissions/ingest` (también admite cookie);
- `GET /api/local/season-membership`;
- `POST /api/launcher/playtime/ingest` (también admite cookie);
- `POST` y `DELETE /api/launcher/presence`;
- `GET /api/launcher/packs/[packId]/download`.

Fronteras cookie o user-JWT que después elevan privilegios, consultan con
service role o acceden a R2:

- `/profile`;
- `POST /api/profile/anonymize`;
- `POST /api/presence/web`;
- `GET /api/players/[username]/presence`;
- `GET /api/home-poll` y `POST /api/home-poll/vote`;
- resolución server-side del launcher pack visible desde Home/detalle de semana;
- rutas `/api/admin/*` que pasan por `requireAdmin()`;
- Presence del launcher;
- descarga de launcher packs.

Todas clasifican product antes de construir o utilizar la dependencia elevada.
Las APIs web de chat, polls, membership, previews, Playtime y administración
también usan la misma clasificación aunque permanezcan bajo RLS.

## PostgreSQL: `0033`

`public.has_product_session()` es `SECURITY INVOKER`, `STABLE` y sólo usa
`auth.uid()`, `auth.role()` y `auth.jwt()->'amr'`. Su definición efectiva es:

```text
uid null o role distinto de authenticated → false
amr ausente                               → true
amr no array                              → false
entrada AMR malformada                    → false
algún method recovery                     → false
array AMR válido restante                 → true
```

Acepta tanto métodos string RFC como entradas `{ method, timestamp }`; no
consulta `user_metadata` ni cookies HSL. `has_active_profile()` e `is_admin()`
empiezan por esta autoridad. `ingest_play_time_event()` añade además una guardia
explícita antes de tocar tablas como `SECURITY DEFINER`.

La migración deriva del catálogo, durante su aplicación, todas las tablas
`public` con privilegios efectivos `SELECT/INSERT/UPDATE/DELETE` para
`authenticated`. Exige RLS y añade a cada una la policy:

```sql
AS RESTRICTIVE FOR ALL TO authenticated
USING ((select public.has_product_session()))
WITH CHECK ((select public.has_product_session()))
```

El inventario esperado desde el HEAD que creó `0033` es:

- `profiles`, `seasons`, `games`, `weeks`, `submissions`, `weekly_results`;
- `season_memberships`, `week_benchmarks`;
- `league_chat_messages` y `chat_messages` si existe la tabla opcional;
- `home_polls`, `home_poll_options`, `home_poll_votes`;
- `play_time_events`, `player_game_play_time`, `player_play_time_totals`;
- `launcher_packs`.

El preflight vuelve a derivar el inventario real; es la autoridad frente a
drift o tablas futuras. `retired_profile_usernames` y
`player_presence_sessions` permanecen service-role-only y no reciben una
barrera artificial de usuario.

Storage tiene una barrera restrictiva en `storage.objects` para operaciones
autenticadas sobre `hsl-public-media`. Las descargas por URL pública/CDN no
cambian. Un bucket HSL futuro aparece como finding del preflight hasta quedar
cubierto.

Inventario esperado de `SECURITY DEFINER` ejecutable por `authenticated`:

- `has_active_profile()` → guardia directa;
- `is_admin()` → guardia directa;
- `get_week_hidden_submission_activity(uuid)` → guardia transitiva de perfil;
- `is_latest_own_league_chat_message(uuid,timestamptz)` → guardia transitiva;
- `ingest_play_time_event(...)` → guardia directa de product + perfil.

`0033` revoca el EXECUTE cliente accidental de funciones trigger
`SECURITY DEFINER` y aborta si encuentra otra RPC elevada ejecutable por
`authenticated` sin `has_product_session`, `has_active_profile` o `is_admin`.
Las funciones concedidas exclusivamente a `service_role` conservan su contrato.

## Aplicación manual

No se aplica nada remoto desde el repositorio:

1. desplegar/revisar código y mantener tests verdes;
2. aplicar primero cualquier migración pendiente anterior, incluida `0032`;
3. revisar y aplicar `supabase/migrations/0033_recovery_session_authorization.sql`;
4. ejecutar `supabase/preflight/0033_recovery_session_authorization.sql`: todos
   los `*_ok` deben ser true y el result set final debe tener cero findings;
5. comprobar una sesión normal básica;
6. hacer commit/push y desplegar el código web;
7. ejecutar inmediatamente el QA Recovery completo.

## QA remoto pendiente

La suite local demuestra clasificación, orden claims→usuario, rechazo Bearer,
cero llamadas admin/R2 en el caso inyectable, UI segura, SQL y retry de reset.
No demuestra el comportamiento del proyecto Supabase real. Antes de cerrar Auth
hay que usar una cuenta controlada y comprobar:

1. login normal y launcher `0.3.0` siguen funcionando;
2. Recovery entra en `/reset-password` sin navegación, perfil ni Presence;
3. perfil, Home privada y admin rechazan Recovery;
4. claims identifican `recovery` sin imprimir tokens;
5. Data API, Storage y los cinco Bearer auditados rechazan sin side effects;
6. refrescar la sesión y repetir 4–5: AMR debe conservar `recovery`;
7. weak/same-password permiten corregir sin product access;
8. cancelar hace logout local;
9. completar hace logout global y vuelve a Login;
10. login manual con la clave nueva funciona y sesiones antiguas/launcher
    requieren autenticación al renovar.

Si el refresh real elimina `recovery` de AMR, no se debe sustituir esa autoridad
con el marker HSL: se detiene el cierre y se reevalúa el diseño de claims.
