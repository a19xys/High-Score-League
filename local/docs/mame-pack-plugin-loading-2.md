# LOCAL-MAME-PACK-PLUGIN-LOADING-2

Implementacion inicial de carga segura de plugin/adaptador para competicion
`packVersion: 2` con MAME compartido.

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
```

MAME se lanza con runtime compartido, recursos del pack y:

```text
-pluginspath <run>/plugins -plugins -plugin hsl-score
```

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
2. Prepara el plugin y adapter en `userData/runtime/runs/<runId>`.
3. Lanza MAME compartido con recursos del pack y pluginpath del run.
4. El plugin escribe JSON en `<run>/events/pending`.
5. Al cerrar MAME, la GUI adopta solo archivos de ese staging al scope:

```text
userData/players/<playerKey>/packs/<packKey>/events/pending
```

El staging por run empieza vacio, por lo que no hay capturas antiguas que
adoptar. Si MAME falla o se cierra mal, el run queda en `userData/runtime/runs`
para soporte; no se borran capturas automaticamente.

## Practica v2

Practica v2 sigue usando MAME compartido y recursos del pack, pero no anade
`-plugins`, `-plugin` ni `-pluginspath`. No prepara staging competitivo.

## Legacy v1

`packVersion: 1`, dev bridge y `sync-plugin` se conservan. El flujo v1 puede
seguir usando staging pack-local y adopcion al scope de la GUI.

## Limites conocidos

Esto no es un sandbox anti-cheat completo para Lua. El adapter es codigo Lua
ejecutado por MAME. La mitigacion implementada controla la ruta, copia el
adapter a una zona preparada, controla `outputDir`, aisla staging por ejecucion
y adopta solo desde ese staging. Hardening de adapters firmados/checksums queda
para una tarea posterior.
