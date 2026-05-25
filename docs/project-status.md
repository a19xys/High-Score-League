# Project status

High Score League esta en fase mock avanzada.

## Estado actual

- La interfaz principal esta montada con Next.js App Router, TypeScript y
  Tailwind CSS.
- Las paginas principales siguen usando `lib/mock-data.ts`, salvo `/seasons`,
  `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y `/game`, que pueden leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`.
- El mockup incluye portada, juego actual, semanas, temporadas, perfiles,
  leaderboards, chat mock, tema claro/oscuro, subida provisional y administracion
  mock.
- No se debe sustituir el mockup por datos reales hasta decidir el flujo de
  conexion.

## Supabase

- Supabase ya esta conectado mediante clientes de navegador y servidor.
- La prueba aislada vive en `/supabase-test`.
- La prueba de datos de dominio vive en `/real-data-test`.
- `/seasons`, `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y `/game`
  pueden leer datos reales con fallback mock.
- La pagina temporal `/seasons-real` queda como comparativa visual.
- La migracion principal esta en
  `supabase/migrations/0001_initial_schema.sql`.
- El seed de desarrollo esta en `supabase/seed-dev.sql`.
- La documentacion del modelo esta en `docs/database.md`.
- La documentacion de Storage esta en `docs/supabase-storage.md`.
- La documentacion de carga de datos esta en `docs/data-loading.md`.

## Auth

- Auth minimo esta implementado con email y password.
- `/register` crea cuenta, guarda `username` e `initials` en `user_metadata` y
  crea perfil si hay sesion inmediata.
- `/login` inicia sesion y asegura perfil desde un unico helper idempotente.
- `/profile` es el centro unico de perfil real: muestra sesion, email, perfil,
  formulario inline si falta perfil y edicion de username/siglas.
- `/profile/setup` queda como ruta legacy y no forma parte del flujo normal.
- El borrado de cuentas de prueba existe en `/profile` mediante route handler de
  servidor y `SUPABASE_SERVICE_ROLE_KEY`.
- El primer admin se crea manualmente en Supabase SQL Editor.

## Sigue pendiente

- Conectar leaderboards y submissions reales de forma progresiva.
- Decidir politicas publicas o flujo autenticado para lectura.
- Sustitucion parcial y progresiva de mock data.
- Subida real de capturas a Storage.
- Subida real de puntuaciones.
- Panel admin funcional.
- Integracion con MAME.

## Proximo objetivo recomendado

El siguiente paso sera conectar submissions reales de solo lectura para poder
construir el leaderboard semanal sin activar todavia subida de puntuaciones.
