# Launcher API

## GET /api/launcher/health

Devuelve `204`, body vacio y `Cache-Control: no-store, max-age=0` con headers:

- `X-HSL-Build`: SHA abreviado, deployment/build ID o `unknown`;
- `X-HSL-Environment`: production, preview o development;
- `X-HSL-Launcher-Api-Version`: `1`.

No requiere autenticacion ni consulta datos.

`X-HSL-Build` y `X-HSL-Environment` son metadata diagnostica del deployment que
respondio. Sirven para soporte, trazabilidad y smoke de despliegue, pero no
identifican autoridad competitiva ni segmentan caches del launcher.

`X-HSL-Launcher-Api-Version` es la frontera de compatibilidad contractual. Para
el launcher actual, la autoridad remota estable es el origin exacto junto con
`launcher-api:1`. Un rolling deployment puede hacer que Health y otro endpoint
respondan desde builds o environments distintos; la respuesta sigue siendo
funcionalmente valida si conserva el mismo origin, la version soportada y el
contrato estructural del endpoint. Una version no soportada se rechaza.

Un cambio breaking de cualquier contrato consumido por el launcher exige
avanzar la version de Launcher API correspondiente; compartir accidentalmente
el numero `1` no autoriza a introducir incompatibilidades.

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

## GET /api/launcher/packs/&lt;packId&gt;/download

API bearer-only para resolver un pack publicado y una semana públicamente
revelada. No acepta cookies ni exige membership.

```http
GET /api/launcher/packs/space-invaders-s1-w1/download
Authorization: Bearer <sesión HSL>
Accept: application/json
```

La respuesta `200` contiene exactamente:

```json
{
  "version": 1,
  "packId": "space-invaders-s1-w1",
  "artifact": {
    "sizeBytes": 31457280,
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "downloadUrl": "https://proveedor-r2/objeto?firma=temporal"
  }
}
```

El servidor consulta el catálogo privado mediante service role, reutiliza la
misma autoridad de visibilidad que ranking, comprueba existencia y
`ContentLength` con `HeadObject` y firma un GET R2 durante 900 segundos. Los
bytes no atraviesan Vercel, el bearer HSL no se envía al artefacto y ETag no se
usa como SHA-256.

Taxonomía: `400` para `packId` inválido; `401` para bearer ausente/malformado,
sesión rechazada normalmente por Auth o usuario no resuelto; `403` para perfil
no activo; `404` indistinguible para pack missing/draft/disabled, semana secreta
u objeto ausente. `503` cubre backend Auth no configurado/no inicializable,
excepción inesperada de `getUser()`, fallo de perfil, catálogo no
configurado/no inicializable, contexto, R2, tamaño o firma. Todas las respuestas
son `no-store` y no exponen estado interno, object key, secretos ni URL firmada
en logs.

## Smoke desplegado

```powershell
$env:HSL_LAUNCHER_WEEK_ID='<week-id-real>'
$env:HSL_EXPECTED_DEPLOYMENT_SHA='<sha-esperado>'
npm.cmd run test:launcher-api
```

El script valida health, metadata de deployment, contrato, batch vacio, semana
real y UUID inexistente. Si se configura el SHA esperado, conserva la
comparacion estricta como control de QA del deployment; esa comprobacion smoke
no convierte el SHA en autoridad funcional. El weekId y SHA reales solo se
pasan por entorno y no se guardan.

## Presence del launcher

`POST /api/launcher/presence` recibe bearer canónico y un payload v1 con
`clientId`, `activity`, `weekId` y `mode`. `connected` limpia todo contexto;
`playing` solo nace en el evento real `spawn` de MAME y vuelve a `connected` en
`close`. El servidor resuelve `weekId -> weeks.game_id -> games.title`; el
launcher no envía `playerId` ni título. `DELETE` con `version` y `clientId`
retira best-effort la sesión al cambiar/quitar cuenta o cerrar.

El identificador de instalación se guarda atómicamente en
`userData/presence/client-id.json` y no contiene datos personales. Solo la
cuenta activa emite heartbeat cada 30 s. Practice y Competition se almacenan
como modos distintos pero ambos se presentan como `JUGANDO`. Al quedarse
offline no se crea cola: la reconexión envía únicamente el estado actual. Los
fallos de Presence son silenciosos y nunca bloquean MAME, Playtime o
submissions.
