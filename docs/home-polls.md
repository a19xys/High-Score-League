# Cuestionario único de Home

High Score League tiene un cuestionario de una sola pregunta en Home para
usuarios registrados.

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
- `enabled = true`: el cuestionario puede aparecer en Home si está abierto y
  tiene al menos dos opciones.
- `closes_at`: fecha de cierre. Si ya pasó, el cuestionario se considera
  cerrado. Para habilitarlo desde admin, la fecha debe estar en el futuro.

En `/admin/polls` el admin elige solo el día de cierre. La app lo guarda como
`23:59:59` de ese día en `Europe/Madrid`.

## Opciones

El panel admin permite gestionar de 2 a 32 opciones. Las opciones vacías no se
aceptan y no se permiten duplicados exactos normalizados.

Cada opción puede tener como máximo 80 caracteres.

Desde `0022_home_poll_option_images.sql`, las opciones pueden incluir
`image_url` opcional. La URL debe empezar por `http://` o `https://`; no hay
subida de archivos ni Supabase Storage para imágenes del cuestionario.

Regla visual: un cuestionario usa imágenes en todas sus opciones o en ninguna.
No se permite mezclar algunas opciones con imagen y otras sin imagen. Si no hay
imágenes, la tarjeta de Home no reserva espacio ni muestra placeholder.

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

## Home

La tarjeta se renderiza en la Home privada, por encima del bloque principal de
liga. No aparece en la landing pública.

Solo se muestra si:

- hay usuario autenticado;
- el cuestionario está `enabled`;
- `closes_at > now()`;
- la pregunta no está vacía;
- hay al menos dos opciones.

Antes de votar, el usuario ve pregunta, fecha de cierre y opciones, pero no
porcentajes ni número de votos.

Después de votar, ve:

- opción elegida;
- mini imagen si todas las opciones tienen `image_url`;
- porcentajes por opción;
- votos por opción en pantallas con espacio;
- total de votos;
- barras animadas proporcionales.

Los textos largos de opciones se limitan visualmente a dos líneas para evitar
filas descompensadas.

El usuario puede cambiar su voto mientras el cuestionario siga abierto.

## API pública

`GET /api/home-poll`

- requiere sesión;
- devuelve `poll: null` si no hay cuestionario visible;
- no devuelve estadísticas si el usuario no ha votado;
- devuelve agregados si el usuario ya votó.

`POST /api/home-poll/vote`

- requiere sesión;
- recibe solo `optionId`;
- no acepta `playerId`;
- inserta o actualiza el voto propio;
- no permite votar cuestionarios cerrados o deshabilitados;
- no permite votar una opción de otro poll.

Los agregados se calculan en servidor. No se devuelven votos individuales de
otros usuarios.

## Realtime

La migración `0021_home_poll_votes_realtime.sql` añade `home_poll_votes` a la
publicación `supabase_realtime`.

La tarjeta se suscribe a cambios en `home_poll_votes`. Cuando llega un evento,
hace refetch de `GET /api/home-poll`; así no usa el payload realtime para
mostrar datos sensibles. También hay polling de respaldo cada 10 segundos.

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

- comentarios;
- historial de cuestionarios;
- múltiples cuestionarios simultáneos.
