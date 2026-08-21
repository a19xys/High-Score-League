# SPACE-INVADERS-PACK-V2-REAL-1

Space Invaders es el primer pack `packVersion: 2` usado como referencia real
para High Score League. Este documento describe el pack externo auditado y el
contrato que deben seguir futuros packs competitivos.

## Pack auditado

Ruta local usada para validacion:

```text
D:/High Score League/Space Invaders/
```

Estructura auditada:

```text
Space Invaders/
  pack.json
  competition-manifest.json
  metadata.json
  artwork/
    invaders.zip
  assets/
    cover.png
    hero.png
    icon.ico
    logo.png
  cfg/
    (vacio; estado persistente de Practica cuando MAME lo necesite)
  manual/
    invaders.pdf
  roms/
    invaders.zip
  samples/
    invaders.zip
  scripts/
    invaders.lua
```

`roms/`, `samples/`, `artwork/` y `assets/` pueden contener material que no es
redistribuible desde este repositorio. No deben copiarse a git salvo licencia y
autorizacion explicitas.

## pack.json canonico

El `pack.json` de referencia declara:

- `packVersion: 2`
- `packId: space-invaders-s1-w1-r1`
- `gameId: space-invaders`
- `rom: invaders`
- `seasonId`, `seasonSlug`, `seasonName`
- `weekId`, `weekNumber`
- `webBaseUrl`
- `runtime.type: mame`
- `runtime.minVersion` y `runtime.recommendedVersion`
- rutas MAME relativas: `roms`, `artwork`, `samples`, `cfg`
- `capture.mode: plugin`
- `capture.pluginName: hsl-score`
- `capture.adapter: scripts/invaders.lua`

Las rutas son siempre relativas al root del pack. No se aceptan rutas absolutas,
URLs ni traversal.

Perfil MAME recomendado:

```json
{
  "mame": {
    "romPath": "roms",
    "artworkPath": "artwork",
    "samplePath": "samples",
    "cfgPath": "cfg",
    "launchArgs": [],
    "profiles": {
      "practice": {
        "launchArgs": []
      },
      "competition": {
        "launchArgs": [
          "-video",
          "bgfx",
          "-bgfx_screen_chains",
          "crt-geom"
        ],
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
            },
            {
              "portTag": ":IN2",
              "mask": 8,
              "value": 0,
              "label": "Bonus Life",
              "settingLabel": "1500"
            }
          ]
        }
      }
    }
  }
}
```

`crt-geom` se aplica solo en competicion. Practica no hereda esos argumentos y
no carga `hsl-score`.

## metadata.json canonico

Campos minimos de presentacion:

```json
{
  "title": "Space Invaders",
  "subtitle": "Pack v2 de referencia",
  "developer": "Taito",
  "publisher": "Taito",
  "year": 1978,
  "genre": ["Fixed shooter", "Arcade"],
  "shortDescription": "El clasico arcade que lo empezo todo. Defiende la Tierra de las oleadas de invasores y consigue la mejor puntuacion.",
  "assets": {
    "cover": "assets/cover.png",
    "hero": "assets/hero.png",
    "icon": "assets/icon.ico",
    "logo": "assets/logo.png"
  }
}
```

Campos recomendables para packs futuros, sin convertirlos en autoridad
competitiva: `manual`, `manualPath`, `manualUrl` y `rankingUrl`.

Para manual local, el launcher abre primero `metadata.manualPath` o
`metadata.manual.path` si existen. Si no estan declarados, acepta
`manual/manual.pdf`, `manual/manual.html`, `manual/index.html` o un unico PDF
dentro de `manual/`. Por eso `manual/invaders.pdf` funciona sin visor PDF
interno y se abre con el visor predeterminado del sistema.

## Adapter Lua

`scripts/invaders.lua` es especifico de Space Invaders y cumple el contrato de
`hsl-score` 0.2.0:

- no usa rutas absolutas;
- no requiere dependencias externas;
- exporta `read_memory(helpers)`;
- exporta `build_event(config, tracker_state, result, plugin_version, detected_at, score, helpers)`;
- valida que la ROM activa sea `invaders`;
- lee el score P1 en BCD desde `0x20F8` y `0x20F9`;
- devuelve errores utiles si no hay memoria o si los bytes BCD son invalidos;
- deja diagnostico opcional de estado en `debug`.

