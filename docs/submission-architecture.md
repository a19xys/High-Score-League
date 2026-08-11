# Arquitectura de submissions

High Score League conserva cada intento en `public.submissions` y expone un
contrato web autenticado para integraciones. La API ya existe; no depende de que
la web describa el estado interno de ningún cliente concreto.

## Frontera de integración

```text
cliente autenticado
  → POST /api/submissions/ingest
  → validación de sesión, payload, semana y membership
  → public.submissions
```

`/submit` no es el flujo de producto: es una herramienta legacy/interna para
admins cuyo botón de envío manual continúa deshabilitado. El contrato detallado
del endpoint está en [Ingest API](ingest-api.md).

## Tabla `submissions`

La migración `supabase/migrations/0002_submission_events.sql` amplía
`public.submissions` con campos para eventos automáticos:

- `source`: `web`, `mame_memory`, `mame_plugin`, `local_app` o `admin_import`;
- `detected_at`: momento declarado de detección, con zona horaria;
- `submitted_at`: momento de recepción, forzado por el servidor/base de datos;
- `rom_name`, `mame_version` y `client_version`: contexto técnico opcional;
- `raw_event`: objeto JSON auxiliar para depuración y auditoría;
- `duplicate_key`: clave opcional de idempotencia.

`screenshot_path` es nullable. `screenshot_mime_type` y
`screenshot_size_bytes` reservan metadatos para evidencias futuras, pero la
aceptación de una submission no depende de una captura.

## Payload actual

La API usa nombres camelCase:

```json
{
  "weekId": "00000000-0000-0000-0000-000000000000",
  "score": 184320,
  "detectedAt": "2026-05-24T21:17:00+02:00",
  "source": "mame_memory",
  "rom": "galaga",
  "mameVersion": "0.265",
  "clientVersion": "hsl-client-0.1.0",
  "duplicateKey": "week-player-rom-score-detected-at",
  "rawEvent": {
    "machine": "galaga",
    "eventType": "score_detected"
  },
  "comment": "Evento detectado automáticamente",
  "isHidden": false
}
```

`playerId` y `submittedAt` se rechazan: el jugador se deriva de la sesión y el
timestamp de recepción lo controla el servidor. Los campos normalizados son la
fuente canónica después de la validación; `rawEvent` es auxiliar.

## Validación competitiva

El endpoint exige:

- sesión Supabase válida por cookie o bearer token;
- `score` entero y no negativo;
- `detectedAt` ISO con zona horaria explícita;
- semana existente y con `game_id` asignado;
- membership `active` del jugador en la temporada de la semana;
- estado derivado que todavía acepte submissions.

En `active`, `isHidden` es opcional y vale `false` por defecto. En `frozen`, la
API fuerza `is_hidden = true` aunque el cliente envíe `isHidden: false`. Semanas
`draft`, `closed` o `published` rechazan la submission.

La API acepta `rom` como metadato opcional, pero el código actual no comprueba
que coincida con una ROM esperada del catálogo. Esa ausencia no se corrige en
esta tarea documental.

## Reintentos e idempotencia

`duplicate_key` tiene un índice único parcial cuando no es `null`. Una
integración puede reintentar el mismo evento: si la clave ya existe, la API
responde `ok: true`, `duplicate: true` y no crea una segunda fila. La clave debe
incluir suficiente contexto para no colisionar entre jugador, semana, juego,
puntuación y momento detectado.

## Seguridad

El cliente usa una sesión de usuario y nunca `service_role`. La API deriva
`player_id`, fuerza `submitted_at`, aplica RLS y no devuelve detalles internos
del insert. La comprobación de membership dentro del endpoint es definitiva;
`GET /api/local/season-membership?weekId=...` sólo ofrece una comprobación
previa de UX para integraciones que la necesiten.

## Capturas y trabajo pendiente

Las capturas siguen siendo opcionales y no están implementadas como subida real.
Si se incorporan, deben usar un bucket privado separado de
`hsl-public-media`, paths controlados, optimización, RLS y URLs firmadas. El
Storage público de avatar, juegos y cuestionarios no debe reutilizarse para
evidencias competitivas.

La paginación actual de historiales ocurre en cliente después de cargar y
calcular el conjunto completo. `SUBMISSIONS-SERVER-PAGINATION-1` se reserva para
cuando el volumen justifique consultas paginadas, conteos e índices específicos.
