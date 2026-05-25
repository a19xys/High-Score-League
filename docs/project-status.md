# Project status

High Score League está en fase mock avanzada.

## Estado actual

- La interfaz principal está montada con Next.js App Router, TypeScript y
  Tailwind CSS.
- Las páginas principales siguen usando `lib/mock-data.ts`.
- El mockup incluye portada, juego actual, semanas, temporadas, perfiles,
  leaderboards, chat mock, tema claro/oscuro, subida provisional y administración
  mock.
- No se debe sustituir el mockup por datos reales hasta decidir el flujo de
  conexión.

## Supabase

- Supabase ya está conectado mediante clientes de navegador y servidor.
- La prueba aislada vive en `/supabase-test`.
- La migración principal está en
  `supabase/migrations/0001_initial_schema.sql`.
- La documentación del modelo está en `docs/database.md`.
- La documentación de Storage está en `docs/supabase-storage.md`.

## Auth

- Auth mínimo está implementado con email y password.
- `/login` inicia sesión.
- `/register` crea cuenta y contempla confirmación de email.
- `/profile/setup` crea o actualiza `public.profiles` para el usuario actual.
- `/profile` muestra estado real de sesión y mantiene el perfil mock debajo.
- El primer admin se crea manualmente en Supabase SQL Editor.

## Sigue pendiente

- Lecturas reales controladas desde Supabase en páginas principales.
- Decidir políticas públicas o flujo autenticado para lectura.
- Sustitución parcial y progresiva de mock data.
- Subida real de capturas a Storage.
- Subida real de puntuaciones.
- Panel admin funcional.
- Integración con MAME.

## Próximo objetivo recomendado

Decidir si la siguiente fase será lectura real controlada de tablas o sustitución
parcial de mocks, manteniendo el mockup como fallback.
