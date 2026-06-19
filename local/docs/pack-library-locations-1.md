# LOCAL-PACK-LIBRARY-LOCATIONS-1

Soporte minimo para ubicaciones de biblioteca y escaneo basico de packs locales.

## Que es una ubicacion

Una ubicacion es una carpeta raiz donde el jugador guarda packs descomprimidos:

```text
D:/High Score League Packs/
C:/Users/u/Games/HSL/
Disco externo/HSL Packs/
```

La app no copia, mueve ni borra packs. Solo recuerda la carpeta y escanea sus subcarpetas directas.

## Persistencia

Las ubicaciones se guardan en `userData`:

```text
userData/libraries/locations.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-19T00:00:00.000Z",
  "locations": [
    {
      "id": "loc_...",
      "path": "D:/High Score League Packs",
      "addedAt": "2026-06-19T00:00:00.000Z"
    }
  ]
}
```

Si el archivo no existe, la biblioteca empieza vacia. Si esta corrupto, la app no crashea y muestra una biblioteca vacia con warning tecnico.

## Acciones GUI

La GUI anade una seccion `Biblioteca de packs` con:

```text
+ Añadir ubicación
Ubicaciones
Packs detectados
```

`+ Añadir ubicación` abre un dialogo de carpeta. La carpeta elegida representa una raiz que contiene packs. Si el usuario cancela, no cambia nada. Si ya existe, no se duplica.

Tambien se incluye `Quitar` para eliminar la ubicacion de `locations.json`. Esta accion no borra la carpeta real, no borra packs y no borra colas scoped.

## Escaneo

El escaneo mira solo subcarpetas directas:

```text
HSL Packs/
  Space Invaders/
    pack.json
    metadata.json
    assets/
  Galaga/
    pack.json
  Carpeta sin pack/
```

No escanea recursivamente en profundidad. No busca dentro de `mame/`, `roms/`, `plugins/` ni arboles profundos. Una subcarpeta se considera pack candidato si contiene `pack.json`.

Cada pack se carga con el loader existente de packs, por lo que tambien puede cargar `metadata.json` y assets locales si existen.

## Pack detectado

Cada pack detectado expone a la GUI:

```js
{
  id,
  locationId,
  packDir,
  packPath,
  packId,
  gameId,
  rom,
  weekId,
  title,
  subtitle,
  cover,
  icon,
  logo,
  status,
  warnings,
  errors
}
```

El titulo se resuelve por prioridad:

1. `metadata.title`;
2. `pack.packId`;
3. `pack.gameId`;
4. `rom`.

El subtitulo usa `metadata.subtitle` o `weekId`.

Estados iniciales:

- `ok`: pack valido sin warnings.
- `warning`: pack usable con warnings, por ejemplo assets faltantes.
- `error`: `pack.json` invalido o no legible.
- `missing`: ubicacion guardada no disponible.

## Activar un pack

`Usar este pack` activa el pack detectado reutilizando el flujo de `Abrir pack`:

- valida/carga el pack;
- lo marca como pack activo;
- lo recuerda como ultimo pack en `userData/packs/recent.json`;
- refresca estado de GUI;
- usa metadata/assets igual que un pack abierto manualmente;
- conserva la cola scoped por cuenta y pack si hay sesion.

`Abrir pack` sigue existiendo para abrir una carpeta concreta sin pasar por ubicaciones.

## Ubicaciones inexistentes

Si una ubicacion guardada no existe o no esta disponible, la GUI muestra un aviso en la seccion de biblioteca. No se borra automaticamente.

## Limites

Esta tarea no implementa:

- grid visual final;
- filtros;
- busqueda;
- estados remotos `activa`, `cerrada`, `proxima`;
- descarga de packs;
- descarga de assets;
- generacion de packs;
- mover packs a `userData`;
- borrado de carpetas reales.
