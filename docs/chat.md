# Chat de la liga

El chat de la liga es un chat global ligero para la portada. No está separado
por temporada ni por semana.

## Tabla

La migración `supabase/migrations/0006_league_chat.sql` crea:

```text
public.league_chat_messages
```

La migración `0014_league_chat_message_editing.sql` añade `edited_at` y la
política de edición del último mensaje propio durante 15 minutos.

Campos principales:

- `id`
- `message_type`: `user` o `system`
- `author_id`: referencia a `profiles.id` para mensajes de usuario
- `content`
- `created_at`
- `edited_at`: fecha de última edición, `null` si no se ha editado

Reglas:

- `content` no puede estar vacío.
- `content` tiene máximo 65.536 caracteres.
- si `message_type = 'user'`, `author_id` es obligatorio.
- si `message_type = 'system'`, `author_id` debe ser `null`.

## Límite de 75 mensajes

El chat solo conserva los 75 mensajes más nuevos en base de datos.

Un trigger `after insert` ejecuta `public.trim_league_chat_messages()` y elimina
cualquier mensaje que quede fuera de los 75 más recientes, ordenando por
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
- usuarios autenticados pueden editar solo su último mensaje propio de tipo
  `user` durante los 15 minutos posteriores a `created_at`;
- usuarios normales no pueden insertar mensajes `system`;
- usuarios normales no pueden borrar mensajes;
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
- valida máximo 65.536 caracteres;
- rechaza `authorId` y `messageType` desde cliente;
- inserta siempre `message_type = 'user'`;
- deriva `author_id` desde el usuario autenticado.

La edición usa:

```text
PATCH /api/chat/messages/[messageId]
```

Payload:

```json
{
  "content": "mensaje editado"
}
```

El endpoint:

- requiere sesión Supabase;
- rechaza `authorId`, `messageType`, `createdAt` y `editedAt` desde cliente;
- permite editar solo el último mensaje propio de tipo `user`;
- limita la edición a 15 minutos desde `created_at`;
- actualiza `edited_at` en servidor/base de datos;
- devuelve `MESSAGE_NOT_EDITABLE` si el mensaje ya no puede editarse.

## Home

En modo Supabase, `/` lee `league_chat_messages` y muestra los últimos 75
mensajes en orden cronológico, con los más nuevos abajo.

La home muestra chat real para usuarios autenticados; no hay mensajes locales de producto.

Los mensajes de usuario se renderizan como texto seguro, sin HTML crudo. El
cliente soporta solo formato básico:

- líneas que empiezan por `>` como cita;
- `_texto_` como cursiva;
- `*texto*` como negrita.

No se usa Markdown completo, autolinks, imágenes ni `dangerouslySetInnerHTML`.
Los mensajes de otros usuarios muestran un avatar pequeño fuera del bocadillo;
los mensajes propios no muestran avatar externo.

## Realtime

La migración `0007_league_chat_realtime.sql` añade
`public.league_chat_messages` a la publicación `supabase_realtime` de forma
idempotente.

El componente de chat se suscribe a inserts y updates de esa tabla. Cuando llega
un cambio, no usa directamente el payload realtime para pintar el mensaje,
porque ese payload no trae el perfil unido. En su lugar llama a:

```text
GET /api/chat/messages
```

Ese endpoint devuelve los últimos 75 mensajes con autor normalizado. La lista se
deduplica por `id`, se ordena de más antiguos a más nuevos y se recorta a 75.

Los tiempos relativos se recalculan en cliente cada 60 segundos. Los mensajes de
menos de un minuto se muestran como `ahora mismo`.

Como respaldo, el componente también hace polling cada 10 segundos mientras hay
sesión activa. Usa el mismo `GET /api/chat/messages`, normaliza por `id` y
mantiene solo los últimos 75 mensajes.

## Pendiente

Todavía no hay:

- chat por temporada;
- chat por semana;
- moderación UI;
- borrado desde UI;
- historial de ediciones.

