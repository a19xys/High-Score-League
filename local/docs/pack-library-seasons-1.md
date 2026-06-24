# LOCAL-PACK-LIBRARY-SEASONS-1

La biblioteca agrupa packs instalados usando datos locales:

- `seasonId` y `seasonName` para packs v2;
- `Sin temporada` cuando no hay temporada;
- `Legacy / deprecated` para packs v1.

No consulta la web por pack y no inventa estados remotos. Los packs siguen
viviendo en un único directorio y `locations.json` solo se usa como fallback
legacy no destructivo.

