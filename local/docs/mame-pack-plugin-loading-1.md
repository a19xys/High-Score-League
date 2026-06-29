# LOCAL-MAME-PACK-PLUGIN-LOADING-1

## Resultado

La competición de `packVersion: 2` permanece bloqueada de forma intencionada.
La auditoría confirmó que el plugin actual `hsl-score`:

- carga módulos propios desde `plugins/hsl-score`;
- contiene el adaptador de Space Invaders embebido en `games/invaders.lua`;
- solo lee configuración desde `config.lua`;
- no implementa todavía un contrato para cargar `capture.adapter` desde el pack activo.

Activar competición v2 solo porque existe `capture.adapter` habría sido un
falso positivo de seguridad.

## Mejoras implementadas

- El contrato v2 sigue rechazando rutas absolutas, URL, `file://` y `..`.
- Readiness separa `capture.mode`, `capture.pluginName`, existencia del
  adaptador y ausencia del cargador v2.
- Diagnose muestra esos mismos datos sin imprimir tokens.
- El bloqueo explica que práctica v2 ya usa MAME compartido.
- v1 conserva su flujo de plugin pack-local como legacy/deprecated.

## Siguiente tarea

`LOCAL-MAME-PACK-PLUGIN-LOADING-2` debe diseñar e implementar preparación
aislada por ejecución. Debe definir cómo el plugin global carga el adaptador,
cómo escribe en staging del scope activo y cómo evita mezclar dos packs.

`LOCAL-MAME-PACK-PLUGIN-LOADING-2` implementa esa preparacion aislada por
ejecucion. `userData/events` queda clasificado como file queue global
legacy/CLI, no como staging del pack activo v2.
