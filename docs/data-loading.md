# Data loading

High Score League usa Supabase como fuente de datos de producto. Las paginas
principales ya no usan `lib/mock-data.ts` ni fallback a datos locales.

## Fuente de datos

Las rutas privadas siguen esta regla:

1. Visitante sin sesion: landing publica o `AccessRequired`.
2. Usuario autenticado: lectura real de Supabase.
3. Error de Supabase/RLS: estado vacio o aviso controlado, sin inventar datos.

`NEXT_PUBLIC_DATA_SOURCE` ya no se usa.

## Rutas principales

`/` muestra landing publica sin sesion. Con sesion iniciada lee semana activa,
temporada activa, leaderboard y chat real.

`/seasons` lee `public.seasons` y cuenta semanas desde `public.weeks`.
Las temporadas `draft` no aparecen publicamente.

`/seasons/[seasonId]` acepta id o slug real. Muestra semanas reales,
clasificacion real desde `weekly_results` y podio real cuando existen
resultados oficiales.

`/weeks` lee `public.weeks`, `public.seasons` y `public.games`. Las semanas de
temporadas `draft` no aparecen. Las semanas secretas, futuras o sin `game_id`
no revelan juego y se muestran como `Por anunciar`.

`/weeks/[weekId]` lee semana, temporada, juego, submissions, benchmarks y
`weekly_results` reales. Si la semana no existe o esta oculta, muestra estado
limpio.

Una semana real sin juego asignado queda como configuracion incompleta si ya ha
llegado a apertura. El cron no la publica ni genera resultados y el ingest no
acepta submissions hasta que el admin asigne un juego real.

`/game` redirige a `/weeks/[weekId]` de la semana activa o en tramo final.

`/submit` sigue siendo una pantalla provisional de respaldo, sin subida manual
real todavia.

## Diagnostico

`/supabase-test` prueba conexion tecnica, Auth y lectura basica.

`/real-data-test` prueba datos de dominio: temporadas, juegos, semanas,
submissions, weekly_results y enlaces utiles. Estas rutas son de desarrollo y no
forman parte de la navegacion principal.

## Pendiente

- Storage real.
- Capturas reales.
- Subida manual real desde `/submit`.
- App local y plugin MAME.
- Panel completo de usuarios.
- Medallas y bonus.
