# WEB Competition Integrity 1

Esta fase añade una autoridad WEB independiente para las submissions Protected
Competition. Consume `competitionIntegrity v2`, pero no importa ni ejecuta el
validador CommonJS de LOCAL.

## Autoridades

```text
LOCAL
  coherencia de ejecución, finalización y cola local

sesión autenticada
  identidad real del jugador

week_competition_policies
  reglas técnicas canónicas de la week

launcher_packs
  revisión, artifact y competition manifest canónicos

WEB ingest
  comparación independiente y normalización

submissions
  registro aceptado y columnas canónicas
```

`raw_event` sólo conserva el original validado para auditoría y depuración. No
es autoridad final de `player_id`, week, score, pack, manifest, ROM, MAME,
source ni claves de idempotencia.

## Schema `0034`

`0033` quedó retirada históricamente; se usa deliberadamente `0034` para no
reutilizar una identidad anterior. La migración añade:

- `launcher_packs.competition_manifest_sha256`, nullable para revisiones legacy
  y 64 hex lowercase cuando existe;
- la tabla privada `week_competition_policies`, donde ausencia significa legacy
  y presencia significa `protected_v2`;
- identidad Protected normalizada en `submissions`: pack, version 2, manifest,
  run y candidate;
- unicidad parcial de candidate por jugador, pack y run;
- un guard de INSERT sobre la fila normalizada;
- revocación de INSERT directo a `authenticated` y retirada de las antiguas
  policies de INSERT normal/admin.

La policy referencia `(launcher_pack_id, week_id)` de `launcher_packs`. Puede
prepararse mientras el pack está `draft`, pero ingest no lo acepta hasta que
`published_at` exista. Un pack `disabled` que fue publicado sigue acreditando
capturas offline históricas. El manifest, artifact e identidad quedan
inmutables tras la primera publicación.

Antes de la primera submission Protected de una week, su policy puede
corregirse o borrarse. Después, el trigger bloquea UPDATE y DELETE. Un futuro
hotfix tras scores aceptadas requerirá un diseño explícito de revision history;
no se simula con mutaciones retroactivas.

## Validación server-side

El orden productivo es:

```text
parse → Auth → perfil activo → admin client
→ week → policy → pack canónico
→ evidence v2 + playerBinding + event binding
→ hsl:v2 recalculada por WEB
→ duplicate exacto
→ membership → ventana histórica → INSERT server-only
```

La evidence v2 exige keys exactas, `guardVersion = 2`, provenance
`remote_verified`, hashes válidos, `violations = []`, DIPs exactos y canónicos,
y coherencia de week, pack, manifest, artifact, MAME, plugin, ROM, source,
score, `detectedAt`, run y candidate. `playerBinding` se deriva como:

```text
sha256("hsl-player-binding:v1|" + authenticatedUserId)
```

La duplicate key se recalcula y persiste desde:

```text
hsl:v2:sha256([
  "hsl", "v2", weekId, playerBinding, packId,
  manifestSha256, runId, candidateId
].join("|"))
```

`captureClientVersion` identifica el launcher que capturó; `clientVersion`
identifica el que sincroniza y no tienen que coincidir. WEB valida la forma de
`runInputManifestSha256`, pero no inventa un valor canónico server-side que no
existe.

## Legacy, idempotencia y offline

Una week sin policy conserva el flujo legacy y `hsl:v1`; `rawEvent` continúa
siendo opcional. Si no hay policy pero el payload afirma explícitamente
`competitionIntegrity v2`, WEB devuelve 503 y no lo degrada a legacy.

Un duplicate exacto ya aceptado se confirma antes de membership y ventana
mutables. Esto permite reintentar después del cierre, después de abandonar la
membership o cuando el pack publicado pasó a `disabled`. Una colisión con
identidad distinta devuelve `DUPLICATE_KEY_CONFLICT`.

La aceptación nueva sigue usando `detectedAt`, no `submittedAt`: no existe un
límite arbitrario de antigüedad y final stretch sigue forzando `is_hidden`.

## Errores

Una contradicción contra policy y pack válidos devuelve 409 con un código
`COMPETITION_*` terminal. El texto no acusa al jugador: indica que la captura
no coincide con la policy técnica.

Un fallo de configuración, tabla aún no migrada, query de policy/pack, service
role ausente, pack draft o autoridad canónica malformada devuelve 5xx, en
particular `COMPETITION_AUTHORITY_UNAVAILABLE`. El launcher conserva el pending
y reintenta; una avería WEB no se clasifica como partida inválida.

## Privacidad

La anonimización conserva `launcher_pack_id`,
`competition_integrity_version` y `competition_manifest_sha256`, porque forman
parte del historial competitivo. Limpia `competition_run_id`,
`competition_candidate_id`, `raw_event`, versiones técnicas y duplicate key.
El guard de INSERT exige run/candidate completos; ambos sólo pueden quedar
`NULL` juntos como estado sanitizado posterior.

## Límite de seguridad

WEB valida claims contra verdad server-side, pero no proporciona hardware
attestation ni una firma secreta imposible de fabricar desde un cliente
completamente modificado. Si alguien reimplementa todo el cliente y fabrica una
score internamente coherente, WEB no conoce la puntuación esperada. La solución
bloquea edición ordinaria, downgrade, pack/revisión incorrectos y bypass SQL;
no es ejecución confiable criptográfica.

## Operación futura, no ejecutada aquí

Orden de referencia para r1 → r2:

1. Subir y verificar el artifact r2.
2. Crear `launcher_packs` r2 como draft con artifact y manifest canónicos.
3. Verificar preflight, constraints, RLS y endpoint.
4. En una operación coherente, pasar r1 a disabled, publicar r2 y crear la
   policy Protected r2.
5. Validar descriptor/import, MAME real, offline/restart y una submission E2E.

Los datos de referencia son `space-invaders-s1-w1-r2`, manifest
`782a2ca4b8a818dd44ec6279951022c9e6c804b5e7051877d6a762753bd02d53`, ROM
`invaders`, MAME `0.287`, plugin `0.4.0`, source `mame_memory` y DIPs `:IN2`
mask 3/value 0 y mask 8/value 0. No están hardcodeados en el validador ni se
han escrito remotamente.

Esta implementación no aplica `0034`, no cambia R2, no publica r2, no desactiva
r1 y no realiza submissions productivas. La validación RLS real queda para un
entorno Supabase local/E2E autorizado.
