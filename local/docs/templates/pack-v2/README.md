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
