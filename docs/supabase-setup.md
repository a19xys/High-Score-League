# Supabase setup

Esta fase solo prepara la conexión. Las páginas principales siguen usando
`lib/mock-data.ts`.

## Variables de entorno

Crear un archivo `.env.local` en la raíz del proyecto:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

Las dos variables se copian desde Supabase Dashboard:

- `Project Settings` → `API` → `Project URL`
- `Project Settings` → `API` → `Project API keys` → `anon public`

No incluir claves reales en `.env.example`, README ni documentación versionada.
No usar nunca `service_role` en frontend ni en variables `NEXT_PUBLIC_*`.

`.env.local` ya está ignorado por Git mediante `.gitignore`.

## Ejecutar la app

```bash
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000/supabase-test
```

## Qué comprueba `/supabase-test`

La página intenta leer una muestra de:

- `seasons`
- `games`
- `weeks`

Muestra estado de conexión, número de filas, errores de Supabase y algunas filas
si existen.

## Errores esperables

Si faltan variables de entorno, la página muestra qué variables hay que añadir a
`.env.local`.

Si el proyecto Supabase existe pero todavía no se ha aplicado la migración,
pueden aparecer errores como tabla inexistente.

Si la migración está aplicada pero RLS bloquea lectura sin sesión, puede aparecer
un error de permisos o una respuesta sin filas visibles. Esto es esperable hasta
implementar Auth real o decidir políticas públicas de solo lectura.

Si las tablas existen pero no tienen seed, la conexión puede funcionar y mostrar
0 filas.

## Límites de esta fase

No hay login, registro, subida de capturas, Storage real ni sustitución de datos
mock. Esta página es una prueba aislada para confirmar que Next.js puede hablar
con Supabase usando la anon key.
