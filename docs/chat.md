# Chat de la liga

El chat de la liga es un chat global ligero para la portada. No está separado
por temporada ni por semana.

## Tabla

La migración `supabase/migrations/0006_league_chat.sql` crea:

```text
public.league_chat_messages
```

Campos principales:

- `id`
- `message_type`: `user` o `system`
- `author_id`: referencia a `profiles.id` para mensajes de usuario
- `content`
- `created_at`

Reglas:

- `content` no puede estar vacío.
- `content` tiene máximo 500 caracteres.
- si `message_type = 'user'`, `author_id` es obligatorio.
- si `message_type = 'system'`, `author_id` debe ser `null`.

## Límite de 50 mensajes

El chat solo conserva los 50 mensajes más nuevos en base de datos.

Un trigger `after insert` ejecuta `public.trim_league_chat_messages()` y elimina
cualquier mensaje que quede fuera de los 50 más recientes, ordenando por
`created_at desc, id desc`.

Esto está pensado como chat ligero, no como histórico permanente.

## Mensajes de sistema

Cuando se crea un perfil nuevo en `public.profiles`, un trigger `after insert`
crea un mensaje de sistema:

```text
username se unió al chat.
```

El mensaje usa `message_type = 'system'` y `author_id = null`.

No se crean mensajes retroactivos para perfiles existentes.

## RLS

Políticas iniciales:

- usuarios autenticados pueden leer mensajes;
- usuarios autenticados pueden insertar mensajes `user` solo como ellos mismos;
- usuarios normales no pueden insertar mensajes `system`;
- usuarios normales no pueden editar ni borrar mensajes;
- admins pueden gestionar mensajes desde SQL o futuras herramientas.

No se usa `service_role` en frontend.

## Endpoint

La app envía mensajes con:

```text
POST /api/chat/messages
```

Payload:

```json
{
  "content": "mensaje"
}
```

El endpoint:

- requiere sesión Supabase;
- recorta espacios;
- valida máximo 500 caracteres;
- rechaza `authorId` y `messageType` desde cliente;
- inserta siempre `message_type = 'user'`;
- deriva `author_id` desde el usuario autenticado.

## Home

En modo Supabase, `/` lee `league_chat_messages` y muestra los últimos 50
mensajes en orden cronológico, con los más nuevos abajo.

En modo mock, la home puede seguir mostrando mensajes mock locales.

## Realtime

La migración `0007_league_chat_realtime.sql` añade
`public.league_chat_messages` a la publicación `supabase_realtime` de forma
idempotente.

El componente de chat se suscribe a inserts de esa tabla. Cuando llega un insert,
no usa directamente el payload realtime para pintar el mensaje, porque ese
payload no trae el perfil unido. En su lugar llama a:

```text
GET /api/chat/messages
```

Ese endpoint devuelve los últimos 50 mensajes con autor normalizado. La lista se
deduplica por `id`, se ordena de más antiguos a más nuevos y se recorta a 50.

Los tiempos relativos se recalculan en cliente cada 60 segundos. Los mensajes de
menos de un minuto se muestran como `ahora mismo`.

## Pendiente

Todavía no hay:

- chat por temporada;
- chat por semana;
- moderación UI;
- borrado desde UI;
- edición de mensajes.
