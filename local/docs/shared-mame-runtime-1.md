# LOCAL-SHARED-MAME-RUNTIME-1

Primera capa real de runtime MAME compartido para packs `packVersion: 2`.

## Que implementa

La app local puede guardar una ruta global de `mame.exe`, leerla desde
`userData`, diagnosticar si existe y usarla para construir lanzamientos basicos
de practica con packs v2.

No descarga, instala ni actualiza MAME. El jugador o el instalador futuro deben
proveer el ejecutable.

## Persistencia

La ruta se guarda en:

```text
userData/runtime/mame-runtime.json
```

Formato:

```json
{
  "schemaVersion": 1,
  "mameExecutablePath": "C:/Program Files/High Score League/runtime/mame/mame.exe",
  "selectedAt": "2026-06-20T00:00:00.000Z",
  "updatedAt": "2026-06-20T00:00:00.000Z"
}
```

No guarda tokens, sesiones, cuentas, ROMs ni configuracion de usuario sensible.

## Estados

- No configurado: no existe `mame-runtime.json` o no hay ruta.
- Configurado no disponible: hay ruta, pero no existe o no es archivo.
- Disponible: la ruta existe y es archivo.

Si el archivo no se llama `mame.exe` o `mame`, se devuelve warning para revisar
la ruta, pero no se bloquea automaticamente si existe como archivo.

La deteccion de version queda preparada como campo `version`, pero no es
obligatoria en esta tarea.

## GUI

La GUI expone en herramientas de desarrollo:

- `Elegir mame.exe` / `Cambiar MAME`;
- `Abrir carpeta MAME`;
- estado configurado/no configurado;
- si `mame.exe` esta disponible;
- ruta completa en detalles tecnicos.

El runtime no domina la primera capa salvo que el pack activo sea v2 y falte
para practicar.

## Pack v2

Para packs v2, el launcher resuelve:

```text
runtime MAME compartido
+ packRoot
+ contract.mame.romDir
+ contract.mame.artworkDir
+ contract.mame.sampleDir
+ contract.mame.cfgDir
+ contract.mame.launchArgs
```

Argumentos basicos:

```text
mame.exe <rom>
  -rompath <pack>/roms
  -artpath <pack>/artwork
  -samplepath <pack>/samples
  -cfg_directory <pack>/cfg
  <launchArgs>
```

`-artpath`, `-samplepath`, `-cfg_directory` y `launchArgs` solo se anaden si el
pack los declara. Los nombres de flags quedan pendientes de validacion final
con MAME real antes de cerrar empaquetado.

## Practica y competicion

Practica v2 queda disponible cuando:

- el runtime compartido esta configurado y disponible;
- el pack v2 tiene ROM;
- `mame.romPath` esta normalizado a un directorio existente.

Competicion v2 sigue bloqueada porque requiere carga segura de plugin/adaptador
de captura. Esa parte queda para:

```text
LOCAL-MAME-PACK-PLUGIN-LOADING-1
```

## Compatibilidad v1

`packVersion: 1` no cambia en esta tarea. Sigue usando MAME embebido o
pack-local mediante `mame.relativeExecutablePath` y `mame.workingDir`, marcado
como legacy/deprecated.

`sync-plugin` y `resolvePackMamePaths` siguen existiendo solo para el dev bridge
y packs v1 mientras no se complete la migracion.

## Lo que no implementa

- descarga de MAME;
- instalador real;
- updates de MAME;
- catalogo remoto;
- descarga o instalacion de packs;
- plugin/adaptador competitivo v2 definitivo;
- eliminacion de v1;
- cambios en scoped queue, payload, duplicateKey, endpoint, membership, RLS o
  plugin MAME.
