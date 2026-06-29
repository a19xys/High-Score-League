# LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3

Refinamiento visual de la barra lateral de biblioteca.

## Reglas Universales

- Los controles superiores son compactos y estables.
- La lista de juegos ocupa el espacio util y scrollea dentro de la biblioteca.
- Cada vista tiene una composicion propia.
- Las proporciones mandan sobre el relleno.
- Al redimensionar la sidebar cambian columnas y huecos, no se deforman las
  piezas.

Aspect ratios obligatorios:

```text
Portadas: 2 / 3
Iconos: 1 / 1
Lista: fila horizontal compacta con altura controlada
```

## Portadas

`Portadas` usa columnas acotadas y centradas. La portada mantiene `aspect-ratio:
2 / 3`, el titulo y subtitulo quedan debajo, y los badges de estado se reducen
para no dominar la caratula. El pack activo se marca por borde/glow.

## Lista

`Lista` queda como fila compacta: estrella a la izquierda, miniatura cuadrada,
texto principal/subtitulo en el centro y estado pequeno a la derecha. No hay
boton `Activo`, UUIDs ni rutas.

## Iconos

`Iconos` usa tile estable de 128px con `aspect-ratio: 1 / 1`, estrella arriba
izquierda, punto de estado arriba derecha, imagen/placeholder centrado y nombre
de hasta dos lineas. El grid usa columnas fijas por tile, no `1fr`.

## Filtros Y Favoritos

La subtarjeta `Más filtros` queda mas compacta y el buscador usa placeholder:

```text
Escribe aquí...
```

Cerrar filtros no borra busqueda ni temporada.

La estrella de favorito queda centrada dentro del circulo. Activa, hover y foco
usan azul circuito, no amarillo. La persistencia de favoritos scoped no cambia.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, competicion v2,
cuenta, footer, panel derecho ni `config.json`.

## Pendiente

- Validacion visual manual en mas tamaños reales de ventana y con bibliotecas
  de muchos packs.

## Continuidad LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4

El refinamiento responsive posterior ancla grupos y packs arriba, usa container
queries por ancho de sidebar y define comportamiento por vista: Portadas cambia
de dos columnas a una manteniendo 2/3, Lista queda compacta e Iconos mantiene
tile fijo 1/1. Sin sesion, favoritos y actividad local quedan deshabilitados en
la UI normal.

## Continuidad LOCAL-LAUNCHER-LIBRARY-BREAKPOINT-POLISH-5

El breakpoint comun de biblioteca queda en 340px: en ese punto `Portadas` pasa
a una columna y los botones de vista pasan a solo icono. La sidebar minima baja
a 320px e `Iconos` conserva tile fijo. El valor vigente es 128px tras
`LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7`.
