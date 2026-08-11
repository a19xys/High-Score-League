# Ingest API

Endpoint web implementado para recibir submissions automáticas desde clientes
autenticados. Este documento describe el contrato HTTP; el estado interno de
cada cliente se documenta fuera de la documentación web.

## Endpoint

```text
POST /api/submissions/ingest
```

Requiere sesión Supabase válida. El endpoint usa la anon key y RLS; no usa
`service_role`.

`playerId` no se acepta desde cliente. `player_id` se deriva siempre del usuario
autenticado.

`submittedAt` no se acepta desde cliente. `submitted_at` lo fuerza la base de
datos y solo registra la recepción. `detectedAt`/`detected_at` es el timestamp
competitivo canónico: la aceptación se decide contra las fechas de la semana en
ese instante, aunque la sincronización llegue después del cierre o publicación.

El usuario autenticado debe pertenecer a la temporada de la semana. La
membership se comprueba con `season_memberships.season_id = weeks.season_id`,
`season_memberships.player_id = auth user id` y `status = 'active'`.

## Payload

```json
{
  "weekId": "00000000-0000-0000-0000-000000000000",
  "score": 231900,
  "detectedAt": "2026-05-24T22:08:00+02:00",
  "source": "mame_memory",
  "rom": "galaga",
  "mameVersion": "0.265",
  "clientVersion": "hsl-local-0.1.0",
  "comment": "Evento detectado desde memoria",
  "rawEvent": {
    "eventType": "memory_score_detected",
    "test": true
  },
  "duplicateKey": "test-week-player-231900",
  "isHidden": false
}
```

Campos:

- `weekId`: obligatorio.
- `score`: entero obligatorio, mayor o igual que 0.
- `detectedAt`: fecha ISO obligatoria con zona horaria explícita.
- `source`: `web`, `mame_memory`, `mame_plugin`, `local_app` o `admin_import`.
- `rom`: opcional, pero si se envía no puede estar vacío.
- `mameVersion`: opcional, no vacío si se envía.
- `clientVersion`: opcional, no vacío si se envía.
- `comment`: opcional, máximo 500 caracteres.
- `rawEvent`: opcional, debe ser objeto JSON.
- `duplicateKey`: opcional, no vacío si se envía.
- `isHidden`: opcional.

## Ventana histórica

- antes de `public_start_at`: rechazo `WEEK_NOT_OPEN_AT_DETECTION`;
- desde apertura hasta `public_freeze_at`: acepta visible u oculta;
- desde freeze hasta `final_deadline_at`: acepta y fuerza `is_hidden = true`;
- desde el deadline: rechazo `WEEK_CLOSED_AT_DETECTION`;
- sin apertura o deadline válidos: rechazo `WEEK_WINDOW_UNAVAILABLE`.

Si no existe freeze, toda la ventana abierta es visible. El estado actual
`closed` o `published` no invalida una captura históricamente válida. Se toleran
como máximo 10 minutos de adelanto de reloj; más produce
`DETECTED_AT_IN_FUTURE`. No existe una antigüedad máxima artificial.

## Membresia de temporada

Solo usuarios unidos a la temporada de la semana pueden enviar puntuaciones.
Si el usuario autenticado no tiene una fila activa en `season_memberships`, el
endpoint rechaza la submission:

```json
{
  "ok": false,
  "code": "NOT_SEASON_MEMBER",
  "error": "No perteneces a la temporada de esta semana."
}
```

El cliente integrador debe tratar `NOT_SEASON_MEMBER` como rechazo de dominio
conclusivo para ese evento, informar al jugador y no reintentarlo en bucle.

## Comprobación previa opcional

Un cliente puede consultar la misma regla antes de iniciar una competición:

```text
GET /api/local/season-membership?weekId=<weekId>
Authorization: Bearer <access_token>
```

Este endpoint usa la anon key y la sesion del usuario, no `service_role`.
Devuelve estados normalizados como `member`, `not_member`, `invalid_week`,
`unauthenticated` o `error`. Es solo una mejora de UX: el endpoint de ingest
sigue siendo la comprobacion definitiva antes de aceptar una submission.

## Respuesta de éxito

