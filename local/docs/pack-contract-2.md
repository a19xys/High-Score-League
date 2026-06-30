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
- `manifest.json`: integridad, versionado, checksums, instalacion y updates
  futuros. No se valida de forma completa todavia.

`metadata.json` no debe convertirse en autoridad competitiva. `manifest.json`
no debe contener secretos.

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
        "cfgPath": "cfg/competition",
        "launchArgs": ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"]
      }
    }
  }
}
```

El launcher usa el `cfgPath` del perfil si existe, y concatena
`mame.launchArgs` con los argumentos del perfil. Los argumentos siguen siendo
una lista explicita de strings; no hay parseo de shell.

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

La app genera `config.lua` para la ejecucion, el plugin escribe en
`userData/runtime/runs/<runId>/events/pending` y la GUI adopta luego al pending
scoped.