La app no ejecuta el adapter desde el pack. En competicion lo valida, lo copia a
`userData/runtime/runs/<runId>/plugins/hsl-score/games/adapter.lua` y genera un
`config.lua` de ejecucion con `outputDir` apuntando al staging del run.

## Flujo de practica

Practica v2 usa:

```text
MAME compartido
+ -skip_gameinfo
+ recursos del pack
+ mame.launchArgs
+ mame.profiles.practice.launchArgs
```

No prepara run temporal, no anade `-plugins`, no anade `-plugin hsl-score`, no
captura puntuaciones y no escribe eventos competitivos. Anade `-noplugins` y
conserva Tab, pausa, save/load, rewind y DIP como funciones libres de MAME.

## Flujo de competicion

Competicion v2 usa:

```text
MAME compartido
+ -skip_gameinfo
+ recursos del pack
+ mame.launchArgs
+ mame.profiles.competition.launchArgs
+ plugin HSL preparado por ejecucion
+ adapter Lua copiado desde el pack
+ manifest y MAME exacto verificados antes del run
+ controller, estado mutable y staging aislados por run
```

MAME se lanza con:

```text
-homepath <run>/home
-inipath <run>/ini
-cfg_directory <run>/cfg
-nvram_directory <run>/nvram
-input_directory <run>/inp
-state_directory <run>/sta
-snapshot_directory <run>/snap
-diff_directory <run>/diff
-comment_directory <run>/comments
-share_directory <run>/share
-ctrlrpath <run>/ctrlr -ctrlr hsl-competition
-pluginspath <run>/plugins
-plugins
-plugin hsl-score
```

El plugin escribe JSON en:

```text
userData/runtime/runs/<runId>/events/pending
```

Al cerrar MAME, la GUI adopta esos eventos al pending scoped de cuenta + pack:

```text
userData/players/<playerKey>/packs/<packKey>/events/pending
```

El core reemplaza cualquier evidence propuesta por el adapter con
`competitionIntegrity` ligada a run, pack, manifest, MAME y DIP. Sólo una
evidence limpia llega a pending. Si falta, no coincide o contiene una
violacion, el JSON se conserva en `events/rejected` con
`LOCAL_COMPETITION_INTEGRITY` y no dispara auto-submit.

No se usa `userData/events` como staging competitivo v2, no se copia
`hsl-score` a `C:/MAME/plugins` y no se heredan plugins/`plugin.ini` globales.

El resumen local de lanzamiento imprime los argumentos finales. Para este pack,
`Jugar` debe incluir:

```text
-video bgfx -bgfx_screen_chains crt-geom
```

Desde `LOCAL-LAUNCHER-SHELL-DETAIL-HOTFIX-3`, cuando ese perfil usa BGFX, los
argumentos finales tambien garantizan:

```text
-artpath <pack>/artwork;<mame>/artwork
-bgfx_path <mame>/bgfx
```

El artwork del pack va antes que el artwork compartido de MAME. `-bgfx_path`
permanece reservado al launcher y el pack no puede sustituirlo.

`Practicar` puede heredar `mame.launchArgs` comun y el perfil `practice`, pero
no debe cargar `hsl-score` ni heredar el filtro competitivo si solo esta
declarado en `profiles.competition`.

Si falta `roms/invaders.zip`, el pack queda bloqueado antes de lanzar MAME:
`Practicar` y `Jugar` se deshabilitan y la UI muestra que falta la ROM
necesaria. La comprobacion existe tambien en el launcher backend para evitar
abrir MAME aunque una accion visual quedase habilitada por error.

Si hay dos o mas carpetas de pack con `packId: space-invaders-s1-w1-r1`, la
biblioteca muestra una sola entrada agrupada de conflicto. Esa entrada es
seleccionable para explicar el problema y listar rutas, pero `Practicar`,
`Jugar` y favorito quedan bloqueados. No se intenta elegir una carpeta
automaticamente porque el `packId` es identidad competitiva y mezclarla entre
duplicados puede activar el pack equivocado o compartir favoritos/colas de
forma confusa.

## cfg y DIPs

Los antiguos `cfg/default.cfg` y `cfg/invaders.cfg` eran archivos personales
autogenerados con mixer/audio, contadores y zoom, no una policy competitiva.
No se usan como seed. La estructura final deja `cfg/` disponible como estado
persistente libre de Practica y Competition comienza con `runRoot/cfg` vacio.

La investigacion real con MAME 0.287 confirmo:

