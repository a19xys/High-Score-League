# LOCAL-LAUNCHER-SHELL-DETAIL-HOTFIX-3

Hotfix tecnico y visual sobre `LOCAL-LAUNCHER-SHELL-DETAIL-POLISH-2`.

## Alcance

Este hotfix corrige:

- argumentos MAME finales para packs v2 con BGFX y `crt-geom`;
- reconciliacion de la seleccion activa tras reescanear biblioteca;
- favoritos optimistas con semantica de ultimo intento;
- detalle visual, metadata, titulo, chip de favorito y botones;
- ancho minimo real de ventana y sidebar.

No implementa importacion ZIP/TAR/GZIP, watcher, catalogo remoto,
instalacion/desinstalacion de packs, visor PDF, cambios de endpoint, payload,
Supabase, RLS, membership, scoped queue ni auto-sync.

## MAME v2 y BGFX

Cuando un pack v2 declara `mame.artworkPath`, el launcher compone `-artpath`
con dos entradas:

```text
<pack>/artwork;<mame>/artwork
```

El artwork del pack va primero para preservar recursos especificos del pack.
El artwork compartido de MAME queda despues para que layouts y recursos base,
como los usados por `crt-geom`, sigan disponibles.

Si los argumentos finales usan BGFX (`-video bgfx` o argumentos `-bgfx_*`) y el
pack no declara `-bgfx_path`, el launcher anade:

```text
-bgfx_path <mame>/bgfx
```

Si el pack declara explicitamente `-bgfx_path`, se respeta y no se duplica.
Practica no hereda el perfil competitivo si `crt-geom` vive solo en
`mame.profiles.competition`.

## Reescaneo

`rescanPackDirectory` ya no deja selecciones sinteticas obsoletas:

- si un duplicado seleccionado desaparece, se limpia el detalle de duplicado;
- si el duplicado sigue existiendo, se actualizan sus rutas;
- si un duplicado queda resuelto a una sola carpeta, se activa ese pack real;
- si un pack con error se corrige, el detalle pasa a pack abierto valido.

La reconciliacion solo actua sobre estado local de biblioteca. No mueve ni borra
packs.

## Favoritos

El boton de favorito permanece clicable durante una peticion pendiente. La UI
pinta el cambio inmediatamente y sincroniza hasta alcanzar la ultima intencion
del usuario. Si una respuesta antigua falla despues de que exista una intencion
mas reciente, se ignora como stale. Si falla la ultima, se vuelve al ultimo
valor confirmado.

Los duplicados siguen bloqueando favorito porque el `packId` no es una identidad
local segura mientras haya conflicto.

## Detalle y shell

La ventana minima de Electron vuelve a `1180x620`. La biblioteca queda entre
`340px` y `600px`, con valor por defecto `440px`.

La shell mantiene siempre:

```text
biblioteca | resizer | detalle
```

No hay breakpoint que apile la biblioteca encima del detalle.

El detalle limita su anchura a `1280px`, mantiene `overflow-x: hidden`, usa
container query para metadata estrecha y fuerza un bloque final de CSS para que
el hotfix gane la cascada.

Metadata principal:

```text
Desarrollador | Ano
Genero        | Tiempo jugado
```

En ancho estrecho:

```text
Desarrollador
Genero
Ano | Tiempo jugado
```

Los iconos de metadata se ocultan en estrecho para evitar recortes.

## Validacion

Validado con:

```text
npm.cmd --prefix local/hsl-local-app test
```

Tambien deben ejecutarse antes de cerrar la tarea:

```text
git diff --check
git status --short
```
