# Administración mínima

El panel admin mínimo sirve para gestionar el flujo semanal sin SQL manual.

No sustituye todavía a un panel completo de temporadas, juegos, usuarios,
medallas, Storage ni MAME.

## Acceso

El centro admin aparece en `/profile` solo si el perfil real del usuario tiene:

```sql
is_admin = true
```

La UI oculta el centro a usuarios normales, pero todas las rutas y endpoints
admin vuelven a comprobar `is_admin` en servidor.

## Centro admin en `/profile`

El bloque de administración contiene:

- Semana actual.
- Todas las semanas.
- Temporadas como placeholder.
- Juegos como placeholder.
- Usuarios como placeholder.

`Publicar resultados` y `Revisar submissions` no son tarjetas separadas porque
pertenecen a una semana concreta. Se gestionan desde `/admin/weeks/[weekId]`.

## Semana actual

`/admin/weeks/current` resuelve la semana real con `status = active`:

- si hay una sola semana activa, redirige a `/admin/weeks/[weekId]`;
- si no hay semana activa, redirige a `/admin/weeks`;
- si hay varias semanas activas, redirige a `/admin/weeks` para revisar la
  configuración.

## Todas las semanas

`/admin/weeks` lista semanas reales con:

- temporada;
- número de semana;
- juego;
- estado;
- rango de fechas;
- número de submissions;
- número de submissions inválidas;
- si tiene `weekly_results`;
- enlace a gestionar semana.

No incluye filtros complejos todavía.

## Gestión de una semana

`/admin/weeks/[weekId]` muestra:

- temporada, semana, juego y estado;
- fechas principales;
- benchmarks activos;
- leaderboard vivo desde submissions visibles;
- submissions reales de la semana;
- `weekly_results` oficiales si existen;
- acciones admin.

## Estados de semana

Endpoint:

```text
PATCH /api/admin/weeks/[weekId]/status
```

Payload:

```json
{
  "status": "closed"
}
```

Estados permitidos:

- `draft`;
- `active`;
- `frozen`;
- `closed`;
- `published`.

En esta fase MVP se permiten cambios manuales entre estados válidos para
facilitar pruebas. No se automatizan fechas.

## Revisión de submissions

Endpoint:

```text
PATCH /api/admin/submissions/[submissionId]
```

Payload:

```json
{
  "isValid": false
}
```

Permite marcar una submission como válida o inválida.

No permite:

- borrar submissions;
- cambiar score;
- cambiar jugador;
- tocar capturas o Storage.

## Preview de resultados

Desde `/admin/weeks/[weekId]`, el botón `Preview resultados` llama a:

```text
POST /api/admin/weeks/[weekId]/weekly-results
```

con:

```json
{
  "dryRun": true
}
```

Devuelve preview sin escribir en `weekly_results`.

La UI muestra:

- rank;
- jugador;
- puntuación final;
- puntos;
- banderas de podio;
- `cutoffAt`;
- miembros elegibles.

## Generar resultados oficiales

El botón `Generar resultados oficiales` llama al mismo endpoint con:

```json
{
  "dryRun": false
}
```

Solo está habilitado si la semana está `closed` o `published`.

El endpoint reemplaza los `weekly_results` anteriores de esa semana de forma
controlada.

## Publicar semana

En esta fase se deja un flujo explícito dentro de la misma página:

1. Cerrar semana.
2. Generar resultados oficiales.
3. Marcar publicada.

El botón `Publicar semana` marca `published` solo si la semana ya está cerrada
o publicada. No genera resultados automáticamente.

## Cuentas de prueba

La opción actual de borrar cuenta se mantiene como herramienta de desarrollo.

En producción, borrar cuenta debería sustituirse por desactivar y anonimizar el
usuario para no romper competiciones pasadas o en curso. Esto queda documentado,
pero no se implementa todavía.

## Pendiente

- Panel completo de temporadas.
- Panel completo de juegos.
- Panel completo de usuarios.
- Creación avanzada de semanas.
- Medallas.
- Storage y capturas.
- Plugin MAME y app local.