```json
{
  "ok": true,
  "duplicate": false,
  "submission": {
    "id": "SUBMISSION_ID",
    "weekId": "WEEK_ID",
    "playerId": "AUTH_USER_ID",
    "score": 231900,
    "isHidden": false,
    "isValid": true,
    "source": "mame_memory",
    "detectedAt": "2026-05-24T22:08:00+02:00",
    "submittedAt": "2026-05-24T22:08:04.000000+00:00",
    "duplicateKey": "test-week-player-231900"
  }
}
```

## Respuesta de duplicado

Si `duplicateKey` ya existe para el jugador y sus campos canónicos (`weekId`,
`score`, `detectedAt`) coinciden, el endpoint no crea una segunda submission:

```json
{
  "ok": true,
  "duplicate": true,
  "submission": {
    "id": "SUBMISSION_ID",
    "submittedAt": "2026-05-24T22:08:04.000000+00:00"
  }
}
```

Esta comprobación ocurre antes de volver a validar semana o membership, por lo
que un evento ya aceptado continúa respondiendo como duplicado tras el cierre.
La misma clave con campos distintos devuelve `DUPLICATE_KEY_CONFLICT`.

## Errores comunes

- `403` con `code = "NOT_SEASON_MEMBER"`: el usuario no pertenece a la temporada.
- `404` con `code = "WEEK_NOT_FOUND"`: la semana no existe o no es visible.
- `409` con un código `WEEK_*_AT_DETECTION`: la captura quedó fuera de ventana.
- `409` con `code = "DUPLICATE_KEY_CONFLICT"`: colisión canónica de idempotencia.
- `409` con `code = "SUBMISSION_POLICY_REJECTED"`: API y RLS discrepan; requiere
  diagnóstico técnico.

- `401`: no hay sesión válida.
- `400`: payload inválido.
- `404`, `403` o `409` sin `code`: respuesta legacy ambigua; el cliente debe
  conservar el evento pendiente.
- `500`: error controlado de Supabase o configuración.

No se devuelven detalles internos sensibles del insert.

## Prueba desde navegador autenticado

Desde una página con sesión activa, el navegador puede enviar cookies de sesión:

```ts
await fetch("/api/submissions/ingest", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    weekId: "WEEK_ID",
    score: 231900,
    detectedAt: "2026-05-24T22:08:00+02:00",
    source: "mame_memory",
    rom: "galaga",
    duplicateKey: "test-WEEK_ID-USER-231900",
  }),
});
```

También se puede enviar un token válido:

```ts
await fetch("/api/submissions/ingest", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify(payload),
});
```

`curl` sin cookies de sesión o sin `Authorization: Bearer <access_token>` no
funcionará. Cualquier cliente debe autenticarse correctamente con Supabase Auth.

## Auditoria de submissions sin membership

Para detectar submissions ya existentes de usuarios que no pertenecen a la
temporada correspondiente:

```sql
select
  sub.id as submission_id,
  sub.week_id,
  w.season_id,
  sub.player_id,
  p.username,
  sub.score,
  sub.source,
  sub.duplicate_key,
  sub.submitted_at,
  sub.is_valid,
  sub.is_hidden
from public.submissions sub
join public.weeks w
  on w.id = sub.week_id
left join public.profiles p
  on p.id = sub.player_id
left join public.season_memberships sm
  on sm.season_id = w.season_id
 and sm.player_id = sub.player_id
 and sm.status = 'active'
where sm.id is null
order by sub.submitted_at desc;
```

Para invalidarlas manualmente en desarrollo o auditoria:

```sql
update public.submissions sub
set
  is_valid = false,
  comment = coalesce(sub.comment, '') || ' [INVALIDADA: jugador no unido a la temporada]'
from public.weeks w
where w.id = sub.week_id
  and not exists (
    select 1
    from public.season_memberships sm
    where sm.season_id = w.season_id
      and sm.player_id = sub.player_id
      and sm.status = 'active'
  );
```

Este SQL es solo de auditoria; no se ejecuta automaticamente desde la app.

## Fuera del alcance actual

- capturas y Storage privado de evidencias;
- una UI web de prueba dedicada; `/submit` continúa como herramienta admin
  legacy con el envío deshabilitado;
- decisiones de reintento, cola y UX propias de cada cliente.
