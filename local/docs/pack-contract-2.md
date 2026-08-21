# LOCAL-PACK-CONTRACT-2

Contrato inicial para `packVersion: 2` y compatibilidad temporal con
`packVersion: 1`.

## Objetivo

`packVersion: 2` es el contrato actual para packs ligeros de High Score League.
El pack no incluye MAME. La app local cargara el pack, leera sus recursos y,
cuando exista `LOCAL-SHARED-MAME-RUNTIME-1`, lanzara el runtime MAME compartido
instalado con la app.

`packVersion: 1` sigue soportado para el dev bridge y packs de prueba, pero
queda marcado como legacy/deprecated porque puede declarar MAME dentro del pack
mediante `mame.relativeExecutablePath`, `mame.executablePath` y
`mame.workingDir`.

## Campos requeridos v2

- `packVersion`
- `packId`
- `gameId`
- `rom`
- `weekId`
- `webBaseUrl`
- `runtime.type`
- `mame.romPath`
- `capture.mode`

`runtime.type` debe ser `mame` en esta version del contrato.

## Campos recomendados v2

- `seasonId`
- `seasonSlug`
- `seasonName`
- `weekNumber`
- `runtime.minVersion`
- `runtime.recommendedVersion`
- `mame.artworkPath`
- `mame.samplePath`
- `mame.cfgPath`
- `capture.pluginName`
- `capture.adapter`

Estos campos mejoran experiencia offline, diagnostico y preparacion del runtime,
pero no sustituyen la autoridad competitiva de la web.

## Separacion de responsabilidades

- `pack.json`: contrato tecnico, jugable y competitivo.
- `metadata.json`: presentacion local, textos, creditos, enlaces y assets.
- `competition-manifest.json`: cobertura local determinista de los bytes que
  pueden afectar una Competition protegida. Se valida antes de crear el run.
- el descriptor/artefacto remoto de distribucion conserva su responsabilidad
  independiente sobre descarga, instalacion y updates.

`metadata.json` no debe convertirse en autoridad competitiva.
`competition-manifest.json` no contiene secretos, timestamps ni rutas
absolutas y todavia no es una firma ni una autoridad web.

## Rutas seguras

Las rutas locales de v2 son relativas al root del pack. Se aceptan valores como:

```text
roms
artwork
samples
cfg
scripts/invaders.lua
```

Se rechazan rutas absolutas, traversal y URLs para recursos locales:

```text
C:/...
/usr/...
../fuera-del-pack
https://...
file://...
```

Se validan especialmente `mame.romPath`, `mame.artworkPath`,
`mame.samplePath`, `mame.cfgPath` y `capture.adapter`. `mame.romPath` y
`capture.adapter`, cuando se declara, fallan si son inseguros.

`mame.profiles.practice.cfgPath` y `mame.profiles.competition.cfgPath`, si se
declaran, siguen las mismas reglas de ruta relativa segura.

## Pack de referencia

Space Invaders es el primer pack v2 de referencia real. Su adapter canonico es
`scripts/invaders.lua`, los assets canonicos son `assets/cover.png`,
`assets/hero.png`, `assets/icon.ico` y `assets/logo.png`, y el filtro
`crt-geom` se declara solo en `mame.profiles.competition.launchArgs`.

La estructura y decisiones completas estan documentadas en:

```text
local/docs/space-invaders-pack-v2-real-1.md
```

La distribucion MVP de packs locales para una primera competicion esta
documentada en:

```text
local/docs/pack-distribution-mvp-1.md
```

## Normalizacion

El loader normaliza v1 y v2 con campos comunes:

- `packVersion`
- `contractStatus`
- `deprecated`
- `deprecationReason`
- `replacement`
- identidad del pack, juego, ROM, temporada, semana y web
- `contract.runtime`
- `contract.mame`
- `contract.capture`
- `warnings`
- `errors`

Para v1:

```js
{
  contractStatus: "deprecated",
  deprecated: true,
  replacement: "packVersion 2"
}
```

Para v2:

```js
{
  contractStatus: "current",
  deprecated: false
}
```

## Estado actual de ejecucion

La biblioteca puede detectar y mostrar packs v2 validos. Readiness puede cargar
el pack y explicar su estado. Desde `LOCAL-SHARED-MAME-RUNTIME-1`, practica v2
puede usar el runtime MAME compartido si esta configurado y `mame.romPath`
existe. Desde `LOCAL-MAME-PACK-PLUGIN-LOADING-2`, competicion v2 prepara
plugin/adaptador por ejecucion cuando el resto de requisitos estan listos.
Desde `LOCAL-COMPETITION-INTEGRITY-1`, solo un pack que declara `integrity` v1,
verifica su manifest y usa la version MAME exacta puede preparar una
Competition protegida. Un pack v2 sin policy sigue siendo valido para la
Biblioteca y Practica; no se migra ni se marca corrupto.

