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
  metadata.json
  artwork/
    invaders.zip
  assets/
    cover.png
    hero.png
    icon.ico
    logo.png
  cfg/
    default.cfg
    invaders.cfg
  manual/
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
- `packId: space-invaders-dev-pack-v2`
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
        "cfgPath": "cfg",
        "launchArgs": [
          "-video",
          "bgfx",
          "-bgfx_screen_chains",
          "crt-geom"
        ]
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

## Adapter Lua

`scripts/invaders.lua` es especifico de Space Invaders y cumple el contrato de
`hsl-score` 0.1.5:

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
+ recursos del pack
+ mame.launchArgs
+ mame.profiles.practice.launchArgs
```

No prepara run temporal, no anade `-plugins`, no anade `-plugin hsl-score`, no
captura puntuaciones y no escribe eventos competitivos.

## Flujo de competicion

Competicion v2 usa:

```text
MAME compartido
+ recursos del pack
+ mame.launchArgs
+ mame.profiles.competition.launchArgs
+ plugin HSL preparado por ejecucion
+ adapter Lua copiado desde el pack
+ staging temporal por run
```

MAME se lanza con:

```text
-homepath <run>
-pluginspath <run>/plugins;<mame>/plugins
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

No se usa `userData/events` como staging competitivo v2 y no se copia
`hsl-score` a `C:/MAME/plugins`.

## cfg y DIPs

El pack auditado incluye `cfg/default.cfg` y `cfg/invaders.cfg`, ambos
autogenerados por MAME. Contienen mixer/audio, contador de monedas y zoom de
video; no expresan reglas competitivas.

Para Space Invaders, `invaders -listxml` confirmo que los defaults de MAME ya
son:

```text
Lives = 3
Bonus Life = 1500
```

Decision actual: no forzar DIPs en `cfg`. El hardening de TAB/DIPs queda para
una tarea posterior. Si un futuro pack necesita DIPs competitivos, debe declarar
una configuracion entendida, minima y reproducible, no un `.cfg` personal.

## crt-geom

Decision actual: aplicar `crt-geom` solo en el perfil `competition`, mediante
`-video bgfx -bgfx_screen_chains crt-geom`.

Motivo: el filtro no se aplica de forma fiable por estar en `cfg`; necesita los
argumentos BGFX. No se fuerza en practica para mantener practica como modo no
competitivo y evitar cambios visuales obligatorios fuera de partida oficial.

## Samples y artwork

Samples:

- el pack auditado usa `samples/invaders.zip`;
- tambien seria aceptable una carpeta `samples/invaders/` si MAME la consume en
  esa instalacion;
- no deben incluirse carpetas genericas de MAME que no apliquen al juego.

Artwork:

- el pack auditado usa `artwork/invaders.zip`;
- MAME lo encuentra mediante `mame.artworkPath: artwork`;
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

- manifest con checksums/firma del pack;
- instalador/catalogo remoto;
- hardening anti-cheat;
- bloqueo o auditoria fuerte de TAB/DIPs;
- politica de plugins auxiliares aprobados por juego;
- validacion automatica de MAME real y `-listxml` sin depender de ROM en tests.
