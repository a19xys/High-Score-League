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
- `/archive`: shell neutral del archivo, sin sección seleccionada.
- `/archive/weeks`: archivo canónico de semanas, destino de `ARCHIVO` en la
  navegación principal y con filtro por año.
- `/archive/seasons`: archivo canónico de temporadas, con filtro por año.
- `/weeks`, `/seasons`, `/season` y los antiguos parámetros `section` mantienen
  redirecciones permanentes de compatibilidad.
- `/weeks/[weekId]`: detalle real de semana con leaderboard, submissions,
  benchmarks y resultados oficiales cuando existen.
- `/seasons/[seasonId]`: detalle real de temporada con clasificacion y podio.
- `/players/[username]`: perfil competitivo público para miembros autenticados.
- `/submit`: herramienta legacy/interna para admins, con envío manual todavía
  deshabilitado. La integración autenticada usa `POST /api/submissions/ingest`.
- `/profile`: centro personal con trayectoria real, edición, apariencia, cuenta
  y área admin separada para administradores.
- `/admin/weeks`, `/admin/games`, `/admin/seasons`, `/admin/polls`: panel admin
  minimo.
  Juegos permite metadatos múltiples y borrado seguro si no hay semanas
  asociadas.
- `/supabase-test` y `/real-data-test`: diagnostico protegido para admin.

## Marca estatica

Los assets fijos de marca se sirven desde el repositorio:

- `public/brand/logo-horizontal.png`: logo horizontal de la landing publica.
- `public/brand/logo.png`: logo cuadrado de navegacion.
- `app/icon.png`: icono de pestana.
- `app/apple-icon.png`: Apple Touch Icon.

La navegación y la landing intentan cargar estos assets directamente en el
navegador y sólo muestran su fallback textual cuando la petición de imagen
falla realmente.

Los avatares y las imágenes administrables de juegos y cuestionarios usan el
bucket público `hsl-public-media`. Los originales se procesan en el navegador y
se guardan como WebP; las URLs externas históricas siguen funcionando.

`MEDIA-UPLOADS-1` está implementada y funcional. Las migraciones
`0023_profile_bio_max_length.sql` y `0024_media_uploads.sql` ya están aplicadas
en el Supabase remoto. Esto no permite asegurar qué revisión concreta de la web
está desplegada actualmente.

## Documentacion

- [Supabase setup](docs/supabase-setup.md)
- [Auth setup](docs/auth-setup.md)
- [Carga de datos](docs/data-loading.md)
- [Modelo de datos](docs/database.md)
- [Archivo y paginación de envíos](docs/archive.md)
- [Arquitectura de submissions](docs/submission-architecture.md)
- [Ingest API](docs/ingest-api.md)
- [Contrato web para clientes](docs/launcher-api.md)
- [Resultados semanales](docs/weekly-results.md)
- [Clasificacion de temporada](docs/season-standings.md)
- [Sistema de perfiles](docs/profile-revamp.md)
- [Imágenes y Supabase Storage](docs/media-uploads.md)
- [Storage privado futuro para evidencias](docs/supabase-storage.md)
- [Chat](docs/chat.md)
- [Cuestionario de Home](docs/home-polls.md)
- [Admin](docs/admin.md)
- [Admin semanas](docs/admin-weeks.md)
- [Admin juegos](docs/admin-games.md)
- [Admin temporadas](docs/admin-seasons.md)
- [Automatizacion](docs/automation.md)
- [Checklist de despliegue](docs/deploy-checklist.md)
- [Estado del proyecto](docs/project-status.md)

## Pendiente

- `PROFILE-ANONYMIZATION-1`: baja de cuenta sin destruir la historia
  competitiva.
- `PROFILE-PRESENCE-1`, después de Anonymization: presencia y última actividad
  con privacidad propia, sin inferirlas desde Playtime.
- Storage privado de capturas y evidencias.
- Panel completo de usuarios.
- Medallas y bonus.
- Moderacion UI del chat.
- Comentarios, historial y múltiples cuestionarios de Home.
- Paginación server-side de submissions cuando el volumen lo requiera.
