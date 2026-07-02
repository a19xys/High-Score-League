# Pack v2 template

Plantilla textual para packs `packVersion: 2`. No incluye ROMs, MAME, samples,
artwork ni assets propietarios.

Estructura recomendada:

```text
Pack Name/
  pack.json
  metadata.json
  assets/
    cover.png
    hero.png
    icon.ico
    logo.png
  roms/
  artwork/
  samples/
  cfg/
  manual/
    manual.pdf
  scripts/
    adapter.lua
```

Completa los placeholders antes de distribuir el pack. Manten todas las rutas
relativas al root del pack.

Distribucion recomendada:

```text
Distribuir comprimido.
Instalar descomprimido.
Jugar descomprimido.
```

Puedes entregar el pack como `.zip` con esta carpeta como raiz, o como `.zip`
con `pack.json` directamente en la raiz. El launcher importara el contenido al
directorio de packs configurado y jugara desde la carpeta instalada.

No incluyas varios packs dentro del mismo ZIP para el MVP. No uses rutas
absolutas ni `..` en `pack.json`, `metadata.json` o entradas del ZIP.
