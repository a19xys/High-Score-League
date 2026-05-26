# Ingest API

Endpoint mínimo para recibir submissions automáticas desde una app local futura.
No implementa plugin MAME, app local, Storage, capturas ni admin funcional.

## Endpoint

```text
POST /api/submissions/ingest
```

Requiere sesión Supabase válida. El endpoint usa la anon key y RLS; no usa
`service_role`.

`player_id` no se acepta desde cliente. Se deriva siempre del usuario
autenticado.

`submitted_at` no se acepta desde cliente. Lo fuerza la base de datos.

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

## Estados de semana

- `active`: permite submissions visibles u ocultas. Si `isHidden` no llega, se
  usa `false`.
- `frozen`: solo permite submissions ocultas. Si `isHidden` no llega, se usa
  `true`. Si llega `false`, devuelve error.
- `draft`, `closed`, `published`: no permiten submissions.

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

Si `duplicateKey` ya existe, el endpoint no crea una segunda submission:

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

Si RLS no permite leer la fila duplicada pero el índice único la detecta, la
respuesta puede indicar duplicado con `submission: null`.

## Errores comunes

- `401`: no hay sesión válida.
- `400`: payload inválido.
- `404`: la semana no existe o no es visible.
- `409`: la semana no acepta submissions en su estado actual.
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
funcionará. La app local futura deberá autenticarse correctamente con Supabase
Auth o con el mecanismo seguro que se defina.

## Pendiente

- App local High Score League.
- Plugin MAME.
- Cola local de reintentos.
- Capturas y Storage.
- UI de pruebas dedicada.
- Admin funcional.
