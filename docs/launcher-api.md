# Launcher API

## GET /api/launcher/health

Devuelve `204`, body vacio y `Cache-Control: no-store, max-age=0` con headers:

- `X-HSL-Build`: SHA abreviado, deployment/build ID o `unknown`;
- `X-HSL-Environment`: production, preview o development;
- `X-HSL-Launcher-Api-Version`: `1`.

No requiere autenticacion ni consulta datos.

## POST /api/launcher/ranking-capabilities

Request:

```json
{"version":1,"requests":[{"requestKey":"library-0","weekId":"week-id"}]}
```

Response:

```json
{
  "version": 1,
  "build": "abcdef123456",
  "environment": "production",
  "generatedAt": "2026-07-15T12:00:00.000Z",
  "results": [{"requestKey":"library-0","status":"available","url":"https://example/weeks/week-id","reason":"public-week"}]
}
```

La entrada admite hasta 100 requests, 32 KiB, claves unicas e identificadores
de 1-128 caracteres. La consulta de `weeks.id` solo recibe UUIDs; otras
identidades validas del contrato son `unavailable/not-found` sin hacer fallar el
batch. Service role permanece encapsulado en servidor y nunca se devuelven
scores, perfiles, membership, claves ni errores internos.

## Smoke desplegado

```powershell
$env:HSL_LAUNCHER_WEEK_ID='<week-id-real>'
$env:HSL_EXPECTED_DEPLOYMENT_SHA='<sha-esperado>'
npm.cmd run test:launcher-api
```

El script valida health, fingerprint, contrato, batch vacio, semana real y UUID
inexistente. El weekId y SHA reales solo se pasan por entorno y no se guardan.
