# Distribución privada de packs con R2 v1

## Autoridades y contrato

`packId` identifica bytes instalables concretos y cumple
`^[a-z0-9][a-z0-9_-]{0,127}$`. No es `gameId`, `weekId` ni
`games.download_url`. Supabase es el catálogo de identidad y disponibilidad;
R2 sólo almacena bytes bajo una key que el catálogo deriva.

El endpoint Node y dinámico es:

```http
GET /api/launcher/packs/<packId>/download
Authorization: Bearer <sesión HSL>
Accept: application/json
```

Sólo acepta bearer, exige usuario autenticado y perfil activo, y no consulta
membership. En éxito responde exclusivamente:

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

Todas las respuestas llevan `Cache-Control: no-store, max-age=0`. El ZIP viaja
directamente de R2 al launcher; Vercel no lo descarga, retransmite ni calcula su
hash.

## Catálogo `launcher_packs`

La tabla privada relaciona `pack_id` con `week_id`, `size_bytes`, `sha256`,
`status`, `published_at` y timestamps. `object_key` es una columna generated
stored y siempre tiene esta forma:

```text
packs/v1/<packId>/<sha256>.hslpack.zip
```

El ciclo de vida comienza en `draft`. El primer cambio `draft → published`
establece `published_at` en base de datos. Tras publicar, `pack_id`, `week_id`,
`size_bytes`, `sha256`, `object_key` y `published_at` son inmutables; sólo se
permite `published ↔ disabled`. Un draft puede borrarse, pero una fila publicada
alguna vez no. Un índice parcial permite como máximo un pack `published` por
semana.

RLS no ofrece ninguna policy general a usuarios normales ni a `anon`. Sólo la
policy basada en `public.is_admin()` permite gestión autenticada; el endpoint
lee con el cliente service-role existente. La relación apunta desde
`launcher_packs.week_id` a `weeks.id`; no existe `weeks.launcher_pack_id`, por lo
que el catálogo privado no filtra nombres de semanas futuras.

`disabled` impide nuevas resoluciones y descargas, pero no revoca copias que ya
estén instaladas. Revocación local y actualización competitiva quedan fuera de
este MVP.

## Visibilidad y privacidad

Un pack sólo se resuelve cuando está `published` y su semana es pública. Packs
inexistentes, draft, disabled, semanas futuras/secretas, temporadas draft o
semanas sin juego convergen al mismo `404`, sin consultar R2. Packs y ranking
dependen de la misma primitiva de visibilidad pública; no hay una segunda lista
de estados. Membership no gobierna la instalación o práctica.

## R2 privado

El backend valida estas variables server-side:

```text
HSL_R2_ACCOUNT_ID=
HSL_R2_BUCKET=
HSL_R2_ACCESS_KEY_ID=
HSL_R2_SECRET_ACCESS_KEY=
HSL_R2_JURISDICTION=default
```

La jurisdicción admite `default`, `eu` o `fedramp`; el endpoint se construye a
partir del account ID y nunca se acepta un host arbitrario desde entorno o
cliente. El bucket debe tener 3–63 caracteres `a-z`, `0-9` o `-`, sin guion en
los extremos. La ausencia o invalidez de configuración produce `503` en runtime,
pero no impide importar módulos ni construir la web.

El bucket permanece privado: no se habilitan `r2.dev`, dominio público, public
access ni CORS. Vercel/backend debe usar un token **Object Read only**, limitado
al bucket de packs. Un publisher futuro deberá usar otra credencial read+write;
esa credencial y el uploader no forman parte de esta fase.

## HEAD, integridad y presign

Después de autenticación, catálogo y visibilidad, el adapter ejecuta
`HeadObject` con timeout de 7,5 segundos. El objeto debe existir y
`ContentLength` debe coincidir exactamente con `size_bytes`; sólo entonces se
firma un `GetObject` durante 900 segundos. El backend no acepta el TTL desde el
launcher.

`sha256` procede exclusivamente del catálogo y el launcher lo verifica tras la
descarga. `ETag`, `LastModified` y Content-MD5 no sustituyen el SHA-256 HSL. El
bearer Supabase nunca se envía a R2; la URL firmada es la única capacidad de
lectura entregada.

## Errores y datos sensibles

La taxonomía externa es:

| Caso | HTTP |
|---|---:|
| `packId` inválido | 400 |
| bearer ausente/malformado, sesión rechazada normalmente o usuario no resuelto | 401 |
| perfil inexistente, inactivo o anonymized | 403 |
| pack no disponible, semana secreta u objeto ausente | 404 |
| backend Auth no configurado/no inicializable o excepción de `getUser()` | 503 |
| perfil no verificable, catálogo no inicializable, contexto/R2/config/HEAD/tamaño/presign fallido | 503 |
| descriptor emitido | 200 |

Los errores de proveedor se reducen a clasificaciones seguras. No se registran
Authorization, credenciales AWS/Supabase, errores SDK completos, URLs firmadas,
`X-Amz-Signature` ni `X-Amz-Credential`. Las respuestas 404 tampoco revelan
`weekId`, `objectKey`, hash, tamaño o estado interno.

La frontera distingue una respuesta normal de Auth que rechaza la credencial
(`401`) de no poder inicializar o ejecutar el backend necesario para validarla
(`503`). Reiniciar sesión no se presenta como solución para una avería o
configuración incompleta del servidor.

## Operación pendiente

Esta implementación no crea infraestructura ni publica packs. El operador debe,
en este orden: verificar el schema remoto, ejecutar el preflight 0031, aplicar
la migración 0031, verificar constraints/RLS, crear un bucket privado, crear un
token Object Read only limitado al bucket, configurar las cinco variables en
Vercel, desplegar, subir un pack autorizado mediante un flujo operativo futuro,
crear/publicar su draft y probar descriptor, HEAD, presign e importación E2E.

No hay CORS, uploader, presigned PUT, UI admin, subida multipart, revocación
local ni herramienta de publicación en esta fase.
