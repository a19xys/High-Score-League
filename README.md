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

- `/`: portada publica de la liga, juego activo y top 3 semanal.
- `/game`: página del juego activo, reglas y leaderboard semanal.
- `/weeks`: tabla completa del leaderboard semanal.
- `/seasons`: clasificación general de temporada.
- `/submit`: formulario provisional de subida de puntuación.
- `/profile`: perfil mock y administración provisional.
- `/week`, `/leaderboard`, `/season` y `/admin`: rutas temporales de compatibilidad.

## Estado del MVP

Funciona como interfaz navegable con datos temporales. Todavia no incluye base
de datos, autenticacion, subida real de capturas ni panel admin persistente.

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
