# High Score League

High Score League es una aplicacion web para organizar una liga privada de
puntuaciones arcade entre amigos. Este es el esqueleto inicial del MVP: una
interfaz navegable con datos mock y una arquitectura preparada para conectar
Supabase mas adelante.

## Stack

- Next.js con App Router
- TypeScript
- Tailwind CSS
- Datos mock locales

## Requisitos

- Node.js 20 o superior recomendado
- npm

## Ejecutar en local

Instala dependencias:

```bash
npm install
```

Arranca el servidor de desarrollo:

```bash
npm run dev
```

Abre la aplicacion en:

```text
http://localhost:3000
```

## Rutas iniciales

- `/`: portada pública de la liga; puede mostrar semana activa, top 3,
  leaderboard y chat real si `NEXT_PUBLIC_DATA_SOURCE=supabase`.
- `/game`: semana activa; puede leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`, con leaderboard e historial reales de solo
  lectura desde submissions visibles.
- `/weeks`: archivo de semanas; puede leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`, con enlaces reales desactivados.
- `/weeks/[weekId]`: detalle de semana; puede leer Supabase por id real, con
  leaderboard e historial reales de solo lectura desde submissions visibles.
- `/seasons`: archivo de temporadas; puede leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`, con fallback mock.
- `/seasons/[seasonId]`: detalle de temporada; puede leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`, con clasificacion y podio reales desde
  `weekly_results`.
- `/players/[username]`: perfil público provisional de jugador.
- `/submit`: formulario provisional de subida manual con vista previa local;
  queda como fallback mientras se prepara el flujo automatico MAME/app local.
- `/profile`: cuenta, configuración, historial y administración mock.
- `/week`, `/leaderboard`, `/season` y `/admin`: rutas temporales de compatibilidad.

## Estado del MVP

Funciona como interfaz navegable con datos temporales. Supabase y Auth minimo ya
estan preparados de forma aislada, pero las paginas principales siguen usando
mock data. Todavia no incluye subida real de capturas, puntuaciones persistentes
ni panel admin funcional.

## Supabase

La conexión inicial está preparada de forma aislada en `/supabase-test`. Consulta
[docs/supabase-setup.md](docs/supabase-setup.md) para configurar `.env.local` y
probar una lectura básica sin sustituir el mockup.

Auth minimo esta documentado en [docs/auth-setup.md](docs/auth-setup.md). Incluye
`/login`, `/register`, perfil real desde `/profile` y borrado de cuentas de
prueba desde servidor; las paginas principales siguen usando datos mock.

La lectura real controlada esta documentada en
[docs/data-loading.md](docs/data-loading.md). Usa `NEXT_PUBLIC_DATA_SOURCE=mock`
por defecto; `/seasons`, `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y
`/game` pueden leer datos reales con fallback, y `/real-data-test` sigue como
diagnostico de dominio.

La arquitectura futura de submissions automaticas esta documentada en
[docs/submission-architecture.md](docs/submission-architecture.md). El endpoint
mínimo `POST /api/submissions/ingest` está documentado en
[docs/ingest-api.md](docs/ingest-api.md). Todavia no existe plugin MAME, app
local, Storage real ni subida manual real.

Para probar leaderboards reales sin implementar subida, consulta
[docs/test-submissions.md](docs/test-submissions.md).

Las membresías de temporada y la generación oficial de `weekly_results` están
documentadas en [docs/weekly-results.md](docs/weekly-results.md).
La clasificación real de temporada está documentada en
[docs/season-standings.md](docs/season-standings.md).
Los benchmarks visuales de semana están documentados en
[docs/week-benchmarks.md](docs/week-benchmarks.md).
El chat global de la liga, incluyendo Supabase Realtime, está documentado en
[docs/chat.md](docs/chat.md).
El panel admin mínimo de semanas está documentado en
[docs/admin.md](docs/admin.md).
La creación y edición admin de semanas está documentada en
[docs/admin-weeks.md](docs/admin-weeks.md).
La gestión admin del catálogo de juegos está documentada en
[docs/admin-games.md](docs/admin-games.md).
La gestión admin de temporadas está documentada en
[docs/admin-seasons.md](docs/admin-seasons.md).
La automatización por fechas de semanas y temporadas está documentada en
[docs/automation.md](docs/automation.md).

## Plantillas preparadas

- Estados reutilizables: empty, loading, error y placeholder.
- Tablas: leaderboard semanal, clasificación de temporada, semanas, temporadas
  e historial de submissions.
- Chat de portada real en modo Supabase, con fallback mock en modo mock.
- Archivo de semanas y temporadas con filtros, ordenación mock y enlaces
  desactivados para contenido futuro.
- Semanas futuras con juego secreto y semanas cerradas/publicadas para probar
  estados, filtros y hover cards.
- Juegos mock con desarrollador, género, tipo de control y dificultad aproximada.
- Perfil mock con tema claro/oscuro/sistema guardado en navegador.
- Formularios visuales preparados para conectar Supabase Auth, Database y
  Storage en fases posteriores.

Todo sigue usando `lib/mock-data.ts`. La siguiente fase podrá sustituir esos
mocks por consultas reales sin rediseñar las páginas principales.

## Modelo inicial

Los tipos principales viven en `types/index.ts`:

- `Player`
- `Game`
- `Season`
- `Week`
- `Submission`
- `LeaderboardEntry`
- `SeasonStanding`
- `ChatMessage`
- `LeagueChatMessage`

Los datos mock y calculos temporales estan en `lib/mock-data.ts`.

## Siguiente fase sugerida

Probar el flujo admin completo con datos reales y configurar un cron real para
`/api/cron/process-schedule`. Siguen pendientes plugin MAME, Storage, capturas,
subida manual real desde `/submit`, panel completo de usuarios, manuales,
descargas/configuración MAME, moderación del chat, medallas y bonus.
