# Cuestionario único de Home

High Score League tiene preparada la base para un cuestionario de una sola
pregunta en Home. En esta fase solo existe gestión admin y seguridad de datos;
la tarjeta pública y el voto desde Home llegarán en `HOME-POLL-1B`.

## Modelo

La migración `supabase/migrations/0020_home_polls.sql` crea:

- `home_polls`: singleton del cuestionario.
- `home_poll_options`: opciones de respuesta.
- `home_poll_votes`: voto editable de cada usuario.

`home_polls` usa `singleton_key boolean not null default true unique check
(singleton_key)` para garantizar que solo pueda existir un cuestionario.

## Enabled y cierre

- `enabled = false`: el cuestionario queda deshabilitado aunque tenga fecha
  futura.
- `enabled = true`: el cuestionario está preparado para aparecer en Home cuando
  se implemente la tarjeta pública.
- `closes_at`: fecha de cierre. Si ya pasó, el cuestionario se considera
  cerrado. Para habilitarlo desde admin, la fecha debe estar en el futuro.

## Opciones

El panel admin permite gestionar de 2 a 32 opciones. Las opciones vacías no se
aceptan y no se permiten duplicados exactos normalizados.

Al eliminar una opción, sus votos asociados se eliminan por cascada. Para empezar
un cuestionario nuevo sin conservar votos anteriores, usa `Reiniciar
cuestionario`.

## Votos

Cada usuario autenticado puede tener un único voto por cuestionario:

```sql
unique (poll_id, player_id)
```

El voto puede actualizarse mientras el cuestionario siga habilitado y abierto.
La tabla exige que `option_id` pertenezca al mismo `poll_id` mediante FK
compuesta.

## Seguridad

RLS está activa en las tres tablas.

- Admin puede gestionar todo.
- Usuarios autenticados solo pueden leer polls/opciones habilitados, abiertos y
  con pregunta.
- Usuarios autenticados solo pueden leer su propio voto.
- Usuarios autenticados solo pueden insertar o actualizar su propio voto en un
  poll habilitado y abierto.
- No se exponen votos individuales ajenos.

El panel `/admin/polls` usa `requireAdmin`; usuarios no admin no pueden acceder
ni modificar el cuestionario por API.

## Panel admin

Ruta:

```text
/admin/polls
```

Permite:

- editar pregunta;
- configurar fecha y hora de cierre;
- habilitar o deshabilitar;
- añadir, ordenar por posición visual y eliminar opciones;
- ver estadísticas agregadas;
- reiniciar el cuestionario.

El reinicio borra opciones y votos anteriores, conserva el singleton y deja el
cuestionario deshabilitado.

## Pendiente

Queda para `HOME-POLL-1B`:

- tarjeta pública en Home;
- voto desde Home;
- resultados visuales públicos;
- Realtime o polling;
- comentarios;
- historial de cuestionarios;
- múltiples cuestionarios simultáneos.
