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

Si la carpeta no contiene `pack.json`, el error es esperado:

```text
No encuentro pack.json en esta carpeta.
```

El pack de desarrollo actual `C:/Users/u/Downloads/hsl-invaders/` todavía es
un pack plano con MAME en la raíz. Para probar `Abrir pack` con ese layout,
copia este ejemplo versionado:

```text
local/examples/pack.hsl-invaders-flat.example.json
```

a:

```text
C:/Users/u/Downloads/hsl-invaders/pack.json
```

Después rellena `weekId` con el identificador real de la semana. `seasonId` no
es obligatorio en el esquema actual; puede añadirse más adelante si el pack
formal lo necesita.

## Qué valida

- `pack.json` existe.
- El JSON se puede leer.
- El pack cumple el esquema mínimo actual: `packVersion`, `gameId`, `rom`,
  `weekId`, `webBaseUrl` y bloque `mame`.
- El bloque `mame` permite resolver ejecutable, working dir y plugin.

Para el pack plano de desarrollo, la parte MAME debe quedar así:

```json
"mame": {
  "relativeExecutablePath": "mame.exe",
  "workingDir": ".",
  "pluginName": "hsl-score"
}
```

Eso significa:

- ejecutable: `<pack>/mame.exe`;
- working dir: la raíz del pack;
- plugin: `<pack>/plugins/hsl-score`.

## Qué cambia

Cuando el pack es válido, queda activo solo en memoria durante la sesión de la
GUI. Las acciones de la GUI usan la configuración derivada del pack:

- `Jugar competición`.
- `Practicar`.
- `Subir pendientes`.
- Cola local visible.
- `Diagnóstico`.

Desde `LOCAL-LAUNCHER-PACK-REMEMBER-1`, la GUI también recuerda el último pack
válido abierto en:

```text
userData/packs/recent.json
```

El archivo solo guarda la ruta del pack y la fecha de actualización:

```json
{
  "lastOpenedPackDir": "C:/Users/u/Downloads/hsl-invaders",
  "updatedAt": "2026-06-19T00:00:00.000Z"
}
```

Al iniciar de nuevo, la GUI intenta recargar ese pack. Si la carpeta ya no
existe, falta `pack.json` o el pack dejó de ser válido, muestra un aviso y
mantiene el fallback de desarrollo puente.

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
- No hay lista de packs recientes completa.
- No hay multi-pack completo.
- `sync-plugin` sigue siendo solo herramienta de desarrollo puente.

Si no se abre ningún pack, la GUI mantiene el fallback actual de `config.json`
en modo desarrollo puente.

## Pack plano vs pack final

El pack plano de desarrollo existe para aprovechar el layout actual:

```text
hsl-invaders/
  pack.json
  mame.exe
  roms/
  plugins/
```

El layout final distribuible documentado por `local/pack.example.json` seguirá
siendo más limpio:

```text
HSL_SpaceInvaders_Semana1/
  pack.json
  mame/
    mame.exe
    roms/
    plugins/
```

Esta tarea no migra ni reestructura el pack real. Solo documenta cómo añadir el
manifiesto mínimo para que la GUI pueda abrirlo.
