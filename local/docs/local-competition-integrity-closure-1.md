# LOCAL-COMPETITION-INTEGRITY-CLOSURE-1

Este documento congela el contrato local que consumirá la futura capa WEB. Es
la autoridad vigente sobre `competition-integrity-1.md` y
`space-invaders-pack-v2-real-1.md`, que quedan como historial de las etapas
anteriores.

## Alcance y límite de confianza

La solución detecta alteraciones locales parciales cuando la aplicación HSL,
su ASAR, MAME y el plugin conservan el código esperado. No es una firma, una
atestación de hardware ni una solución *tamper-proof*. Un propietario del
equipo que sustituya coherentemente launcher/ASAR, MAME, plugin, protocolo,
receipts y controles del sistema operativo queda fuera del modelo local. La
futura tarea WEB debe aplicar policy canónica, validación independiente y RLS
anti-bypass.

No se añaden requests, polling remoto, timers remotos, caches de autoridad ni
cambios en Week, Membership o Connectivity. La capa local no publica releases,
packs ni submissions por sí misma.

## Cadena de autoridad cerrada

```text
artifact oficial + descriptor
  -> verificación y provenance receipt
  -> pack fresco instalado
  -> competition-manifest verificado
  -> snapshot copy + hash
  -> readiness autoritativo sobre la snapshot
  -> run PREPARING
  -> launch plan + inputs sellados + prepared.marker
  -> MAME exacto + plugin 0.4.0 + adapter aislado
  -> candidates + commitments + ledger + final seal
  -> verificación post-run + mame-exit
  -> finalization plan + receipt + outputs + commit
  -> segunda barrera de elegibilidad
  -> HTTP (sólo si todo coincide)
```

## Pack y adapter genérico

`capture.automatic` es opcional para Biblioteca/Práctica y obligatorio para la
Competición automática. Su schema v1 queda cerrado:

```json
{
  "version": 1,
  "strategy": "game-specific-strategy-v1",
  "intervalFrames": 1
}
```

`intervalFrames` se normaliza a `1` cuando se omite y acepta enteros entre 1 y
600. El core ejecuta scheduler, lifecycle, sanitización, límite y escritura; el
adapter implementa `observe_capture(context)` y devuelve, cuando corresponde,
un objeto `{ score, metadata }`. `read_memory/build_event` sólo pertenecen al
bridge legacy y no son requisito de Competition automática.

Toda semántica de Space Invaders —direcciones, BCD, modo, intento y rollover—
vive en `scripts/invaders.lua` del pack r2. `core/tracking.lua`, writer,
integrity e init no conocen `0x20EF`, BCD, `visibleScore` ni rollover. El fixture
`test/fixtures/mame-adapters/fake-automatic.lua` demuestra que otro juego puede
producir candidates sin modificar el core.

## Preparación y run-input manifest

Una carpeta de run nace con `preparing.marker` y no es ejecutable hasta que un
`prepared.marker` atómico liga `runId` y `runInputManifestSha256`. La readiness
rápida sólo evita trabajo inútil; la autoridad es la segunda readiness ejecutada
sobre la snapshot verificada.

El manifest canónico cubre:

- todos los inputs protegidos del pack y su `competition-manifest.json`;
- adapter preparado, plugin efectivo, `plugin.json`, `boot.lua` y `config.lua`;
- controller competitivo, identidad, recovery record y cfg seed;
- el launch plan exacto que se entrega a `spawn`;
- la raíz de producto o, sólo en QA de desarrollo, el hash de MAME externo.

El launcher verifica esos bytes inmediatamente antes de `spawn`, arranca un
watcher best-effort y repite el hash después del cierre. El watcher no es una
garantía absoluta: complementa los hashes pre/post. Una mutación observada deja
`run_input_changed` sticky aunque los bytes originales se restauren. Si la
vigilancia queda indisponible se registra `integrity_unavailable`.

## Raíz de integridad del producto y CRT

`product-integrity-root.json` se empaqueta dentro del ASAR/app code. Liga por
hash exacto los manifests vecinos del runtime y del plugin, además de MAME
`0.287`, plugin `0.4.0` y versión de schema. Sólo después se confía en sus hashes
interiores.

La closure real protegida de `crt-geom` en MAME 0.287 comprende:

- `bgfx/chains/crt-geom.json`;
- `bgfx/effects/crt-geom/crt-geom.json`;
- `artwork/bgfx/chains/crt-geom/aperture_1_2_bgr.png`;
- shaders `vs_crt-geom` y `fs_crt-geom` para `dx11`, `dx9`, `essl`, `glsl`,
  `metal` y `spirv`.

Se protege esa closure acotada, no miles de recursos BGFX ajenos. Regenerar un
manifest vecino junto a bytes modificados no basta porque cambia el digest
anclado en la raíz del ASAR.

## Candidates, commitments y cierre

El core acepta un máximo de 128 candidates. Cada publicación genera, en orden
monótono, `candidate_N.json`, `commitment_N.json` y una línea del ledger. El
commitment contiene el envelope exacto del candidate. Al detenerse el plugin,
`final.marker` sella el conjunto final ordenado.

El finalizer exige igualdad exacta entre directorios, ledger, candidate,
commitment y final seal. Detecta edición de score/metadata, alta, baja,
renombrado, duplicado, commitment extra/ausente y alteraciones de orden. La
sanitización Node usa objetos sin prototipo y rechaza `__proto__`, `prototype` y
`constructor` en cualquier profundidad relevante.

La publicación es transaccional e idempotente:

```text
finalization-plan.json
  -> finalized-run receipt
  -> output 1..N por rename atómico
  -> finalization.json (commit final)
```

