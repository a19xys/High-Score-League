# Competition Integrity E2E 1

## Resultado de la primera ejecución

La ejecución del 24 de agosto de 2026 quedó bloqueada antes de la primera
mutación remota. No había un canal SQL capaz de aplicar y registrar únicamente
`0034`, ni una credencial R2 de escritura separada. No se reutilizó la
credencial R2 read-only de producción y no se creó infraestructura, uploader,
usuario, membership, deployment ni migration auxiliar.

Por tanto, el estado productivo observado se conserva:

- Web Production sirve el build `eb32837a1cac` y declara entorno `production`.
- `launcher_packs` existe y Space Invaders r1 continúa `published`.
- La week estaba `active` y dentro de `[public_start_at, final_deadline_at)`.
- `0034` seguía ausente: no existían `week_competition_policies` ni sus nuevas
  columnas de pack/submission.
- r2 no se subió a R2, no se creó como draft y no se publicó.
- r1 no se deshabilitó, no se creó/congeló una policy y no hubo submission QA.

## Estado productivo vigente antes del cierre local de revisiones

Las tareas posteriores completaron por un canal autorizado parte del estado que
la primera ejecución dejó pendiente. Antes de
`LOCAL-REMOTE-PACK-REVISION-IMPORT-1` se verificó:

- `0034_competition_integrity` aplicada;
- `0035_competition_integrity_rpc_lockdown` aplicada;
- Space Invaders r1 `published`;
- el artifact exacto r2 ya almacenado y su catálogo `disabled`;
- ausencia de `week_competition_policy` para Space Invaders;
- cero submissions Protected procedentes de ese E2E.

La tarea local de actualización no cambió ninguno de esos estados: no ejecutó
migrations, no modificó Supabase/R2, no publicó r2 y no creó policy ni
submission. El fichero Git de `0035` refleja exactamente el microfix remoto ya
aplicado, sin crear `0036`.

## Cambios locales

`0034_competition_integrity.sql` revoca los privilegios de tabla de
`authenticated` sobre `week_competition_policies`. Un admin autenticado sólo
puede:

- seleccionar y borrar bajo la RLS administrativa existente;
- insertar los once campos canónicos editables, incluido `week_id`;
- actualizar los diez campos canónicos pre-freeze, sin `week_id`.

No recibe privilegio de escritura sobre `policy_fingerprint`, `frozen_at`,
`created_at` ni `updated_at`. El guard de INSERT competitivo sigue siendo
`SECURITY DEFINER` y conserva la única transición productiva
`frozen_at: NULL → timestamp`.

El preflight inventaría ahora los privilegios de columna tanto de
`submissions` como de `week_competition_policies`. Los tests focales cubren la
ausencia de grants amplios, las columnas DB-owned y el freeze interno.

La Release estable más alta observada fue `v0.3.0`. El candidato local se
preparó como `0.3.1`, sin tag, Stage, Release ni publicación.

## Artifact r2 preparado

La fuente exacta `D:\High Score League\Space Invaders` no se modificó. Su
fingerprint completo antes y después fue:

```text
04dcf51a2de3393cde881ec7c2298c6a4b54657dfd55dcbe09217c35f5c8f5b7
```

El ZIP canónico conservado en `%TEMP%` tiene:

```text
packId: space-invaders-s1-w1-r2
artifactSizeBytes: 37130293
artifactSha256: 181e0f344087f3511d4826b93b9ed45510b205eccdb014370042b42b1de3cb69
competitionManifestSha256: 782a2ca4b8a818dd44ec6279951022c9e6c804b5e7051877d6a762753bd02d53
ROM sha256: 43c75c2248af44189380d3bc3da42d4a486735399678663e411267000397e80a
```

Pasó `inspectPackZipForProvenance`, un import real en biblioteca temporal
limpia, la comprobación de `packId` y la verificación del manifest competitivo,
sin warnings.

## QA local

- Root tests: ejecutados con el microfix.
- Root production build: compilación, types, páginas estáticas y trazas
  completadas.
- Launcher tests: `1244` pass, `0` fail, `14` skipped.
- `dist:win`: instalador `0.3.1`, blockmap y metadata de update validados.
- `smoke:packaged`: correcto con MAME bundled `0.287`, plugin `0.4.0` y
  product integrity desde `app.asar`.
- `git diff --check`: correcto.

## Gate bloqueado y reanudación

El entorno sólo aportaba la service-role de la aplicación. Esa credencial
permite las lecturas REST usadas para el inventario, pero no es un canal SQL
seguro para ejecutar/registrar una migration aislada. El OpenAPI remoto tampoco
publicaba una RPC SQL existente. No había variables ni perfiles locales R2
write, y las sesiones de administración web disponibles estaban desconectadas.

Para reanudar hacen falta, sin cambiar el alcance:

1. un canal SQL remoto ya autorizado que ejecute el preflight SELECT-only,
   aplique exactamente el SHA de `0034` y registre coherentemente `0034`;
2. una credencial R2 Object Read & Write separada y limitada al bucket de packs;
3. una sesión HSL QA activa ya miembro de la temporada antes del switch.

Hasta entonces no deben afirmarse como completados el upload, draft, switch,
policy, import remoto, MAME real, offline/restart, ingest, duplicate, negativos
productivos ni invalidación administrativa.

La lista anterior describe el bloqueo histórico de la primera ejecución. La
reanudación productiva restante debe partir del estado vigente de la sección
anterior y no repetir upload o migrations ya realizados. La validación local de
reemplazo r1→r2 se documenta en
`local/docs/remote-pack-revision-import-1.md`; rotar un pack después del freeze
de policy sigue pendiente de `WEB-COMPETITION-PACK-REVISION-ROTATION-1`.
