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
scripts/space-invaders.lua
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
existe. Competicion v2 sigue bloqueada hasta
`LOCAL-MAME-PACK-PLUGIN-LOADING-1`.

## Compatibilidad legacy

El soporte v1 se conserva para no romper:

- dev bridge;
- pack plano `hsl-invaders`;
- pruebas existentes;
- `sync-plugin`;
- apertura manual de packs antiguos.

La eliminacion de v1 queda para `LOCAL-REMOVE-PACK-V1-LEGACY`, despues de tener
runtime compartido estable, carga de plugin/adaptador y migracion de packs.
