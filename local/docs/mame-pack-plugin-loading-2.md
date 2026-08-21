# LOCAL-MAME-PACK-PLUGIN-LOADING-2

Implementacion inicial de carga segura de plugin/adaptador para competicion
`packVersion: 2` con MAME compartido.

> Estado actual: `LOCAL-COMPETITION-INTEGRITY-1` endurece esta preparacion con
> manifest, MAME exacto, sandbox mutable completo, controller y evidencia. Las
> reglas actuales prevalecen sobre las decisiones iniciales descritas aqui.

## Estrategia elegida

Se eligio una variante de:

```text
Plugin controlado por la app + adapter del pack validado y copiado a una
preparacion aislada por ejecucion.
```

Por cada partida competitiva v2, la GUI crea:

```text
userData/runtime/runs/<runId>/
  run.json
  cfg/ ctrlr/ nvram/ inp/ sta/ snap/ diff/ comments/ share/ home/ ini/
  events/
    pending/
    failed/
    sent/
  plugins/
    hsl-score/
      init.lua
      plugin.json
      config.lua
      core/
      games/
        adapter.lua
        invaders.lua
```

`hsl-score` se copia desde el plugin versionado del proyecto. El
`capture.adapter` del pack se valida como ruta relativa dentro del pack y se
copia a `games/adapter.lua`. La app genera `config.lua` para esa ejecucion con:

```lua
outputDir = "<run>/events/pending"
gameModule = "games/adapter.lua"
competitionIntegrity = { ...policy validada por el launcher... }
```

MAME se lanza con runtime compartido, recursos del pack y:

```text
-homepath <run>/home -inipath <run>/ini
-pluginspath <run>/plugins -plugins -plugin hsl-score
```

La app copia al run únicamente `plugins/boot.lua` del runtime seleccionado y
`hsl-score`; no expone el directorio global de plugins ni su `plugin.ini`.

## Por que no se eligieron otras opciones

- No se usa `userData/events` como staging v2: es fallback legacy/CLI.
- No se modifica el pack ni se copia el plugin dentro del pack: los packs v2
  siguen siendo ligeros.
- No se deja al plugin leer directamente una ruta arbitraria del pack:
  `capture.adapter` se copia a una ubicacion preparada por la app.
- No se escribe directo en `pending` scoped: primero se escribe en staging de
  la ejecucion, y luego la app adopta al scope.

## Contrato inicial de capture.adapter

`capture.adapter` debe ser una ruta relativa segura dentro del pack, por
ejemplo:

```text
scripts/invaders.lua
```

No se aceptan rutas absolutas, traversal, URL ni `file://`.

El archivo Lua debe devolver una tabla compatible con el plugin:

```lua
return {
  read_memory = function(helpers) ... end,
  build_event = function(config, tracker_state, result, plugin_version, detected_at, score, helpers) ... end
}
```

El plugin valida en runtime que esas funciones existan. La validacion de la app
comprueba ruta, ubicacion dentro del pack, existencia del archivo, plugin name y
preparacion de staging.

## Flujo de competicion v2

1. La GUI valida sesion, membership y scope como antes.
2. Verifica manifest y versión MAME exacta antes de crear el run.
3. Prepara plugin, adapter, controller y estado mutable en
   `userData/runtime/runs/<runId>`.
4. Lanza MAME compartido con recursos del pack y pluginpath del run.
5. El plugin publica cada evento de forma atomica: escribe y cierra
   `<nombre>.json.tmp`, y despues lo renombra a `<nombre>.json`.
6. Un monitor ligado al run usa las notificaciones del filesystem como hints,
   reenumera el staging y adopta los `.json` completos al scope mientras MAME
   sigue abierto:

```text
userData/players/<playerKey>/packs/<packKey>/events/pending
```

7. Sólo una evidence limpia se adopta a pending y solicita autoenvio con
   `score-adopted`; una run violada va a rejected local.
8. Al cerrar MAME, la GUI detiene el watcher y ejecuta un rescan final completo
   que recupera cualquier notificacion perdida antes de finalizar el run.

El staging por run empieza vacio, por lo que no hay capturas antiguas que
adoptar. El contexto de player y pack queda congelado al preparar el run. Si
MAME falla o se cierra mal, el run queda en `userData/runtime/runs` para
soporte; no se borran capturas automaticamente. El watcher reduce latencia y
el rescan al cierre es la garantia de convergencia.

Detalles de publicacion, coalescencia, autoenvio y estados de producto:
[`score-submit-convergence-1.md`](score-submit-convergence-1.md).

## Practica v2

Practica v2 sigue usando MAME compartido y recursos del pack, añade
`-noplugins` y no prepara staging ni monitor competitivo.

## Perfiles de lanzamiento

`packVersion: 2` puede declarar perfiles opcionales por modo en
`mame.profiles.practice` y `mame.profiles.competition`:

```json
{
  "mame": {
    "cfgPath": "cfg",
    "launchArgs": [],
    "profiles": {
      "competition": {
        "launchArgs": ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
        "integrity": {
          "version": 1,
          "mameVersion": "0.287",
          "dips": [
            { "portTag": ":IN2", "mask": 3, "value": 0, "label": "Lives", "settingLabel": "3" }
          ]
        }
      }
    }
  }
}
```

Práctica usa el cfg del perfil o `mame.cfgPath`. Competition siempre usa
`runRoot/cfg`; su `cfgPath` opcional es sólo seed manifestado. El launcher
anade primero `mame.launchArgs` y despues los `launchArgs` del perfil. Esto
permite aplicar filtros como `crt-geom` solo en competicion.

La referencia real de Space Invaders mantiene `crt-geom` solo en el perfil
`competition`, no usa seed, declara Lives=3/Bonus Life=1500 en `integrity` y
deja el cfg personal exclusivamente a Práctica.

## Legacy v1

`packVersion: 1`, dev bridge y `sync-plugin` se conservan. El flujo v1 puede
seguir usando staging pack-local y adopcion al scope de la GUI al cerrar MAME.
Una adopcion no vacia solicita autoenvio inmediatamente, pero v1 no incorpora
observacion en vivo.

## Limites conocidos

Esto no es una autoridad criptográfica independiente. El adapter está cubierto
por el manifest y no puede escribir la evidencia core, pero un actor que
modifique código local confiable o regenere pack+manifest todavía requiere la
futura validación de `WEB-COMPETITION-INTEGRITY-1`.
