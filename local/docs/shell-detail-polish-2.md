# LOCAL-LAUNCHER-SHELL-DETAIL-POLISH-2

Pulido visual intermedio de la shell y del detalle del launcher local.

## Alcance

Esta tarea corrige composicion, uso de espacio y responsive del renderer. No
cambia MAME, runtime compartido, plugin `hsl-score`, payloads, endpoints,
Supabase, RLS, membership, scoped queue, auto-sync, catalogo, watcher ni
importacion de packs.

## Shell

La app mantiene siempre biblioteca izquierda, resizer y detalle derecho en la
misma fila. No hay breakpoint que apile la biblioteca encima del detalle.

La ventana puede bajar a:

```text
minWidth: 920
minHeight: 620
```

La biblioteca queda ajustable entre `280px` y `520px`, con valor por defecto
`380px`. Cuando el usuario estrecha la biblioteca, el detalle gana aire, pero
el detalle conserva un maximo visual para que el hero no se vuelva gigante.

En fullscreen, la shell usa un ancho maximo mayor (`1760px`) para no sentirse
encogida en pantallas grandes. El detalle se limita a `1120px`, centrado, para
evitar el problema anterior de estiramiento infinito.

El fondo situado a la izquierda de la biblioteca se extiende con el mismo tono
de la sidebar para evitar el corte visual entre margen y panel izquierdo.

## Header

El icono HSL del header deja de estar dentro de una caja azul: el SVG queda
como marca independiente. La foto/avatar del chip de cuenta sube a `38px` para
igualar la escala visual de los botones de tema/configuracion.

## Detalle

El detalle se acerca al revamp:

- hero contenido con `aspect-ratio: 1920 / 620` y `max-height: 340px`;
- titulo y etiqueta de semana alineados en la misma linea;
- subtitulo local redundante fuera de la primera capa;
- descripcion colocada antes de metadata;
- metadata como bloque horizontal limpio, sin cuatro tarjetas pesadas;
- metadata en una fila de cuatro cuando hay espacio y 2x2 en estrecho;
- desarrolladores/publishers y generos se separan con ` · `.

## Acciones

`Jugar` y `Practicar` son acciones principales y mantienen mayor altura.
`Manual` y `Ranking` quedan mas bajos como acciones secundarias.

Icono y texto se centran en cada boton con `line-height` y `overflow` ajustados
para evitar recortes en letras como `G` o en `Ranking`.

## Validacion

Los tests de renderer protegen:

- ausencia de apilado de `.app-main` en el breakpoint principal;
- ancho maximo de shell y detalle;
- continuidad de fondo a la izquierda de la biblioteca;
- icono HSL sin caja;
- avatar de cuenta a escala de boton;
- descripcion antes de metadata;
- metadata 4 columnas con fallback 2x2;
- jerarquia entre acciones principales y secundarias.
