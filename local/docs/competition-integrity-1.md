# LOCAL-COMPETITION-INTEGRITY-1 — estado endurecido

Esta es la capa local de integridad de Competición para packs v2. Se ejecuta
después de la autorización competitiva existente y antes de preparar MAME. No
añade requests, polling, timers, caches ni autoridad de Week, Membership o
Connectivity.

## Alcance y límite de confianza

En una instalación HSL intacta, la capa falla cerrado ante cambios de bytes,
identidad o versión; argumentos no autorizados; manipulación de DIP; pausa,
menú, save/load, reset o speed/throttle; candidatos falsos; ausencia de cierre
normal; y evidencia no ligada al evento.

No es una firma, una atestación segura ni una prueba tamper-proof. Un propietario
que modifique de forma coherente launcher, plugin, MAME, receipts, protocolo y
SO puede eludir una autoridad puramente local. `WEB-COMPETITION-INTEGRITY-1`
deberá aportar policy canónica, validación server-side y RLS anti-bypass.

## Trust boundary actual

```text
REMOTE IMPORT verificado
  -> receipt local
PACK en Biblioteca
  -> reload fresco
  -> manifest + copy/hash
  -> snapshot del run
MAME exacto + plugin controlado
  -> sandbox + controller + guard
ADAPTER específico del juego
  -> candidates automáticos privados
INTEGRITY durable y sticky
  -> final seal al cierre normal
APP finalizer
  -> pending o rejected scoped
WEB futura
  -> autoridad independiente
```

## Contrato del pack

`mame.profiles.competition.integrity` sigue siendo compatible-opcional. Su
ausencia no invalida Biblioteca ni Práctica, pero impide Competición protegida.
`dips` admite de cero a 32 entradas:

```json
{
  "version": 1,
  "mameVersion": "0.287",
  "dips": [
    { "portTag": ":IN2", "mask": 3, "value": 0, "label": "Lives", "settingLabel": "3" }
  ]
}
```

Una estrategia automática se declara aparte y pertenece al juego:

```json
{
  "capture": {
    "mode": "plugin",
    "pluginName": "hsl-score",
    "adapter": "scripts/invaders.lua",
    "automatic": { "version": 1, "strategy": "invaders-game-mode-final-v1" }
  }
}
```

HSL sólo proporciona el lifecycle de candidates y finalización. No existe una
receta universal para detectar game over o score: cada adapter debe demostrar
su estrategia mediante las señales adecuadas de su juego.

## Visual y argv

Los argumentos visuales elegidos para un pack son comunes a ambos modos:

```json
{
  "mame": {
    "launchArgs": ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
    "profiles": {
      "practice": { "launchArgs": [] },
      "competition": { "launchArgs": [], "integrity": {} }
    }
  }
}
```

Práctica puede añadir argumentos propios. En Competición, tanto los argumentos
comunes como los del perfil pasan una allowlist con aridad:

- `-video` requiere un valor y sólo acepta `bgfx`;
- `-bgfx_screen_chains` requiere un nombre de chain acotado y seguro;
- no se aceptan tokens posicionales, duplicados, opciones desconocidas,
  aliases ni formas concatenadas.

Por tanto `-script`, `-autoboot_script`, `-pb`, `-playback`, `-rec`, `-record`,
`-c`, `-cheat`, `-rs`, `-refreshspeed`, state/rewind/debug/console/http/plugin,
controller y bench fallan cerrado. El launcher añade después sus argumentos
reservados, controller y directorios aislados.

## Provenance

Una importación remota que descargó y verificó realmente un artifact escribe,
de forma atómica, un receipt en:

```text
userData/provenance/packs/<sha256(packId)>.json
```

Schema cerrado v1: `packId`, `artifactSha256`, `artifactSizeBytes`,
`competitionManifestSha256` e `importedAt`. Import folder, import ZIP manual y
un resultado `already-installed` no crean autoridad productiva. Si se regenera
el manifest después de modificar el pack, su hash ya no coincide con el receipt
y Competición queda bloqueada.

En desarrollo se admite `developer_override` únicamente si Developer Tools lo
autoriza y la app no está empaquetada. Un runtime externo exacto 0.287 sirve
para QA bajo esa autoridad; producto exige runtime bundled y receipt remoto.

## Snapshot competitiva

Antes de crear el run se relee `pack.json` desde disco y se compara
`packId/gameId/rom/weekId/packVersion` con el contexto de Play. El manifest se
parsea de nuevo y su cobertura se deriva del pack fresco.

Cada archivo manifestado se abre como archivo regular y se copia a
`userData/runtime/runs/<runId>/pack/` a la vez que se calculan size y SHA-256.
Sólo se renombra el temporal si ambos coinciden. Después se copia el manifest,
se vuelve a cargar `pack.json` desde el snapshot y se verifica el snapshot
completo.

