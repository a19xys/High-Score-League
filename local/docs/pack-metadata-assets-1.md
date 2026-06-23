# LOCAL-PACK-METADATA-ASSETS-1

Soporte inicial para `metadata.json` y `assets/` dentro de packs locales.

## Objetivo

El pack activo puede enriquecer su presentación local sin cambiar el contrato jugable:

```text
pack.json = contrato tecnico jugable
metadata.json = presentacion local opcional
assets/ = imagenes locales opcionales del pack
```

Esto no implementa por si mismo biblioteca de ubicaciones, filtros, busqueda ni descarga de assets. Solo permite que el pack abierto, el ultimo pack recordado o un pack cargado por fallback muestren mejor titulo, descripcion, creditos e imagenes si existen.

Desde `LOCAL-PACK-LIBRARY-LOCATIONS-1`, los packs detectados por ubicaciones tambien usan esta misma metadata y assets para presentarse en la biblioteca basica.

Desde `LOCAL-PACK-LIBRARY-GRID-1`, esa presentacion de biblioteca ya es visual:
las cards usan `cover`, luego `icon` y luego `logo` como imagen local. Si no hay
assets validos, muestran un placeholder HSL con iniciales y el pack sigue
usable.

## Estructura propuesta

```text
pack/
  pack.json
  metadata.json
  manifest.json
  assets/
    hero.png | hero.jpg | hero.webp
    logo.png | logo.svg
    icon.png | icon.svg
    cover.jpg | cover.png | cover.webp
  manual/
  roms/
  artwork/
  samples/
```

`metadata.json` es opcional. Si falta, el launcher conserva el fallback actual: nombre de juego desde el registro local, `gameId`, ROM, semana y estado de cola.

En el modelo final documentado por
`shared-mame-runtime-blueprint-1.md`, esta estructura pertenece a un pack
ligero sin MAME. `metadata.json` y `assets/` siguen siendo solo presentacion
local; `pack.json` v2 debera referenciar recursos del pack, no un `mame.exe`
incluido dentro del pack.

`LOCAL-PACK-CONTRACT-2` fija esa separacion: `pack.json` v2 contiene identidad,
competicion, runtime, rutas relativas de recursos MAME y captura; `metadata.json`
contiene presentacion; `manifest.json` queda reservado para versionado,
checksums, integridad e instalacion con un click.

## Campos iniciales

```json
{
  "title": "Space Invaders",
  "subtitle": "Semana 1",
  "developer": "Taito",
  "publisher": "Taito",
  "year": 1978,
  "genre": ["Fixed shooter"],
  "shortDescription": "Defiende la Tierra oleada tras oleada.",
  "manualUrl": "https://...",
  "rankingUrl": "https://...",
  "assets": {
    "hero": "assets/hero.png",
    "logo": "assets/logo.png",
    "icon": "assets/icon.png",
    "cover": "assets/cover.jpg"
  }
}
```

Los campos son de presentación local. No sustituyen `weekId`, `rom`, `webBaseUrl`, rutas MAME ni datos oficiales de competición. La metadata no se usa para construir comandos MAME ni payloads de submissions.

## Resolución de assets

Los assets deben ser rutas relativas dentro del pack. Se aceptan:

- `hero`: `.png`, `.jpg`, `.jpeg`, `.webp`;
- `cover`: `.png`, `.jpg`, `.jpeg`, `.webp`;
- `logo`: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`;
- `icon`: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`.

No se aceptan rutas absolutas, URLs remotas ni rutas con `../` que salgan del pack. Si un asset falta o no es válido, el loader devuelve un warning y la GUI usa fallback visual. No se bloquea `Abrir pack`, `Jugar` ni `Practicar`.

## Uso en la GUI

Para el pack activo, la GUI usa si están disponibles:

- `title` como título principal;
- `subtitle` como subtítulo;
- `shortDescription` como texto del panel principal;
- `developer`, `publisher`, `year` y `genre` como créditos discretos;
- `hero` o `cover` como imagen ambiental del panel;
- `logo` o `icon` junto al título;
- `cover` o `icon` como apoyo visual junto a la cola.

Los warnings de metadata/assets quedan en `Herramientas de desarrollo > Detalles técnicos`.

Para packs no activos en la biblioteca, la GUI usa solo la metadata ya cargada
por `scanPackLibrary`. No ejecuta readiness completa ni consulta la web para
cada pack.

## Pack plano hsl-invaders

Ejemplo versionado:

```text
local/examples/metadata.hsl-invaders.example.json
```

Para probarlo con el pack plano actual:

```text
C:/Users/u/Downloads/hsl-invaders/metadata.json
```

Opcionalmente se pueden crear las imágenes:

```text
C:/Users/u/Downloads/hsl-invaders/assets/
  hero.png
  logo.png
  icon.png
  cover.jpg
```

Si no se crean imágenes, la metadata textual se carga y los assets generan warnings técnicos recuperables.

## Seguridad y límites

- No se ejecuta código desde metadata.
- No se permite HTML crudo desde metadata; el renderer escapa textos.
- No se imprimen tokens, contraseñas, Supabase anon key ni contenido de sesión.
- No se cargan assets remotos como imágenes locales.
- No se cambia auth, scoped queue, plugin MAME, endpoint ingest, payload ni `duplicateKey`.
- No se modifica `config.json` real.
