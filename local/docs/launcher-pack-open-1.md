# LOCAL-LAUNCHER-PACK-OPEN-1

Primer paso para abrir packs externos desde la GUI local.

## Uso

1. Ejecutar la GUI:

   ```powershell
   npm.cmd --prefix local/hsl-local-app run gui
   ```

2. Pulsar `Abrir pack`.
3. Elegir la carpeta raíz del pack, es decir, la carpeta que contiene
   `pack.json`.

## Qué valida

- `pack.json` existe.
- El JSON se puede leer.
- El pack cumple el esquema mínimo actual: `packVersion`, `gameId`, `rom`,
  `weekId`, `webBaseUrl` y bloque `mame`.
- El bloque `mame` permite resolver ejecutable, working dir y plugin.

## Qué cambia

Cuando el pack es válido, queda activo solo en memoria durante la sesión de la
GUI. Las acciones de la GUI usan la configuración derivada del pack:

- `Jugar competición`.
- `Practicar`.
- `Subir pendientes`.
- Cola local visible.
- `Diagnóstico`.

La cola se resuelve de forma provisional dentro del pack:

```text
<mame.workingDir>/plugins/<pluginName>/events/pending
<mame.workingDir>/plugins/<pluginName>/events/sent
<mame.workingDir>/plugins/<pluginName>/events/failed
```

## Qué no cambia

- No se modifica `config.json`.
- No se copian ROMs, MAME ni eventos.
- No se borra `pending` al abrir o cambiar pack.
- No se mueve la sesión al pack.
- No hay lista de packs recientes.
- No hay persistencia del pack abierto.
- No hay multi-pack completo.
- `sync-plugin` sigue siendo solo herramienta de desarrollo puente.

Si no se abre ningún pack, la GUI mantiene el fallback actual de `config.json`
en modo desarrollo puente.
