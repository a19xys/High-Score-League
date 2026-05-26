# Submission architecture

High Score League prepara las submissions para un flujo futuro automatizado.
Ya existe lectura de solo lectura para construir leaderboards desde submissions
visibles y un endpoint mínimo autenticado para ingestión. Todavía no implementa
plugin MAME, app local, Storage ni capturas reales.

## Vision futura

El flujo principal previsto sera:

1. Un plugin de MAME detecta un evento de puntuacion.
2. El plugin escribe un evento JSON local.
3. La app local de High Score League lee el JSON, valida contexto basico y
   prepara el envio.
4. La app local envia el evento a `POST /api/submissions/ingest`.
5. La API web valida usuario, semana, juego y puntuacion antes de insertar en
   `public.submissions`.

La subida manual desde la web queda como herramienta provisional o fallback, no
como flujo principal definitivo.

## Tabla `submissions`

La migracion `supabase/migrations/0002_submission_events.sql` amplia
`public.submissions` con campos para eventos automaticos:

- `source`: origen del evento. Valores iniciales: `web`, `mame_memory`,
  `mame_plugin`, `local_app`, `admin_import`.
- `detected_at`: momento en el que MAME o la app local detectaron la puntuacion.
- `submitted_at`: momento en el que la web recibio la submission. Lo fuerza el
  trigger de servidor y no debe aceptarse desde cliente.
- `rom_name`: ROM detectada o asociada al evento.
- `mame_version`: version de MAME que genero el evento.
- `client_version`: version de la app local que envio el evento.
- `raw_event`: payload original para depuracion y auditoria.
- `duplicate_key`: clave de idempotencia para evitar duplicados en reintentos.

`screenshot_path` pasa a ser nullable porque las capturas dejan de ser requisito
central. Los metadatos `screenshot_mime_type` y `screenshot_size_bytes` siguen
siendo opcionales para una fase posterior.

## Payload orientativo

El endpoint mínimo ya existe en `POST /api/submissions/ingest`. Este ejemplo
documenta la forma esperada del evento:

```json
{
  "source": "mame_memory",
  "week_id": "00000000-0000-0000-0000-000000000000",
  "score": 184320,
  "detected_at": "2026-05-24T21:17:00+02:00",
  "rom_name": "galaga",
  "mame_version": "0.265",
  "client_version": "hsl-local-0.1.0",
  "duplicate_key": "sha256:week-player-rom-score-detected-at",
  "raw_event": {
    "machine": "galaga",
    "scoreAddress": "0x0000",
    "eventType": "score_detected"
  },
  "comment": "Evento detectado automaticamente"
}
```

El servidor debera tratar `raw_event` como informacion auxiliar. Los campos
normalizados (`score`, `week_id`, `player_id`, `detected_at`, etc.) seran la
fuente canonica tras validacion.

El endpoint no acepta `playerId`: `player_id` se deriva siempre del usuario
autenticado. Tampoco acepta `submittedAt`; `submitted_at` lo fuerza la base de
datos.

## Capturas

Las capturas son opcionales en esta arquitectura:

- `screenshot_path` puede ser `null`.
- Si mas adelante se adjunta captura, debera guardarse en Storage y registrar
  ruta, MIME type y tamano.
- La app local podra enviar eventos sin captura para no bloquear el flujo
  automatico.
- La compresion y subida real de imagenes quedan pendientes.

## Reintentos y duplicados

La app local debera poder guardar una cola de eventos pendientes y reintentar
cuando vuelva la conexion.

`duplicate_key` se usara como clave de idempotencia. La migracion crea un indice
unico parcial sobre `duplicate_key` cuando no es `null`. La clave debe incluir
suficiente contexto para evitar colisiones, por ejemplo jugador, semana, ROM,
puntuacion y momento detectado.

Si la API recibe dos veces el mismo evento, debera responder de forma estable:
no crear una segunda submission y devolver la submission ya registrada o un
resultado equivalente.

## Seguridad basica

La app local no debe usar `service_role`. El endpoint de ingestión usa la sesión
del usuario y RLS.

El flujo futuro debera:

- autenticar al usuario con Supabase Auth o un mecanismo derivado seguro;
- validar que `player_id` corresponde al usuario autenticado;
- validar que la semana existe y acepta submissions;
- validar que la ROM corresponde al juego esperado cuando sea posible;
- ignorar cualquier `submitted_at` enviado por cliente;
- limitar tamano y forma de `raw_event`;
- registrar errores de validacion sin exponer secretos;
- usar `service_role` solo en servidor si una ruta concreta lo necesita.

## No implementado todavia

Esta fase no incluye:

- plugin MAME;
- app local;
- subida real desde la web;
- Storage real;
- capturas reales;
- calculo de `weekly_results`.
