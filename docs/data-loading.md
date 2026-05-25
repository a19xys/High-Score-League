# Data loading

High Score League sigue usando datos mock por defecto. La lectura real de
Supabase se ha preparado de forma controlada para `seasons`, `games` y `weeks`.

## Fuente de datos

Configurar en `.env.local`:

```bash
NEXT_PUBLIC_DATA_SOURCE=mock
```

Valores soportados:

- `mock`: valor por defecto. Las paginas principales siguen usando
  `lib/mock-data.ts`.
- `supabase`: habilita pruebas aisladas de lectura real en rutas preparadas.

No se cambia automaticamente toda la aplicacion a Supabase.

## Seed de desarrollo

El archivo `supabase/seed-dev.sql` inserta datos minimos:

- Temporada I activa.
- Pretemporada cerrada.
- Temporada II en borrador.
- Juegos iniciales.
- Semana 1 activa.
- Semanas cerradas/publicadas de pretemporada.
- Semanas futuras con placeholder `Juego secreto`.

Ejecutarlo manualmente en Supabase Dashboard:

1. Abrir `SQL Editor`.
2. Pegar el contenido de `supabase/seed-dev.sql`.
3. Ejecutar despues de la migracion inicial.

El seed usa UUIDs fijos y `on conflict (id) do update`, por lo que puede
ejecutarse de nuevo durante desarrollo sin duplicar filas.

No inserta perfiles ni submissions porque dependen de usuarios reales de
Supabase Auth.

## Rutas de diagnostico

`/supabase-test` prueba conexion tecnica y Auth:

- variables;
- sesion;
- user metadata;
- perfil real;
- lectura basica de tablas.

`/real-data-test` prueba datos de dominio:

- `seasons`;
- `games`;
- `weeks`;
- temporada activa;
- semana actual;
- errores de RLS;
- si hay fallback mock.

Con las politicas actuales, `seasons`, `games` y `weeks` requieren usuario
autenticado. Si no hay sesion, `/real-data-test` muestra enlace a `/login`.

## Pagina temporal

`/seasons-real` es una pagina temporal para probar temporadas reales sin tocar
`/seasons`.

- Con `NEXT_PUBLIC_DATA_SOURCE=mock`, muestra fallback mock.
- Con `NEXT_PUBLIC_DATA_SOURCE=supabase`, intenta leer Supabase.
- Si Supabase falla y se solicita fallback, muestra mock con aviso.

La pagina publica `/seasons` sigue usando datos mock.

## Capa de datos

La lectura real esta en:

- `lib/data/seasons.ts`
- `lib/data/games.ts`
- `lib/data/weeks.ts`
- `lib/data/data-source.ts`

Las funciones devuelven resultados tipados con:

- `rows`;
- `source`;
- `error`;
- `usingFallback`.

No lanzan errores no controlados si faltan variables o si Supabase devuelve un
error.

## Pendiente

Todavia no hay:

- leaderboards reales;
- submissions reales;
- chat real;
- Storage real;
- subida real de puntuaciones;
- subida real de capturas;
- admin funcional;
- integracion con MAME.
