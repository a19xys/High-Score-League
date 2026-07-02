# LOCAL-PACK-IMPORT-MVP-1

Importacion local segura de packs desde ZIP o carpeta para el launcher local.

## Regla de producto

```text
Distribuir comprimido.
Instalar descomprimido.
Jugar descomprimido.
```

El usuario puede recibir un archivo como `SpaceInvaders.hslpack.zip` o
`SpaceInvaders.zip`, importarlo desde el launcher y jugar despues desde la
carpeta instalada en su biblioteca local. El launcher no ejecuta packs desde
ZIP.

## Formatos soportados

ZIP con carpeta raiz:

```text
Space Invaders/
  pack.json
  metadata.json
  roms/
  artwork/
  samples/
  assets/
  manual/
  scripts/
```

ZIP con `pack.json` en raiz:

```text
pack.json
metadata.json
roms/
artwork/
samples/
assets/
manual/
scripts/
```

Carpeta que ya es el pack:

```text
Space Invaders/
  pack.json
```

Carpeta contenedora con un unico pack:

```text
Importacion/
  Space Invaders/
    pack.json
```

## Estructuras rechazadas

- ZIP o carpeta sin `pack.json`.
- ZIP o carpeta con varios packs.
- ZIP con `pack.json` mas profundo que una carpeta raiz.
- ZIP con archivos utiles fuera de la carpeta raiz detectada.
- `pack.json` que no sea JSON valido.
- `metadata.json`, si existe, que no sea JSON valido.
- `packVersion` distinto de 2.
- packs con contrato v2 invalido.
- falta de ROM requerida segun `mame.romPath` y `rom`.
- falta de adapter segun `capture.adapter`.
- rutas de contrato inseguras.
- duplicado de `packId` ya instalado en otra carpeta.
- colision de carpeta destino.

El caso especial de importar una carpeta que ya es una subcarpeta directa del
directorio de packs no se trata como duplicado fatal: se valida, se reescanea y
se selecciona como pack ya presente en la biblioteca.

## Seguridad ZIP

Antes de extraer se inspeccionan todas las entradas del ZIP. Se rechazan:

- rutas absolutas;
- rutas con drive letter de Windows;
- rutas UNC;
- rutas que empiezan por `/` o `\`;
- segmentos `..`;
- bytes nulos;
- rutas vacias;
- nombres reservados de Windows;
- caracteres no validos de Windows;
- segmentos con punto o espacio final;
- symlinks y entradas especiales si el ZIP las expone.

Los separadores `\` se normalizan a `/`, pero la proteccion no depende solo de
esa normalizacion: cada destino se resuelve con `path.resolve` y debe quedar
dentro del temporal de importacion.

Se ignora basura conocida como `__MACOSX/`, `.DS_Store` y `Thumbs.db` despues
de validar que su ruta no es peligrosa.

## Limites anti ZIP bomb

Limites MVP:

- maximo de entradas: 4096;
- tamano maximo por archivo descomprimido: 1 GiB;
- tamano total descomprimido: 4 GiB.

La libreria ZIP expone tamanos de entrada y la extraccion tambien acumula bytes
escritos. Si se supera un limite, la importacion falla, se borra el temporal y
no se finaliza la instalacion.

Estos limites permiten packs con ROMs, artwork, samples, assets, manuales,
scripts y cfg, pero evitan casos absurdos para el MVP local.

## Instalacion atomica

El destino siempre es el directorio de packs configurado. Si no hay directorio
configurado, el usuario debe elegirlo primero.

Flujo:

```text
1. Resolver directorio de packs.
2. Crear .hsl-import-<timestamp>-<random> dentro del mismo directorio.
3. Extraer ZIP o copiar carpeta al temporal.
4. Validar pack desde el temporal usando loadPackFromDir/pack-contract.
5. Validar ROM y adapter reales desde el contrato.
6. Comprobar colision de carpeta destino.
7. Comprobar duplicado de packId.
8. Renombrar temporal a carpeta final.
9. Reescanear biblioteca desde el servicio GUI.
10. Activar el pack por ruta final.
```

Si falla cualquier paso, se borra el temporal y no se toca ningun pack
existente. El escaner tambien ignora carpetas `.hsl-import-*` para que nunca
aparezcan como packs seleccionables.

## Carpeta destino

El nombre de carpeta instalada se elige, en orden, desde:

1. `metadata.title`;
2. `packId`;
3. `gameId`;
4. nombre del ZIP o carpeta.

El nombre se sanea para Windows: se quitan caracteres invalidos, puntos y
espacios finales, nombres reservados y se limita la longitud. El MVP rechaza
colisiones y no renombra automaticamente a `Nombre 2`.

## Mensajes de jugador

Ejemplos:

- `No encuentro pack.json.`
- `Este ZIP contiene varios packs. Importa un pack cada vez.`
- `Esta carpeta contiene varios packs. Importa un pack cada vez.`
- `pack.json no es JSON valido.`
- `Este pack no es compatible con esta version del launcher.`
- `Falta la ROM necesaria: <ruta>.`
- `Falta el adaptador de captura: <ruta>.`
- `El ZIP contiene rutas inseguras.`
- `Ya tienes instalado un pack con el mismo packId.`
- `Ya existe un pack instalado en esa carpeta.`
- `No se pudo completar la importacion. No se ha instalado nada.`

## UI e IPC

La biblioteca muestra dos acciones:

```text
Importar ZIP
Importar carpeta
```

Durante la operacion se usa `busyLabel: "Importando pack"`. La API expuesta al
renderer solo permite acciones concretas:

```text
launcher:import-pack-zip
launcher:import-pack-folder
```

No se expone filesystem generico al renderer.

## Queda fuera

- catalogo remoto;
- descarga desde web;
- updater;
- sobrescritura de packs;
- desinstalacion;
- firmas;
- checksums avanzados;
- manifest de integridad;
- watcher automatico;
- empaquetar MAME;
- ranking embebido.