Un crash en cualquier frontera se reanuda comparando bytes y hashes exactos; no
duplica ni sobrescribe destinos distintos. Nunca se elimina payload pesado
antes del commit. La compactación posterior conserva identidad, estado final,
violaciones, hash de inputs, receipt, commit y resumen de auditoría.

## Receipt y evidence v2

El receipt vive bajo el scope de cuenta+pack:

```text
<scopedQueueRoot>/competition/finalized/<runId>.json
```

Estados cerrados: `clean`, `violated`, `fail_closed` y `developer_qa`. Liga
run, week, player binding, pack, manifest, input manifest, capture client,
provenance, violations y, por output, candidate, nombre lógico y SHA-256 exacto.

`competitionIntegrity.version = 2` añade `guardVersion`, `weekId`,
`playerBinding`, `packId`, `manifestSha256`, MAME/plugin/capture client,
`runInputManifestSha256`, DIPs, violations, provenance y el candidate capturado.
La v1 queda legible sólo para auditoría histórica; no se reinterpreta como v2.

El player binding no expone el UUID:

```text
sha256("hsl-player-binding:v1|" + userId)
```

La week y el usuario se capturan antes del spawn y no se sustituyen durante la
finalización. La duplicate key v2 incluye week, player binding, pack, manifest,
run y candidate; la key v1 histórica permanece sin cambios.

## Segunda barrera antes de HTTP

Para evidence v2, `submission-service` valida antes de auth/session/network:

- receipt existente, canónico, `clean`, sin violations y `remote_verified`;
- mismo scope, cuenta, week, pack, manifest, run y candidate;
- mismo `runInputManifestSha256`, capture client y provenance;
- SHA-256 exacto de los bytes del evento;
- plan y commit de finalización compatibles con receipt y output.

Un fallo mueve el fichero a rejected con diagnóstico local y produce cero
resoluciones de auth y cero HTTP. Copiar rejected a pending, mover entre cuentas
o editar score, bindings, identidades o provenance no concede elegibilidad.
`developer_override` genera artefacto y receipt `developer_qa`, pero siempre
`adopted = []`, sin callbacks productivos ni auto-submit.

## Provenance e importer

`already-installed` por sí solo no concede trust. Si hubo un crash después del
rename final y antes del receipt, repetir el deep link vuelve a descargar y
verificar el artifact oficial, compara packId y manifest oficial con el pack
existente, ejecuta `verifyCompetitionManifest(existing)` y sólo entonces
reconstruye el receipt. Nombre de carpeta o packId aislados nunca bastan.

El importer reabre el pack desde el directorio final después del rename y
devuelve rutas/objetos frescos. Así provenance nunca depende de paths temporales
ya movidos.

## Visual y Practice

Los ajustes compartidos `-video bgfx` y `-bgfx_screen_chains crt-geom` sólo se
declaran en `mame.launchArgs`; se rechazan en perfiles protegidos. Practice y
Competition reciben ambos argumentos exactamente una vez.

Practice conserva TAB, pausa, save/load, DIPs y reset; usa `-noplugins`, no crea
controller competitivo, snapshot, provenance, candidate protegido ni watcher de
run-input. Su estado mutable queda separado. Competition usa controller,
pluginpath, cfg y todos los directorios mutables por run.

## Recovery de startup

Startup elimina únicamente PREPARING huérfanos cuyo proceso propietario ya no
existe. Una run preparada sin final seal o sin `mame-exit.json` se clasifica
`fail_closed`. Journals parciales se reanudan; receipt/output corruptos se
clasifican de forma determinista y nunca se convierten en CLEAN por ausencia de
datos.

## Versiones y publicación

- MAME protegido: `0.287` exacto.
- Plugin efectivo: `0.4.0`.
- Pack de referencia: `space-invaders-s1-w1-r2`.
- Versión source actual del launcher: `0.3.0`; el siguiente número de release
  queda deliberadamente pendiente del flujo de publicación autorizado.

No se modifica una release `0.3.0` ya publicada ni se crea release/tag desde
esta tarea.

## QA operativa

Tras `npm run prepare:package`, la QA real usa el runtime staged y scopes
temporales, sin HTTP de producción:

```powershell
node scripts/qa/space-invaders-real-competition.js
node scripts/qa/space-invaders-automatic-finalization.js --% "D:/High Score League/Space Invaders" "<mame.exe staged>" clean
node scripts/qa/space-invaders-automatic-finalization.js --% "D:/High Score League/Space Invaders" "<mame.exe staged>" pause
node scripts/qa/space-invaders-automatic-finalization.js --% "D:/High Score League/Space Invaders" "<mame.exe staged>" dip_changed
node scripts/qa/space-invaders-automatic-finalization.js --% "D:/High Score League/Space Invaders" "<mame.exe staged>" save_load
node scripts/qa/space-invaders-automatic-finalization.js --% "D:/High Score League/Space Invaders" "<mame.exe staged>" reset
node scripts/qa/space-invaders-practice.js
```

El autoboot de QA se copia dentro del run, se incluye en el run-input manifest
y se incorpora al único launch plan sellado. Sólo se admite mediante autoridad
QA explícita en una app no empaquetada. Un fixture `remote_verified` puede
demostrar la promoción en un scope temporal; no ejecuta submissions.

## Contratos congelados para WEB

WEB debe tratar como identidades distintas pack r1/r2, evidence v1/v2,
guardVersion, captureClientVersion y provenance receipts. No debe confiar en un
evento aislado ni aceptar `developer_override`. Los campos/hash de receipt,
evidence, duplicate key y payload descritos aquí son la frontera local que la
validación server-side debe consumir sin rebajarlos.
