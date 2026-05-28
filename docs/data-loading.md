# Data loading

High Score League sigue usando datos mock por defecto. La lectura real de
Supabase se ha preparado de forma controlada para `seasons`, `games` y `weeks`.

## Fuente de datos

Configurar en `.env.local`:

```bash
NEXT_PUBLIC_DATA_SOURCE=mock
```

Valores soportados:

- `mock`: valor por defecto. `/seasons`, `/seasons/[seasonId]`, `/weeks`,
  `/weeks/[weekId]`, `/game` y el resto de paginas usan fallback mock.
- `supabase`: `/seasons`, `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y
  `/game` intentan leer datos reales. Submit sigue siendo provisional; el
  leaderboard semanal se calcula desde submissions visibles.

No se cambia automaticamente toda la aplicacion a Supabase.

## Seed de desarrollo

El archivo `supabase/seed-dev.sql` inserta datos minimos:

- Temporada I activa.
- Pretemporada cerrada.
- Temporada II en borrador.
- Juegos iniciales.
- Semana 1 activa.
- Semanas cerradas/publicadas de pretemporada.
- Semanas futuras con placeholder `Juego secreto`.

Ejecutarlo manualmente en Supabase Dashboard:

1. Abrir `SQL Editor`.
2. Pegar el contenido de `supabase/seed-dev.sql`.
3. Ejecutar despues de la migracion inicial.

El seed usa UUIDs fijos y `on conflict (id) do update`, por lo que puede
ejecutarse de nuevo durante desarrollo sin duplicar filas.

No inserta perfiles ni submissions porque dependen de usuarios reales de
Supabase Auth.

## Submissions y eventos MAME

La migracion `supabase/migrations/0002_submission_events.sql` prepara el modelo
para una fase basada en eventos automaticos:

`MAME plugin -> JSON local -> app local High Score League -> API web`.

La arquitectura esta documentada en `docs/submission-architecture.md`.

Puntos importantes:

- `submitted_at` representa cuando la web recibe el evento y lo fuerza el
  servidor.
- `detected_at` representa cuando MAME o la app local detectaron la puntuacion.
- `screenshot_path` es opcional porque las capturas no seran requisito central.
- `duplicate_key` preparara idempotencia para reintentos.
- `POST /api/submissions/ingest` ya existe como endpoint mínimo autenticado.
- Todavía no existen plugin MAME, app local, Storage ni capturas reales.

## Rutas de diagnostico

`/supabase-test` prueba conexion tecnica y Auth:

- variables;
- sesion;
- user metadata;
- perfil real;
- lectura basica de tablas.

`/real-data-test` prueba datos de dominio:

- `seasons`;
- `games`;
- `weeks`;
- temporada activa;
- semana actual;
- numero de semanas visibles;
- semanas ocultas por temporadas draft;
- enlaces a `/game` y a semanas reales accesibles;
- errores de RLS;
- si hay fallback mock.

Con las politicas actuales, `seasons`, `games` y `weeks` requieren usuario
autenticado. Si no hay sesion, `/real-data-test` muestra enlace a `/login`.

## `/seasons`

`/seasons` ya usa la fuente configurable:

- Con `NEXT_PUBLIC_DATA_SOURCE=mock` o sin variable, usa summaries mock.
- Con `NEXT_PUBLIC_DATA_SOURCE=supabase`, intenta leer `public.seasons` y cuenta
  semanas desde `public.weeks` para mantener la columna de semanas.
- Si no hay sesion o Supabase devuelve error, muestra un aviso discreto y usa
  fallback mock.
- Las temporadas `draft` se ocultan en el archivo publico.
- `active` se muestra como "Activa".
- `completed` se muestra como "Cerrada".

Mientras no existan `weekly_results` reales, lider/campeon se muestra como
"Pendiente" en datos reales. No se inventan ganadores.

## `/seasons/[seasonId]`

El detalle de temporada tambien usa la fuente configurable:

- En modo mock acepta ids mock como `s1` y slugs mock como `temporada-i`.
- En modo Supabase busca primero por `id` real y tambien por `slug`.
- Si no hay sesion o Supabase devuelve error, usa fallback mock si existe una
  temporada mock con ese id o slug.
- Si la temporada real esta en `draft`, no se muestran detalles por URL directa.
- Las semanas incluidas pueden venir de `public.weeks`.
- Si el juego asociado es el placeholder `Juego secreto`, se muestra como juego
  secreto y no se revelan metadatos.
- Los enlaces a semanas reales accesibles apuntan a `/weeks/[id]`; las semanas
  secretas o futuras quedan desactivadas.

La clasificacion real de temporada se calcula desde `weekly_results`. Tambien
se incluyen miembros activos de `season_memberships` con 0 puntos. Si no hay
resultados oficiales, la tabla puede mostrar inscritos a 0 puntos y el podio
queda pendiente. En modo mock se mantiene la clasificacion mock existente.

## `/weeks`

`/weeks` usa la misma fuente configurable:

- Con `NEXT_PUBLIC_DATA_SOURCE=mock` o sin variable, usa `getWeekSummaries()`.
- Con `NEXT_PUBLIC_DATA_SOURCE=supabase`, lee `public.weeks`, `public.seasons` y
  `public.games`.
- Si no hay sesion o Supabase devuelve error, muestra aviso y fallback mock.
- No muestra semanas de temporadas `draft`.
- `active` y `frozen` se agrupan visualmente como "Activa".
- `closed` y `published` se muestran como "Cerrada".
- `draft` se trata como no accesible/secreta.

Los juegos secretos se manejan con el placeholder `Juego secreto` porque el
modelo actual exige `weeks.game_id not null`. Cuando una semana es futura, draft
o usa ese placeholder:

- se muestra "Juego secreto";
- no se revelan desarrollador, genero, tipo de control ni dificultad;
- el enlace a detalle queda desactivado.

En modo Supabase los enlaces "Ver semana" se activan para semanas accesibles
con juego revelado. Siguen desactivados para semanas futuras, `draft` o con
placeholder `Juego secreto`.

No hay lider real hasta conectar `weekly_results`, por lo que la columna Lider
aparece como "Pendiente".

## `/weeks/[weekId]`

El detalle de semana usa fuente configurable:

- En modo mock acepta ids mock como `w1`.
- En modo Supabase busca por `id` real de `public.weeks`.
- No hay slug real de semana en el esquema actual, asi que no se busca por slug.
- Lee la semana, temporada asociada, juego asociado y `rules_summary`.
- Si no hay sesion, RLS bloquea o Supabase falla, usa fallback mock si existe.

Si una semana es futura, `draft` o usa el placeholder `Juego secreto`, se muestra
una pantalla de juego secreto:

- no se revela juego real;
- no se muestran metadatos;
- no se muestran reglas reales;
- no aparecen botones de descarga.

Para semanas activas, cerradas o publicadas con juego real se muestran ficha,
estado, fechas, reglas reales, leaderboard calculado desde submissions visibles
e historial de envios.

## `/game`

`/game` representa la semana activa:

- En modo mock mantiene la semana activa mock.
- En modo Supabase busca semanas con `status = active`.
- Si no hay semana activa, muestra `EmptyState`.
- Si hay varias semanas activas, muestra aviso de configuracion y elige una de
  forma estable por fecha de inicio y numero de semana.
- Si hay error de lectura o falta sesion, usa fallback mock.

En modo Supabase, `/game` y `/weeks/[weekId]` ya leen submissions reales de solo
lectura:

- el leaderboard semanal se calcula desde submissions validas y visibles;
- las submissions ocultas no revelan puntuacion hasta que la semana esta
  `published`;
- el historial muestra origen (`source`), envio (`submitted_at`) y deteccion
  (`detected_at`) cuando existen;
- si no hay submissions visibles, se muestra estado vacio;
- si la lectura falla, se muestra un aviso discreto y no se inventan
  puntuaciones mock dentro de una semana real.

`weekly_results` se lee en semanas `published` si existen filas, pero la app no
los genera ni publica todavia.

`week_benchmarks` se lee en modo Supabase para mostrar referencias visuales en
el leaderboard. No son submissions, no alteran ranks, no cuentan para
`weekly_results` y no aparecen en historial de envios.

`POST /api/submissions/ingest` ya existe como endpoint mínimo autenticado para
crear submissions automáticas. Usa RLS, deriva `player_id` del usuario
autenticado y no acepta `submitted_at` desde cliente.

`season_memberships` permite unirse a temporadas activas. `/seasons` y
`/seasons/[seasonId]` muestran estado `Unido`, botón `Unirse` o enlace a login
según sesión y membresía.

`/` lee `league_chat_messages` en modo Supabase para mostrar el chat global real
de la liga. El envío usa `POST /api/chat/messages` y el componente se suscribe a
inserts con Supabase Realtime. Al recibir un insert, recarga `GET
/api/chat/messages` para obtener los últimos 50 mensajes con perfiles.

`POST /api/admin/weeks/[weekId]/weekly-results` calcula resultados oficiales
desde submissions reales. En `dryRun` devuelve preview; con `dryRun = false`
reemplaza `weekly_results` solo si la semana está `closed` o `published`.

El panel admin mínimo vive en `/profile` para usuarios admin y en
`/admin/weeks`. Desde `/admin/weeks/[weekId]` se cambian estados, se revisan
submissions, se ejecuta dry run, se generan resultados oficiales y se marca la
semana como publicada.

`/admin/weeks/new` crea semanas reales y `/admin/weeks/[weekId]/edit` edita
temporada, juego, número, estado, fechas, reglas resumidas y benchmarks básicos.

`/admin/games` gestiona el catálogo real de juegos. Los metadatos `genre`,
`control_type` y `difficulty` se leen desde Supabase cuando existe la migración
`0005_game_metadata.sql`.

`/admin/seasons` gestiona temporadas reales. Permite crear y editar `name`,
`slug`, `version`, `status`, `starts_at` y `ends_at`; no crea semanas
automáticamente.

Para crear datos de prueba manuales, consulta `docs/test-submissions.md`.
Para probar el endpoint, consulta `docs/ingest-api.md`.
Para la generación oficial de resultados, consulta `docs/weekly-results.md`.
Para referencias visuales de leaderboard, consulta `docs/week-benchmarks.md`.
Para el chat global de la liga, consulta `docs/chat.md`.
Para administración semanal, consulta `docs/admin.md`.
Para creación y edición de semanas, consulta `docs/admin-weeks.md`.
Para administración de juegos, consulta `docs/admin-games.md`.
Para administración de temporadas, consulta `docs/admin-seasons.md`.

## Pagina temporal

`/seasons-real` se mantiene como comparativa temporal.

- Con `NEXT_PUBLIC_DATA_SOURCE=mock`, muestra fallback mock.
- Con `NEXT_PUBLIC_DATA_SOURCE=supabase`, intenta leer Supabase.
- Si Supabase falla y se solicita fallback, muestra mock con aviso.

No es la ruta principal; la ruta publica ya es `/seasons`.

## Capa de datos

La lectura real esta en:

- `lib/data/seasons.ts`
- `lib/data/games.ts`
- `lib/data/weeks.ts`
- `lib/data/week-page.ts`
- `lib/data/data-source.ts`
- `lib/data/admin-weeks.ts`
- `lib/data/season-memberships.ts`
- `lib/data/season-standings.ts`
- `lib/data/week-benchmarks.ts`
- `lib/weekly-results/calculate.ts`

Las funciones devuelven resultados tipados con:

- `rows`;
- `source`;
- `error`;
- `usingFallback`.

No lanzan errores no controlados si faltan variables o si Supabase devuelve un
error.

## Pendiente

Todavia no hay:

- app local y plugin MAME;
- moderación UI del chat;
- Storage real;
- subida real de puntuaciones;
- subida real de capturas;
- panel completo de usuarios;
- manuales, descargas y configuración MAME desde admin;
- medallas y bonus;
- integracion con MAME.
