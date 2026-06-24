# Plan de deprecación legacy

No se promete fecha de eliminación. Ningún elemento se elimina hasta que su
reemplazo cubra práctica, competición, catálogo/instalador y desarrollo.

| Elemento legacy | Dónde vive | Por qué sigue existiendo | Reemplazo | Condición para eliminarlo | Tarea futura |
| --- | --- | --- | --- | --- | --- |
| `packVersion: 1` | `pack-contract.js`, ejemplos y tests | Packs antiguos y dev bridge aún dependen de MAME pack-local | `packVersion: 2` + MAME compartido | Competición v2 segura, catálogo/instalador v2 y dev bridge migrado | `LOCAL-REMOVE-PACK-V1-LEGACY` |
| `mame.relativeExecutablePath` | Contrato v1 y ejemplos | Resuelve `mame.exe` dentro del pack antiguo | Runtime MAME compartido | No quedan packs ni herramientas que lo lean | `LOCAL-REMOVE-PACK-V1-LEGACY` |
| `mame.workingDir` | Contrato v1, launcher y dev bridge | MAME/plugin v1 necesitan una raíz pack-local | Runtime compartido + recursos relativos v2 | Plugin/adaptador v2 aislado y dev bridge migrado | `LOCAL-REMOVE-PACK-V1-LEGACY` |
| `resolvePackMamePaths` | `src/pack.js` | Adaptador de compatibilidad entre v1 y configuración efectiva | Resolución directa de runtime v2 | Todos los callers usan solo runtime compartido | `LOCAL-REMOVE-PACK-V1-LEGACY` |
| `sync-plugin` | CLI, service y `dev-sync-plugin.js` | Sincroniza el plugin del repo al pack de desarrollo actual | Preparación automática del plugin global/adaptador v2 | Carga v2 estable y dev bridge retirado | `LOCAL-MAME-PACK-PLUGIN-LOADING-2` |
| `locations.json` | `src/library-locations.js` y fallback de `pack-directory.js` | Migra sin borrar configuraciones antiguas | `pack-directory.json` único | Telemetría/soporte confirma que no quedan instalaciones ambiguas | `LOCAL-REMOVE-LIBRARY-LOCATIONS-LEGACY` |
| Dev bridge temporal | `config.json`, diagnose y launcher service | Permite probar el flujo end-to-end con el pack externo actual | Launcher instalado + packs v2 | Runtime/captura v2 y catálogo/instalador cubren desarrollo | `LOCAL-REMOVE-DEV-BRIDGE` |
| MAME embebido en pack | Packs v1 y ejemplos antiguos | Compatibilidad con packs ya creados | MAME compartido | Ningún pack soportado depende de binarios pack-local | `LOCAL-REMOVE-PACK-V1-LEGACY` |