MAME consume ROM, artwork y cfg seed desde el snapshot. El adapter aislado se
copia desde `snapshot/scripts/...`, nunca otra vez desde Biblioteca. Samples se
copian como recurso suplementario estable, con rechazo de symlinks/entradas
especiales, pero continúan fuera del manifest porque el pack auditado contiene
sólo audio WAV de salida. Manual, metadata y assets de launcher no se copian.

## Candidatos automáticos

El plugin `hsl-score` 0.3.0 llama a `game.observe_capture(...)`. El adapter sólo
puede devolver `score` y metadata JSON limitada. El core rechaza metatables,
tipos no JSON, NaN/Infinity, arrays dispersos y valores que excedan límites de
profundidad, nodos, keys, arrays o strings.

El core posee `candidateId`, `runId`, ROM real, `detectedAt`, `source`, score
normalizado, versiones y strategy. Publica atómicamente en:

```text
runRoot/events/candidates/
```

Ese directorio no es pending, no tiene watcher de convergencia, no llama
`onScoreAdopted` y no puede ser visto por auto-submit mientras MAME está vivo.
La captura manual permanece sólo para flows legacy/Práctica; una run protegida
la rechaza.

## Ledger durable y final seal

El guard conserva, por run:

```text
integrity/identity.json
integrity/armed.marker
integrity/violation.<code>.marker
integrity/state.json
integrity/final.marker
```

Los markers se escriben mediante temporal + rename. Al reinicializarse, el
plugin vuelve a cargar todos los markers de violación; nunca convierte una run
violada en limpia. Los códigos canónicos son:

```text
dip_changed pause state_save state_load machine_reset
menu_opened speed_changed throttle_changed integrity_unavailable
```

El stop notifier sólo sella cuando `machine.exit_pending == true`. Un stop
intermedio de hard reset se registra como `machine_reset`, y el plugin que se
reinicializa conserva esa violación. Soft reset dispara reset sin cierre; Escape
normal produce stop con `exit_pending=true`. Kill/crash no produce final seal.

## Finalización app-controlled

Después del cierre del child process, `finalizeCompetitionRun()` valida primero
exit code, identity, ARM, todos los markers, estado final, final seal y todos
los candidates. Un solo candidate corrupto falla cerrado la run completa.

- CLEAN: todos los candidates válidos se convierten en eventos y se publican
  atómicamente en pending scoped;
- VIOLATED: todos se conservan en rejected scoped con
  `LOCAL_COMPETITION_INTEGRITY`;
- seal/estado ausente o corrupto, crash, kill, runId mismatch o never-armed:
  `integrity_unavailable`, cero pending.

La evidence final contiene versión/guard, run, pack, manifest, MAME, plugin,
DIP, violaciones, provenance y un objeto `event` que replica exactamente
`candidateId/rom/score/detectedAt/source`. La app —no el adapter— construye y
valida ese binding antes de publicar.

## Runtime de producto

`prepare:mame` genera `hsl-runtime-integrity.json` con hashes de `mame.exe`,
`plugins/boot.lua` y `bgfx/chains/crt-geom.json`. El staging del plugin genera
`hsl-plugin-integrity.json` y cubre el código crítico de `hsl-score`. Antes de
Competición bundled se rehashean ambos manifests y se exige cobertura mínima;
la copia preparada del plugin y `boot.lua` también se verifican.

El SHA del artifact oficial de MAME y estos hashes de archivos extraídos son
controles distintos. No se hashean miles de shaders sin influencia directa en
emulación/código HSL.

## Práctica

Práctica usa el mismo filtro visual, cfg persistente y `-noplugins`. Conserva
TAB, pausa, save/load, rewind, frame-step, fast-forward, throttle, reset y DIP
libres. No prepara controller, guard, candidates, finalizer ni provenance.

## MAME 0.287 observado

La QA real usó `C:/MAME/mame.exe`, versión exacta 0.287. Confirmó controller
`<mameconfig version="10">`, `UI_CANCEL=KEYCODE_ESC`, los notifiers de pause,
pre-save, post-load, reset y stop, `exit_pending`, hard-reset/reinit y los DIP
reales de Space Invaders. Referencias: [Lua input](https://docs.mamedev.org/luascript/ref-input.html),
[Lua common](https://docs.mamedev.org/luascript/ref-common.html),
[Lua core](https://docs.mamedev.org/luascript/ref-core.html) y
[luaengine.cpp](https://github.com/mamedev/mame/blob/master/src/frontend/mame/luaengine.cpp).
