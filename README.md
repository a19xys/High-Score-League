# High Score League

High Score League es una aplicacion web para organizar una liga privada de
puntuaciones arcade. La app usa Supabase para Auth, perfiles, temporadas,
semanas, juegos, submissions, leaderboards, resultados oficiales, clasificacion
de temporada, chat y administracion basica.

## Stack

- Next.js con App Router
- TypeScript
- Tailwind CSS
- Supabase

## Requisitos

- Node.js 20 o superior recomendado
- npm
- Proyecto Supabase configurado

## Ejecutar en local

Instala dependencias:

```bash
npm install
```

Crea `.env.local` a partir de `.env.example` y configura las claves publicas de
Supabase. No uses `service_role` en frontend.

Arranca el servidor de desarrollo:

```bash
npm run dev
```

Abre la aplicacion en:

```text
http://localhost:3000
```

## Rutas principales

- `/`: landing publica sin sesion; home real con sesion.
- `/game`: redirige a la semana activa real.
- `/weeks`: archivo real de semanas.
- `/weeks/[weekId]`: detalle real de semana con leaderboard, submissions,
  benchmarks y resultados oficiales cuando existen.
- `/seasons`: archivo real de temporadas.
- `/seasons/[seasonId]`: detalle real de temporada con clasificacion y podio.
- `/players/[username]`: perfil publico real.
- `/submit`: pantalla provisional de respaldo para subida manual.
- `/profile`: perfil real, ajustes y centro admin para administradores.
- `/admin/weeks`, `/admin/games`, `/admin/seasons`: panel admin minimo.
- `/supabase-test` y `/real-data-test`: diagnostico de desarrollo.

## Marca estatica

Los assets fijos de marca se sirven desde el repositorio:

- `public/brand/logo-horizontal.png`: logo horizontal de la landing publica.
- `public/brand/logo.png`: logo cuadrado de navegacion.
- `app/icon.png`: icono de pestana.
- `app/apple-icon.png`: Apple Touch Icon.

Supabase Storage queda reservado para contenido dinamico futuro.

## Documentacion

- [Supabase setup](docs/supabase-setup.md)
- [Auth setup](docs/auth-setup.md)
- [Carga de datos](docs/data-loading.md)
- [Arquitectura de submissions](docs/submission-architecture.md)
- [Ingest API](docs/ingest-api.md)
- [Resultados semanales](docs/weekly-results.md)
- [Clasificacion de temporada](docs/season-standings.md)
- [Chat](docs/chat.md)
- [Admin](docs/admin.md)
- [Admin semanas](docs/admin-weeks.md)
- [Admin juegos](docs/admin-games.md)
- [Admin temporadas](docs/admin-seasons.md)
- [Automatizacion](docs/automation.md)
- [Estado del proyecto](docs/project-status.md)

## Pendiente

- App local y plugin MAME.
- Storage real.
- Capturas reales.
- Subida manual real desde `/submit`.
- Panel completo de usuarios.
- Medallas y bonus.
- Moderacion UI del chat.
