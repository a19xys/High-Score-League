# LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2

Reorganizacion de controles de biblioteca y estabilidad visual de la vista
`Iconos`.

## Aplicado

La cabecera de biblioteca queda como:

```text
Biblioteca                         [X packs]
```

La primera capa muestra solo:

```text
[Más filtros] [Cambiar directorio]
[Portadas] [Lista] [Iconos]
```

`Más filtros` abre y cierra una subtarjeta local con:

```text
Búsqueda general
Temporada
```

Cerrar la subtarjeta no borra la busqueda ni el filtro de temporada. El estado
abierto/cerrado no se persiste.

`Cambiar directorio` conserva el handler existente de seleccion de carpeta.
`Gestionar biblioteca`, `Abrir directorio`, `Reescanear` y el filtro `Estado`
salen de la primera capa.

## Lista Y Vistas

La lista de juegos tiene scroll vertical propio dentro de la biblioteca. La
cabecera y los controles permanecen arriba.

Las vistas oficiales siguen siendo:

```text
Portadas
Lista
Iconos
```

La vista `Iconos` queda refinada por
`LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3`: usa tiles de 92px con estrella,
punto de estado, visual cuadrado y nombre de hasta dos lineas. El cambio de
anchura de sidebar cambia columnas y huecos, no estira el tile.

El estado en `Iconos` se muestra como punto:

- verde para listo o activo;
- amarillo para avisos;
- rojo para errores;
- tenue para inactivo.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payload, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, instalacion,
competicion v2, configuracion, menu de cuenta, footer, metadata del panel
derecho ni persistencia de favoritos scoped.

## Pendiente

- Afinar visualmente la zona avanzada de directorio si se decide recuperar
  `Abrir directorio` o `Reescanear` fuera de primera capa.

## Continuidad LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3

El refinamiento posterior fija ratios obligatorios: `Portadas` 2/3, `Iconos`
1/1 y `Lista` como fila compacta. Tambien compacta `Más filtros`, cambia el
placeholder a `Escribe aquí...` y pasa la estrella activa/hover a azul circuito.
