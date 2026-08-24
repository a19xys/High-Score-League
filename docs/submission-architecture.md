# Arquitectura de submissions

High Score League conserva cada intento en `public.submissions` y expone un
contrato web autenticado para integraciones. La API ya existe; no depende de que
la web describa el estado interno de ningún cliente concreto.

## Frontera de integración

```text
cliente autenticado
  → POST /api/submissions/ingest
  → validación de sesión, perfil y autoridad competitiva server-side
  → INSERT normalizado con service role sólo en servidor
  → public.submissions
```

`/submit` no es el flujo de producto: es una herramienta legacy/interna para
admins cuyo botón de envío manual continúa deshabilitado. El contrato detallado
del endpoint está en [Ingest API](ingest-api.md).

## Tabla `submissions`

La migración `supabase/migrations/0002_submission_events.sql` amplía
`public.submissions` con campos para eventos automáticos:

- `source`: `web`, `mame_memory`, `mame_plugin`, `local_app` o `admin_import`;
- `detected_at`: momento competitivo canónico de detección, con zona horaria;
- `submitted_at`: momento de recepción y auditoría, forzado por el servidor;
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
- ventana histórica válida en `detectedAt`.

La captura se acepta desde `public_start_at` (incluido) hasta
`final_deadline_at` (excluido). Desde `public_freeze_at` se fuerza
`is_hidden = true`. El estado actual de la semana no invalida una captura que
ocurrió dentro de esa ventana; se toleran 10 minutos de adelanto de reloj y no
se impone antigüedad máxima.

En una week legacy, `rom` conserva su semántica histórica. Cuando existe una
fila en `week_competition_policies`, ROM, MAME, plugin, source, DIPs, pack,
manifest y artifact se comparan contra la policy y `launcher_packs` canónicos.
La DB deriva un `policy_fingerprint` de ese contrato completo; WEB persiste la
copia exacta en `competition_policy_fingerprint` y el INSERT la revalida bajo
row lock antes de fijar `frozen_at` atómicamente.
El contrato completo está en [WEB Competition Integrity 1](web-competition-integrity-1.md).

## Reintentos e idempotencia

`duplicate_key` tiene un índice único parcial por `(player_id, duplicate_key)`
cuando no es `null`. Una
integración puede reintentar el mismo evento: si la clave ya existe, la API
responde `ok: true`, `duplicate: true` y no crea una segunda fila. La clave debe
incluir suficiente contexto para no colisionar entre jugador, semana, juego,
puntuación y momento detectado.

Para Protected v2, WEB no confía en la clave recibida: deriva `playerBinding`,
recalcula `hsl:v2` con week, binding, pack, manifest, run y candidate, compara
el input y persiste siempre el resultado server-side. Un segundo índice impide
reutilizar el mismo candidate dentro del mismo jugador, pack y run.

El launcher conserva respuestas temporales o ambiguas en `pending`, anomalías
técnicas en `failed` y rechazos de dominio conclusivos en una caja interna
`rejected`. Esta última mantiene el JSON original y una nota saneada, pero no se
expone en Actividad ni se reintenta. Los fallos legacy con nota genérica HTTP 409
se reclasifican una sola vez a `pending` para poder obtener el nuevo código.

## Seguridad

El cliente usa una sesión de usuario y nunca recibe `service_role`. La API usa
la sesión para Auth y perfil, deriva `player_id`, fuerza `submitted_at` y crea
un cliente admin únicamente dentro del servidor para policy, duplicate e
INSERT. `0034` revoca INSERT y DELETE directo a `authenticated`, limita UPDATE
admin a `is_valid`/`is_hidden` y añade guards DB para INSERT e historial
Protected. La comprobación de membership dentro del endpoint es definitiva;
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

## Cuentas anonimizadas

La baja conserva cada submission, su puntuación, semana, estado, timestamps,
comentario, captura y `rom_name`, porque siguen formando parte del registro
competitivo y de su procedencia. Limpia `raw_event`, `mame_version`,
`client_version` y `duplicate_key`, que son metadata técnica prescindible y
podrían identificar el entorno del usuario. Conservar `rom_name` permite auditar
la ROM asociada a la captura sin mantener versión de cliente ni payload crudo.
En Protected también conserva pack, versión de Integrity, manifest y policy
fingerprint canónicos, pero limpia run y candidate, que identifican una
ejecución individual.

Los historiales proyectan el tombstone `DEL` sin enlace, avatar, bio ni hover.
El UUID estable evita romper resultados y rankings. La API de ingest exige un
perfil activo, por lo que un usuario anonimizado no puede crear nuevas filas ni
usar un token anterior para seguir compitiendo.
