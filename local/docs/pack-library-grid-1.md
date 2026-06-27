# LOCAL-PACK-LIBRARY-GRID-1

Vista visual inicial para la biblioteca local de packs.

## Objetivo

La biblioteca deja de ser una lista basica de rutas y pasa a mostrar cards de
packs detectados. Esta tarea mejora la seleccion visual, el estado local y los
empty states sin hacer el revamp completo de la app.

La app local sigue siendo:

```text
biblioteca local de packs
+
launcher de competicion
```

No se convierte en una segunda web y no asume responsabilidades de temporadas,
rankings, descarga de packs ni administracion.

Direccion final tras `LOCAL-SHARED-MAME-RUNTIME-BLUEPRINT-1`: el grid debe
mostrar packs ligeros instalados en el directorio unico de packs. MAME no forma
parte de cada card ni de cada pack; el runtime compartido se diagnostica aparte
y solo se combina con el pack activo al jugar o calcular readiness completa.

## Cards de packs

Cada pack detectado en el directorio unico de packs se muestra como una card con:

- imagen local `cover`, `icon` o `logo` si existe;
- placeholder visual HSL si no hay assets;
- titulo;
- subtitulo;
- badges de estado;
- ROM y weekId como badges discretos;
- accion `Usar este pack`;
- badge `Activo` si coincide con el pack abierto.

Las rutas tecnicas no aparecen en la primera capa de la card. Siguen disponibles
solo en detalles tecnicos o diagnostico.

## Metadata y assets

La card reutiliza la salida de `scanPackLibrary`.

El titulo se resuelve antes del render con esta prioridad:

```text
metadata.title
packId
gameId
rom
```

El subtitulo usa:

```text
metadata.subtitle
Semana <weekId>
rom
```

Assets soportados:

```text
metadata.assets.cover
metadata.assets.icon
metadata.assets.logo
```

No se descargan assets, no se generan imagenes y no se bloquea el pack si faltan
imagenes.

## Fallback visual

Si no hay cover, icon ni logo, la card muestra un bloque local con marca HSL e
iniciales derivadas del titulo del pack. Este placeholder no depende de red ni
de archivos externos.

## Estados de card

Estados visibles:

- `Activo`: el pack ya esta abierto o coincide con el pack activo.
- `Listo`: pack valido sin warnings.
- `Con avisos`: pack valido con warnings, normalmente metadata/assets o
  `packVersion: 1` deprecated.
- `Requiere atencion`: pack invalido o pack activo bloqueado por readiness.
- `No disponible`: directorio o pack no accesible cuando aplique.

La readiness completa solo se muestra para el pack activo si ya existe en el
estado del launcher. No se calcula readiness para todos los packs.

Desde `LOCAL-PACK-CONTRACT-2`, la biblioteca puede detectar packs
`packVersion: 2` validos y mostrarlos como cards normales. Si el contrato v2 es
invalido, solo esa card queda en `Requiere atencion`; el escaneo de otros packs
continua. Los packs v1 siguen apareciendo, pero sus detalles tecnicos incluyen
el aviso legacy/deprecated.

El runtime MAME compartido no convierte un pack v2 valido en invalido. Si falta
MAME compartido, readiness del pack activo lo explica como runtime pendiente,
pero la biblioteca sigue mostrando el contrato del pack.

## Pack activo

La card activa se marca con:

- badge `Activo`;
- borde/acento visual;
- boton `Ya activo` deshabilitado.

La comparacion usa `packDir` frente a `bridge.packRoot` y, como fallback, la
identidad `packId` o `gameId` frente a `bridge.activePackName`.

## Directorio de packs

Desde `LOCAL-PACK-DIRECTORY-MODEL-1`, la seccion de biblioteca muestra un unico
directorio de packs:

- `Elegir directorio` si no hay directorio configurado;
- `Cambiar directorio`;
- `Abrir directorio`;
- `Reescanear`;
- aviso suave si el directorio no existe;
- aviso si la carpeta elegida parece ser un pack root.

No se borran carpetas reales ni packs. `locations.json` queda como fallback
legacy y solo aparece en detalles tecnicos.

## Empty states

Se anaden mensajes claros:

- sin directorio: invita a elegir el directorio de packs;
- directorio sin packs: explica que cada pack debe tener `pack.json` en una
  subcarpeta directa;
- carpeta de pack elegida por error: pide elegir la carpeta contenedora;
- pack invalido: muestra `Este pack necesita revision.`

No se muestra JSON ni rutas como primera capa.

## Integracion

`Usar este pack` sigue llamando a la accion existente `useLibraryPack`, que
activa el pack con el mismo flujo que `Abrir pack`, recuerda el ultimo pack,
recalcula estado, membership, readiness y puede activar auto-sync si ya era
seguro.

La biblioteca no depende de cuenta para escanear. Al activar un pack con cuenta
activa, el scope sigue siendo:

```text
cuenta activa + pack activo
```

No se mezclan colas y no se muestran colas de otras cuentas en las cards.

## Detalles tecnicos

`Herramientas de desarrollo > Detalles tecnicos` anade resumen de biblioteca:

- directorio configurado;
- si el directorio existe;
- si parece pack root;
- numero de packs detectados;
- packs invalidos;
- `locations.json` legacy detectado;
- warnings agregados.

No se muestran tokens ni sesiones completas.

## No implementado

Esta tarea no implementa:

- busqueda;
- filtros avanzados;
- descarga de packs;
- estados remotos de temporada para todos los packs;
- pack builder;
- instalador;
- revamp completo;
- membership para todos los packs;
- cambios en scoped queue;
- cambios en auto-sync, salvo refresco normal al activar pack;
- cambios en endpoint, payload o `duplicateKey`.

## Extensión por temporadas y vistas

La biblioteca ofrece agrupación por temporada, fallback `Sin temporada` y
grupo `Legacy / deprecated`. Se añadieron vistas de portadas, lista e iconos,
con búsqueda por metadata/identidad y filtros por temporada y estado.

## Actualizacion LOCAL-LAUNCHER-LIBRARY-CARDS-1

La biblioteca mantiene `Portadas`, `Lista` e `Iconos`, pero ya no muestra
`Legacy / deprecated` como grupo protagonista por defecto. Los packs legacy se
integran en su temporada o en `Sin temporada` y muestran badge discreto
`Legacy`.

Las cards ya no usan boton `Usar este pack`, `Seleccionar` ni `Activo`; la card
completa activa el pack si es seleccionable. El pack activo se marca con borde
y badge `Activa`. La estrella es funcional y guarda favoritos locales en
`userData/library/favorites.json`.
