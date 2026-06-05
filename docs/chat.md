# Chat de la liga

El chat de la liga es un chat global ligero para la portada. No estÃ¡ separado
por temporada ni por semana.

## Tabla

La migraciÃ³n `supabase/migrations/0006_league_chat.sql` crea:

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

- `content` no puede estar vacÃ­o.
- `content` tiene mÃ¡ximo 2000 caracteres en la validaciÃ³n de app y endpoint.
- si `message_type = 'user'`, `author_id` es obligatorio.
- si `message_type = 'system'`, `author_id` debe ser `null`.

## LÃ­mite de 50 mensajes

El chat solo conserva los 50 mensajes mÃ¡s nuevos en base de datos.

Un trigger `after insert` ejecuta `public.trim_league_chat_messages()` y elimina
cualquier mensaje que quede fuera de los 50 mÃ¡s recientes, ordenando por
`created_at desc, id desc`.

Esto estÃ¡ pensado como chat ligero, no como histÃ³rico permanente.

## Mensajes de sistema

Cuando se crea un perfil nuevo en `public.profiles`, un trigger `after insert`
crea un mensaje de sistema:

```text
username se uniÃ³ al chat.
```

El mensaje usa `message_type = 'system'` y `author_id = null`.

No se crean mensajes retroactivos para perfiles existentes.

## RLS

PolÃ­ticas iniciales:

- usuarios autenticados pueden leer mensajes;
- usuarios autenticados pueden insertar mensajes `user` solo como ellos mismos;
- usuarios normales no pueden insertar mensajes `system`;
- usuarios normales no pueden editar ni borrar mensajes;
- admins pueden gestionar mensajes desde SQL o futuras herramientas.

No se usa `service_role` en frontend.

## Endpoint

La app envÃ­a mensajes con:

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

- requiere sesiÃ³n Supabase;
- recorta espacios;
- valida mÃ¡ximo 2000 caracteres;
- rechaza `authorId` y `messageType` desde cliente;
- inserta siempre `message_type = 'user'`;
- deriva `author_id` desde el usuario autenticado.

## Home

En modo Supabase, `/` lee `league_chat_messages` y muestra los Ãºltimos 50
mensajes en orden cronolÃ³gico, con los mÃ¡s nuevos abajo.

La home muestra chat real para usuarios autenticados; no hay mensajes locales de producto.

## Realtime

La migraciÃ³n `0007_league_chat_realtime.sql` aÃ±ade
`public.league_chat_messages` a la publicaciÃ³n `supabase_realtime` de forma
idempotente.

El componente de chat se suscribe a inserts de esa tabla. Cuando llega un insert,
no usa directamente el payload realtime para pintar el mensaje, porque ese
payload no trae el perfil unido. En su lugar llama a:

```text
GET /api/chat/messages
```

Ese endpoint devuelve los Ãºltimos 50 mensajes con autor normalizado. La lista se
deduplica por `id`, se ordena de mÃ¡s antiguos a mÃ¡s nuevos y se recorta a 50.

Los tiempos relativos se recalculan en cliente cada 60 segundos. Los mensajes de
menos de un minuto se muestran como `ahora mismo`.

Como respaldo, el componente tambiÃ©n hace polling cada 10 segundos mientras hay
sesiÃ³n activa. Usa el mismo `GET /api/chat/messages`, normaliza por `id` y
mantiene solo los Ãºltimos 50 mensajes.

## Pendiente

TodavÃ­a no hay:

- chat por temporada;
- chat por semana;
- moderaciÃ³n UI;
- borrado desde UI;
- ediciÃ³n de mensajes.


