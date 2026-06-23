# LOCAL-PACK-DIRECTORY-MODEL-1

Modelo de directorio unico de packs para la app local.

## Objetivo

La biblioteca local pasa de multiples ubicaciones a un unico directorio de
packs. Ese directorio sera el destino claro para packs instalados manualmente
ahora y para packs descargados o actualizados desde catalogo en tareas futuras.

Modelo:

```text
Directorio de packs/
  space-invaders/
    pack.json
    metadata.json
    assets/
    manual/
    roms/
    artwork/
    samples/
  galaga/
    pack.json
  pac-man/
    pack.json
```

La app no mueve, copia ni borra packs al cambiar este directorio.

## Persistencia

El directorio se guarda en:

```text
userData/libraries/pack-directory.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "directoryPath": "D:/High Score League Packs",
  "selectedAt": "2026-06-20T00:00:00.000Z",
  "updatedAt": "2026-06-20T00:00:00.000Z"
}
```

No guarda tokens, sesiones, cuentas ni datos de jugador.

## Compatibilidad con locations.json

`userData/libraries/locations.json` queda obsoleto pero se mantiene como
compatibilidad temporal.

Reglas:

- si `pack-directory.json` existe, manda el directorio unico;
- si no existe y `locations.json` tiene una sola ubicacion, la app crea
  `pack-directory.json` desde esa ubicacion;
- si `locations.json` tiene varias ubicaciones, la app usa una temporalmente y
  muestra warning, pero no migra de forma destructiva;
- no se borra `locations.json`;
- no se borran ubicaciones antiguas;
- no se mueven packs.

## Acciones de GUI

Si no hay directorio configurado, la biblioteca muestra:

```text
Todavia no has elegido un directorio de packs.
Elige una carpeta donde High Score League guardara y buscara tus packs locales.
[Elegir directorio]
```

Si hay directorio:

```text
Directorio de packs
<ruta abreviada>
[Cambiar directorio] [Abrir directorio] [Reescanear]
```

`Elegir directorio` y `Cambiar directorio` abren un dialogo de carpeta,
validan que sea una carpeta existente y guardan `pack-directory.json`.

Si la carpeta elegida contiene directamente `pack.json`, se rechaza como
directorio de biblioteca y se muestra:

```text
Parece que has elegido una carpeta de pack. Elige la carpeta que contiene todos tus packs.
```

`Abrir directorio` abre la carpeta en el explorador del sistema si existe. Si
no existe, muestra aviso.

`Reescanear` vuelve a leer subcarpetas directas y no toca sesiones, colas ni
packs.

## Escaneo

La biblioteca escanea solo subcarpetas directas del directorio configurado:

```text
D:/High Score League Packs/
  space-invaders/pack.json  -> pack detectado
  galaga/pack.json          -> pack detectado
  misc/readme.txt           -> ignorado
  nested/foo/bar/pack.json  -> ignorado
```

No escanea recursivamente arboles profundos y no entra en `roms/`, `artwork/`,
`samples/`, `assets/` ni `plugins/` para descubrir packs.

## Pack activo y colas

El pack activo puede estar dentro o fuera del directorio durante la transicion.

- Si coincide por ruta o identidad, la card se marca como `Activo`.
- Si esta fuera, puede seguir funcionando como pack abierto manual/dev.
- Cambiar directorio no desactiva el pack activo.
- Cambiar directorio no borra ni mueve colas scoped.

Las puntuaciones siguen en:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

## Readiness y Dev Tools

Readiness del pack activo no se reescribe en esta tarea. La biblioteca puede
estar vacia si no hay directorio, mientras un pack abierto manualmente sigue
teniendo readiness propia.

Detalles tecnicos muestran:

- `packDirectoryPath`;
- si el directorio existe;
- si parece pack root;
- conteo de packs;
- `locations.json` legacy detectado;
- warning de migracion legacy.

## Futuro catalogo

Este directorio unico sera el destino futuro para:

- packs descargados desde catalogo;
- packs misteriosos revelados;
- instalacion con un click;
- actualizaciones de packs;
- verificacion de checksums.

Esta tarea no implementa catalogo remoto, descargas, updates, `pack.json` v2 ni
runtime MAME global.

