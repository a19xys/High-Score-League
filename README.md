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

- `/`: portada pública de la liga, juego activo y top 3 semanal.
- `/game`: juego activo, reglas, estado del jugador mock y leaderboard semanal.
- `/weeks`: archivo de semanas y leaderboards semanales.
- `/weeks/[weekId]`: detalle mock de una semana, ranking y submissions.
- `/seasons`: archivo de temporadas.
- `/seasons/[seasonId]`: detalle mock de temporada, clasificación y semanas.
- `/submit`: formulario provisional de subida con vista previa local.
- `/profile`: cuenta, configuración, historial y administración mock.
- `/week`, `/leaderboard`, `/season` y `/admin`: rutas temporales de compatibilidad.

## Estado del MVP

Funciona como interfaz navegable con datos temporales. Todavia no incluye base
de datos, autenticacion, subida real de capturas ni panel admin persistente.

## Plantillas preparadas

- Estados reutilizables: empty, loading, error y placeholder.
- Tablas: leaderboard semanal, clasificación de temporada, semanas, temporadas
  e historial de submissions.
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

Los datos mock y calculos temporales estan en `lib/mock-data.ts`.

## Siguiente fase sugerida

Definir el esquema Supabase inicial, crear migraciones y conectar las lecturas
de temporada, semanas, jugadores y submissions sin activar aun autenticacion
completa.
