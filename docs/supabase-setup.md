# Supabase setup

High Score League usa Supabase como fuente de datos de producto. Esta guia
resume la configuracion local necesaria.

## Variables de entorno

Crear `.env.local` en la raiz del proyecto:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
CRON_SECRET=un_secreto_largo
```

Las variables publicas se copian desde Supabase Dashboard:

- `Project Settings` -> `API` -> `Project URL`
- `Project Settings` -> `API` -> `Project API keys` -> `anon public`

`SUPABASE_SERVICE_ROLE_KEY` solo se usa en servidor para acciones concretas de
desarrollo o administracion server-side. Nunca debe exponerse con prefijo
`NEXT_PUBLIC_*` ni usarse en componentes cliente.

No incluir claves reales en `.env.example`, README ni documentacion versionada.
`.env.local` esta ignorado por Git mediante `.gitignore`.

## Ejecutar la app

```bash
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000
```

## Diagnostico

`/supabase-test` es una ruta de diagnostico protegida para admin y comprueba:

- variables publicas configuradas;
- si `SUPABASE_SERVICE_ROLE_KEY` existe en servidor, sin mostrar su valor;
- sesion activa;
- user id y email;
- metadata `username` e `initials`;
- perfil real de `public.profiles`;
- lectura basica de `seasons`, `games` y `weeks`;
- errores de RLS si existen.

`/real-data-test` es una ruta de diagnostico protegida para admin y comprueba
datos de dominio reales.

## Errores esperables

Si faltan variables de entorno, las paginas de diagnostico indican que falta
configurar `.env.local`.

Si la migracion no esta aplicada, pueden aparecer errores de tabla inexistente.

Si RLS bloquea lectura sin sesion, puede aparecer error de permisos o 0 filas
visibles. Las rutas privadas de producto requieren usuario autenticado.

Si las tablas existen pero no tienen seed o datos reales, la conexion puede
funcionar y mostrar 0 filas.