```text
Lives       : portTag=:IN2 mask=3 value=0 setting=3
Bonus Life  : portTag=:IN2 mask=8 value=0 setting=1500
```

El plugin escribe ambos values en `prestart`, los relee y solo arma la
integridad en el primer frame. Después los relee durante toda la run. Cualquier
cambio queda sticky-invalid aunque el valor se restaure. El controller 0.287
bloquea Tab y las funciones sensibles sin bloquear Escape.

El QA real cambio Lives a 4 y lo persistio en Practica; una Competition
posterior no reutilizo ese cfg, forzo Lives a 3 antes del ARM y termino
`CLEAN`. Los cfg generados exclusivamente para esa prueba se retiraron despues.

## Manifest competitivo

`competition-manifest.json` v1 cubre actualmente:

```text
artwork/invaders.zip
pack.json
roms/invaders.zip
scripts/invaders.lua
```

El artwork se incluye porque `default.lay` contiene elementos interactivos
`inputtag/inputmask`. Samples no se incluyen: el ZIP inspeccionado contiene
solo WAV y actua como salida de audio, no como estado o input emulado.
Metadata, assets y manual son presentacion local.

El hash de los bytes canonicos del manifest de esta revision es:

```text
bddef60c52aaff1c848803388616de592410c8cd48009e1d487941014366f594
```

Cambiar pack, adapter, ROM, artwork o un script relevante sin manifest
coherente bloquea Competition. Regenerar el manifest tras una modificacion
deliberada vuelve a hacer coherente LOCAL pero cambia este hash; la autoridad
WEB futura debera compararlo con la revision publicada.

## crt-geom

Decision actual: aplicar `crt-geom` solo en el perfil `competition`, mediante
`-video bgfx -bgfx_screen_chains crt-geom`.

Motivo: el filtro no se aplica de forma fiable por estar en `cfg`; necesita los
argumentos BGFX. No se fuerza en practica para mantener practica como modo no
competitivo y evitar cambios visuales obligatorios fuera de partida oficial.

El contrato de perfiles queda:

- `mame.launchArgs` se aplica como base comun;
- `mame.profiles.practice.launchArgs` se suma solo en `Practicar`;
- `mame.profiles.competition.launchArgs` se suma solo en `Jugar`;
- competicion prepara el plugin HSL por run;
- practica sigue sin `hsl-score`.

## Samples y artwork

Samples:

- el pack auditado usa `samples/invaders.zip`;
- tambien seria aceptable una carpeta `samples/invaders/` si MAME la consume en
  esa instalacion;
- no deben incluirse carpetas genericas de MAME que no apliquen al juego.
- se excluyen del manifest competitivo mientras sigan siendo solo WAV de
  salida sin efecto sobre el estado emulado.

Artwork:

- el pack auditado usa `artwork/invaders.zip`;
- MAME lo encuentra mediante `mame.artworkPath: artwork`;
- queda cubierto por el manifest porque su layout contiene inputs interactivos;
- no debe duplicarse artwork en otras carpetas si no aporta nada.

Assets:

- la app lee `metadata.json`;
- `assets.cover`, `assets.hero`, `assets.icon` y `assets.logo` deben resolver
  dentro del pack;
- no deben declararse fallbacks remotos ni rutas absolutas.

## No meter en git

No versionar:

- ROMs;
- MAME;
- samples o artwork propietario;
- assets del pack si no estan autorizados;
- eventos reales;
- runs temporales;
- `AppData`/`userData`;
- cfg autogenerado personal salvo que se convierta explicitamente en fixture de
  texto seguro.

## Pendiente

- instalador/catalogo remoto;
- distribucion ZIP/importacion automatica desde el launcher;
- importacion local segura de pack comprimido (`LOCAL-PACK-IMPORT-MVP-1`):
  distribuir comprimido, instalar descomprimido, jugar descomprimido;
- `WEB-COMPETITION-INTEGRITY-1`: binding del `manifestSha256` publicado,
  validacion server-side, ingest y RLS anti-bypass;
- politica de plugins auxiliares aprobados por juego;
- watcher de carpeta de packs con debounce para reescaneo automatico seguro.

Para una primera competicion, Space Invaders se distribuye como carpeta de pack
descomprimida dentro del directorio de packs elegido por el usuario. El flujo de
distribucion MVP esta documentado en `local/docs/pack-distribution-mvp-1.md`.
