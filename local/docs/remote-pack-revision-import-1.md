# Actualización remota segura de packs v1

## Identidades y autoridad

No existe un número de revisión de pack. `packId` identifica un artifact
instalable concreto e inmutable; el launcher nunca interpreta sufijos como
`r1`, `r2` o `rN`. La familia que puede actualizarse queda definida por la
igualdad exacta de `weekId + gameId`.

`POST /api/launcher/week-capabilities` conserva contract version 1 y añade
`publishedPackId` como autoridad pública de currentness. Su semántica es
trivalente:

- campo ausente: servidor/cache anterior o autoridad desconocida;
- `null`: una respuesta actual confirma que no hay pack published y revelable;
- string válido: `packId` published actual de esa week.

El servidor sólo obtiene la string desde un `launcher_packs.status = published`
y reutiliza la misma visibilidad pública que la descarga. Drafts, disabled y
weeks futuras no se revelan. Un fallo de consulta produce 5xx; nunca se degrada
a `null`. El cache local v3 conserva la ausencia de `publishedPackId` al leer
entradas v2. No se añadió endpoint, poller, timer ni cache paralelo.

## Estado local y Competition

La derivación central produce `current`, `outdated`, `current-unverified` o
`unknown`. Para un pack Protected revision-managed:

| Estado | Practice | Nueva Competition |
|---|---:|---:|
| `current` con provenance oficial | sí | continúa hacia los demás guards |
| `outdated` | sí | no |
| `current-unverified` | sí | no |
| `unknown` | sí | no |

Justo antes de una nueva Competition Protected se exige una confirmación remota
actual de `publishedPackId`; una cache durable no basta. Una partida que ya
arrancó conserva el contrato offline: MAME continúa, el candidate se finaliza y
la score puede quedar pending. Los packs legacy no revision-managed mantienen
su semántica anterior.

El fingerprint local del intento competitivo incluye `packId`, además de la
identidad de instancia. Un reemplazo sobre el mismo path no puede reutilizar un
preflight old. Esto no modifica evidence v2, duplicate key, player binding,
receipt ni run identity.

## Descubrimiento y producto

El protocolo sigue siendo `highscoreleague://import-pack/<packId>`. La
Biblioteca y el deep link clasifican la familia local antes de descargar:

- sin familia local: importación remota normal;
- una revisión old y target published: `update-available`;
- target exacto con provenance: `already-current`, con cero descarga;
- target exacto manual: verificación mediante artifact oficial;
- copias old/target o candidatos ambiguos: `revision-conflict`, sin borrado.

Un refresh de fondo puede actualizar badge/readiness, pero no abre diálogos. El
diálogo nace de una interacción explícita y ofrece `Actualizar`/`Cancelar`.
Cancelar no descarga ni modifica archivos. `destination_collision` se presenta
como conflicto de instalación, no como pack inválido.

## Transacción y recovery

La actualización remota es distinta de la importación manual. Primero relee la
instalación old; descarga por streaming; verifica size, SHA-256, ZIP, Pack
Contract y competition manifest; exige `target.packId`, `target.weekId` y
`target.gameId`; relee old; y fuerza autoridad remota otra vez. Si el target
published cambió durante la descarga, se cancela antes del commit.

El commit usa siblings del mismo filesystem:

```text
.hsl-update-<transactionId>
.hsl-update-backup-<transactionId>
```

El final path old se mueve a backup y el staging target ocupa exactamente ese
path. Se reabre y verifica el target final antes de crear su receipt
`remote_verified`. El scanner ignora temporales de import/update/backup.

Un journal atómico bajo `userData/pack-updates` separa core commit de
bookkeeping. Recovery vuelve a validar library key, containment, nombres,
symlinks e identidades; antes del core restaura old, después de un core
inequívoco converge a target, y ante ambigüedad conserva copias sin ejecutar
rutas del JSON como input confiable. Un rollback sólo elimina la provenance
target creada por esa transacción si sigue siendo exactamente su receipt; la
provenance histórica old no se hereda ni se destruye.

## Estado local preservado

Los scopes de score continúan separados por `packId`: pending/sent/rejected,
eventos, evidence, receipts y duplicate keys old no se copian ni reescriben.
Favoritos locales migran de la clave old a target de forma atómica, idempotente
y deduplicada. El mismo final path conserva selección, `instanceKey`,
`lastOpenedPackDir` y ruta reciente; el refresh vuelve a materializar metadata
y readiness del target.

MAME, import manual, import remoto y updates son mutuamente excluyentes para
operaciones de Biblioteca. El launcher nunca mata MAME. No se copian cfg,
scripts, plugin, ROM ni bytes antiguos sobre el target: el estado mutable ya
externalizado bajo `userData/runtime` sobrevive; para cualquier estado de
Practice todavía alojado dentro del pack, target gana porque no existe un
contrato general seguro de migración.

## QA y límite pendiente

El harness local usa el artifact exacto preparado para Space Invaders r2
(37 130 293 bytes, SHA-256
`181e0f344087f3511d4826b93b9ed45510b205eccdb014370042b42b1de3cb69`,
manifest
`782a2ca4b8a818dd44ec6279951022c9e6c804b5e7051877d6a762753bd02d53`)
contra una Biblioteca temporal con r1 instalada. No publica r2 ni muta R2 o
Supabase.

El backend Protected aún tiene una policy por week y congela su identidad tras
la primera submission. Rotar de nuevo el pack dentro de una week ya frozen no
queda resuelto aquí; corresponde a
`WEB-COMPETITION-PACK-REVISION-ROTATION-1`. No se cambian evidence v2,
duplicateKey v2, playerBinding, policy fingerprint ni finalized receipt.
