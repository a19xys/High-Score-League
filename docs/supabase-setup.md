# Supabase setup

Esta fase mantiene las paginas principales con `lib/mock-data.ts`. Supabase se
usa de forma controlada para Auth, perfil real y diagnostico.

## Variables de entorno

Crear `.env.local` en la raiz del proyecto:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
NEXT_PUBLIC_DATA_SOURCE=mock
```

Las variables publicas se copian desde Supabase Dashboard:

- `Project Settings` -> `API` -> `Project URL`
- `Project Settings` -> `API` -> `Project API keys` -> `anon public`

`SUPABASE_SERVICE_ROLE_KEY` solo se usa en servidor para acciones de desarrollo,
como borrar la cuenta de prueba actual. Nunca debe exponerse con prefijo
`NEXT_PUBLIC_*` ni usarse en componentes cliente.

`NEXT_PUBLIC_DATA_SOURCE` controla pruebas de datos de dominio. Usa `mock` por
defecto y `supabase` solo cuando quieras probar `/real-data-test` o
`/seasons-real`.

No incluir claves reales en `.env.example`, README ni documentacion versionada.
`.env.local` esta ignorado por Git mediante `.gitignore`.

## Ejecutar la app

```bash
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000/supabase-test
```

## Que comprueba `/supabase-test`

La pagina muestra:

- variables publicas configuradas;
- si `SUPABASE_SERVICE_ROLE_KEY` existe en servidor, sin mostrar su valor;
- sesion activa;
- user id y email;
- metadata `username` e `initials`;
- perfil real de `public.profiles`;
- si metadata y perfil coinciden;
- lectura de muestra de `seasons`, `games` y `weeks`;
- errores de RLS si existen.

## Errores esperables

Si faltan variables de entorno, la pagina indica que falta configurar
`.env.local`.

Si la migracion no esta aplicada, pueden aparecer errores de tabla inexistente.

Si RLS bloquea lectura sin sesion, puede aparecer error de permisos o 0 filas
visibles. Esto es esperable hasta iniciar sesion o definir politicas publicas de
solo lectura.

Si las tablas existen pero no tienen seed, la conexion puede funcionar y mostrar
0 filas.

## Limites de esta fase

Hay Auth minimo y perfil real, pero no hay Storage real, subida de capturas,
subida de puntuaciones ni sustitucion de datos mock en las paginas principales.