## Perfiles MAME opcionales

El contrato acepta `mame.profiles.practice` y `mame.profiles.competition` para
ajustar el lanzamiento por modo sin cambiar el runtime compartido:

```json
{
  "mame": {
    "cfgPath": "cfg",
    "launchArgs": [],
    "profiles": {
      "practice": {
        "cfgPath": "cfg/practice",
        "launchArgs": []
      },
      "competition": {
        "launchArgs": ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
        "integrity": {
          "version": 1,
          "mameVersion": "0.287",
          "dips": [
            {
              "portTag": ":IN2",
              "mask": 3,
              "value": 0,
              "label": "Lives",
              "settingLabel": "3"
            }
          ]
        }
      }
    }
  }
}
```

En Practica, el launcher usa el `cfgPath` del perfil o `mame.cfgPath` como cfg
persistente. En Competition protegida, el cfg efectivo siempre es
`runRoot/cfg`; un `profiles.competition.cfgPath` opcional es solo seed
manifestado y copiado. Nunca se usa vivo dentro del pack.

El launcher concatena `mame.launchArgs` con los argumentos del perfil. Son una
lista explicita de strings, sin parseo de shell. En Competition, `ctrlr`,
rewind, state/save/load, cheats, speed/throttle, debugger, autoboot, console,
HTTP y plugins permanecen bajo autoridad del launcher; esas familias no se
prohiben globalmente a Practica.

## Integrity y manifest competitivos v1

El schema, canonicalizacion y limites completos estan documentados en
`local/docs/competition-integrity-1.md`. En resumen:

- `integrity.version` es exactamente 1 y `mameVersion` es exacta;
- hay 1-32 DIP canonicos por `portTag + mask`, con value dentro de mask;
- la cobertura deriva de pack, adapter, ROMs, scripts, artwork interactivo y
  seed competitivo;
- samples, metadata, assets y manual se excluyen solo cuando son salida de
  audio o presentacion sin efecto sobre estado/captura;
- paths, orden, size, SHA-256 y serializacion son canonicos.

La ausencia de `integrity` es compatible. Readiness diferencia pack valido de
pack listo para Competition protegida. Una modificacion no acompanada bloquea
Competition y deja Practica disponible. Regenerar el manifest tras modificar
el pack produce un hash coherente nuevo; `WEB-COMPETITION-INTEGRITY-1` debera
compararlo con el valor publicado.

## Compatibilidad legacy

El soporte v1 se conserva para no romper:

- dev bridge;
- pack plano `hsl-invaders`;
- pruebas existentes;
- `sync-plugin`;
- apertura manual de packs antiguos.

La eliminacion de v1 queda para `LOCAL-REMOVE-PACK-V1-LEGACY`, despues de tener
runtime compartido estable, carga de plugin/adaptador y migracion de packs.

## Estado anterior de capture.adapter

El contrato valida que `capture.adapter` sea relativo y permanezca dentro del
pack. El launcher comprueba además si el archivo existe, pero todavía no lo
ejecuta ni lo copia. Por seguridad, declarar el campo no habilita competición
v2 hasta `LOCAL-MAME-PACK-PLUGIN-LOADING-2`.

## Estado actual de capture.adapter

Desde `LOCAL-MAME-PACK-PLUGIN-LOADING-2`, `capture.adapter` ya participa en la
competicion v2 cuando el resto de requisitos estan listos: runtime compartido,
sesion, scope, membership, plugin controlado por la app y staging de ejecucion.

El adapter no se ejecuta directamente desde el pack. La app lo valida como ruta
relativa segura, comprueba que exista y lo copia a:

```text
userData/runtime/runs/<runId>/plugins/hsl-score/games/adapter.lua
```

El contrato inicial del adapter es un modulo Lua que devuelve una tabla con:

```lua
read_memory(helpers)
build_event(config, tracker_state, result, plugin_version, detected_at, score, helpers)
```

La app genera `config.lua` para la ejecucion, incluyendo la policy ya validada,
y el plugin escribe en
`userData/runtime/runs/<runId>/events/pending` y la GUI adopta luego al pending
scoped. El core HSL, no el adapter, anade `competitionIntegrity`; eventos
violados o sin evidencia valida van a rejected local y no disparan submit.
