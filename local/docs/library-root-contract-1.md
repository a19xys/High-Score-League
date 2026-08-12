# Contrato de raiz de biblioteca

## Estructura admitida

High Score League utiliza una unica raiz de instalacion. Cada pack es una subcarpeta directa:

```text
Biblioteca/
  Galaga/pack.json
  Pac-Man/pack.json
  Dig-Dug/pack.json
```

El escaner de produccion no busca packs recursivamente. Esta regla mantiene un destino inequivoco para importar, actualizar, diagnosticar y resolver duplicados.

## Clasificacion unica

`classifyLibraryRootCandidate` es la fuente de verdad compartida por seleccion, persistencia, escaneo y diagnostico:

- `valid-empty-root`: carpeta accesible sin packs directos y fuera de cualquier pack.
- `valid-populated-root`: uno o mas hijos directos contienen `pack.json`.
- `pack-root`: la carpeta elegida contiene `pack.json`.
- `inside-pack`: un ancestro cercano contiene `pack.json`.
- `missing`: la ruta no existe.
- `inaccessible`: no puede inspeccionarse con seguridad.
- `invalid-file`: la ruta existe, pero no es un directorio.
- `unsupported-layout`: solo hay packs a dos o mas niveles de profundidad.

La inspeccion de layout profundo es exclusivamente diagnostica. Esta limitada a cuatro niveles y 512 entradas, ignora `.hsl-import-*`, no sigue enlaces simbolicos y tolera errores de permisos. Nunca convierte esos packs en biblioteca funcional.

## Seleccion rechazada

Una clasificacion no valida devuelve `ok: false`, `classification`, `candidatePath`, `previousLibraryRoot` y, cuando procede, `suggestedRootPath`. No se escribe `pack-directory.json`, no se limpia la seleccion activa y no se presenta un mensaje de exito.

Para `pack-root`, el dialogo explica que se ha elegido un juego concreto. Para `inside-pack`, explica que se ha elegido una carpeta interna. Si el padre exacto del pack se clasifica de nuevo como raiz valida, se ofrece una accion explicita para utilizarlo. La aplicacion nunca asciende varios niveles ni cambia la ruta sin confirmacion.

`unsupported-layout` informa de que cada pack debe moverse a una subcarpeta directa. Los packs profundos no se cargan silenciosamente.

## Raiz vacia e importacion

Una carpeta genuinamente vacia es valida. Se persiste como `available-empty`, deja `activePack` en `null` y se convierte en el destino del importador. El importador sigue instalando cada pack como hijo directo mediante su staging seguro `.hsl-import-*`.

## Compatibilidad y diagnostico

Una ubicacion efectiva procedente de `locations.json` tambien se conserva cuando una nueva seleccion se rechaza. El rechazo no fuerza una migracion legacy.

Los estados persistidos antiguos que apunten a un pack, una carpeta interna o un layout profundo se reclasifican al leerlos. El escaner no los usa y el diagnostico ofrece una recomendacion especifica en lugar de tratar todos los casos como una unidad desconectada.

## Selector y diálogo de ubicación

El selector nativo obtiene `defaultPath` exclusivamente de la raíz canónica guardada en `pack-directory.json`. Esta consulta es local y mínima: no construye un launcher state, no escanea packs y no consulta Membership, Connectivity ni otras autoridades remotas. El pack activo, un pack externo de desarrollo, la última candidata rechazada, una ubicación de `locations.json` y una sugerencia todavía no aceptada no intervienen. Sin raíz canónica se omite `defaultPath`; si la raíz recordada está `missing` o `inaccessible`, continúa siendo el valor canónico que se entrega al sistema operativo.

La presentación usa una única familia de diálogo `library-location`. `rejected-candidate` explica `pack-root`, `inside-pack`, `unsupported-layout`, `missing`, `inaccessible` o `invalid-file`, conserva la raíz anterior y permite volver a elegir; solo ofrece la carpeta superior cuando el servicio ha validado `suggestedRootPath`. `current-root-unavailable` representa una raíz ya recordada y permite reintentarla, elegir otra o cerrar el aviso sin olvidarla.

Cancelar o rechazar no abre el lifecycle de un cambio de raíz, no invalida el contexto competitivo y no sustituye el catálogo visible. Solo aceptar explícitamente una raíz válida persiste el cambio y habilita un descubrimiento estructural local. `Importar pack` conserva su flujo independiente en Configuración.
