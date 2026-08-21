# Recovery web boundary

Recovery es una capacidad restringida dentro del navegador, no una sesión
privada de High Score League. La web verifica primero las claims, clasifica
`JWT.amr.method=recovery` y sólo considera `signed-in` una sesión normal con
`claims.sub === user.id`.

`getServerSession()` conserva el estado `recovery`. Root Layout y `SiteNav` no
activan navegación privada, current user ni Presence para ese estado. Las
mutaciones web sensibles mantienen la misma clasificación, incluidos admin,
perfil y anonimización, Presence web, chat, voto de Home y join de temporada.

El workflow conserva el staging anti-prefetch, el POST de verificación, el
marker HttpOnly, la comprobación marker + AMR Recovery + usuario coherente antes
de cambiar el password, el retry para errores corregibles, la cancelación con
logout local y el logout global tras completar.

Esta frontera no cambia PostgreSQL, RLS, Storage, roles SQL ni funciones
`SECURITY DEFINER`. Tampoco interpreta AMR en los endpoints Bearer del launcher,
que conservan su autenticación normal mediante `auth.getUser()`.

## Riesgo aceptado

Un poseedor técnico del token/JWT Recovery puede tener acceso directo a
capacidades que Supabase/RLS concedan al usuario; esta tarea acepta
deliberadamente ese riesgo porque el mismo secreto permite completar Recovery y
obtener una sesión normal.

## QA manual pendiente

1. Solicitar Recovery.
2. Abrir el email.
3. Pulsar Continuar.
4. Comprobar que `/reset-password` aparece.
5. Comprobar que la navegación sigue desconectada.
6. Comprobar que Home privada y `/profile` no aparecen como autenticadas.
7. Probar password débil y reintentar.
8. Probar la misma password y reintentar.
9. Cancelar y comprobar el logout local.
10. Repetir Recovery.
11. Establecer una password válida.
12. Comprobar el logout global.
13. Hacer login manual con la password nueva.
14. Comprobar el launcher normal con credenciales ordinarias.

No es necesario comprobar Data API o Storage con Recovery.
