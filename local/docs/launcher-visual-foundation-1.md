# LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

Limpieza inicial de la primera capa visual del launcher local.

## Objetivo

Esta fase acerca la GUI al mockup aprobado sin cambiar la arquitectura
funcional. El launcher queda más parecido a una app de escritorio: header
compacto, biblioteca visual a la izquierda, detalle del pack a la derecha,
acciones principales simples y actividad local resumida dentro del pack.

No se toca MAME, runtime, plugin, captura, payload, `duplicateKey`, endpoints,
RLS, membership, scoped queue, auto-sync, contratos de pack ni `config.json`.

## Header

El header deja de mostrar el eyebrow azul `HSL` como texto independiente. Ahora
usa un slot cuadrado de icono local junto a `High Score League Launcher`. Si no
hay icono final, el slot muestra un placeholder `HSL`.

Los controles superiores quedan como píldoras compactas:

- estado de conexión: `Conectado`, `Sin Internet` o `Reconectando`;
- tema con estructura preparada para icono de sol/luna;
- cuenta compacta con el menú existente.

El botón de refresco sale de la primera capa. La acción interna de refresco no
se elimina.

## Detalle Del Pack

La tarjeta principal queda ordenada así:

- hero o placeholder elegante;
- logo si el pack lo aporta;
- título;
- chip de semana;
- descripción corta;
- metadata compacta con slots de iconos para desarrollador, año, género y
  tiempo de juego;
- chips humanos de estado;
- botonera 2x2;
- actividad local compacta como subtarjeta.

La primera capa deja de mostrar UUID, `weekId`, rutas, `packId`, HTTP/body,
`packVersion` largo y estados técnicos como `PACK ABIERTO`, `ÚLTIMO PACK
CARGADO`, `COLA CUENTA + PACK`, `Listo para competir` o `Sincronización
automática lista`.

## Botonera

La botonera principal contiene solo:

```text
Jugar
Practicar
Manual
Ranking
```

`Jugar` es la acción primaria con acento fuerte. Las otras tres acciones son
secundarias. Las descripciones largas bajo cada botón desaparecen y quedan
slots de icono por acción.

`Comprobar de nuevo` se mueve a opciones avanzadas. La comprobación interna de
membership sigue existiendo.

## Actividad Local

La actividad local deja de ser una tarjeta externa grande en la primera capa y
pasa a vivir dentro del detalle del pack.

Estados visibles:

```text
Sincronizado
Todo al día, sin puntuaciones pendientes.

Pendiente de sincronizar
Quedan puntuaciones por subir.

Requiere atención
Hay puntuaciones con error.
```

`Ver detalles >` sigue abriendo el drawer de actividad. El drawer conserva
totales, pendientes, enviadas, `Puntuaciones con error`, restauración de failed
y `Subir pendientes`.

## Opciones Avanzadas

La tarjeta visible de `Opciones avanzadas` sale de la primera capa. El drawer
avanzado sigue existiendo y se abre con:

```text
Ctrl+Shift+D
```

Ahí siguen diagnóstico, runtime MAME compartido, directorio de packs,
`Comprobar de nuevo`, apertura de temporada, detalles técnicos, colas,
readiness, membership y `sync-plugin` legacy.

## Biblioteca

La columna izquierda se ensancha y se compacta:

- cabecera `Biblioteca` con contador `1 pack`;
- sin eyebrow `Juegos instalados`;
- sin explicación larga;
- sin tarjeta `1 juegos instalados`;
- sin botón `Reescanear` como acción protagonista;
- búsqueda más compacta;
- filtro de temporada conservado;
- filtro `Estado` fuera de la primera capa;
- vistas visibles `Portadas`, `Lista` e `Iconos`;
- sin `Vista de logos`.

`Reescanear`, `Cambiar directorio` y `Abrir directorio` siguen accesibles en
`Gestionar biblioteca`.

## Slots De Iconos

Quedan clases/slots preparados para:

- tema;
- jugar, practicar, manual y ranking;
- desarrollador, año, género y tiempo de juego;
- temporada/semana;
- actividad sincronizada, pendiente y con error;
- portadas, lista e iconos;
- favorito estrella sin persistencia.

No se descargan iconos ni se añaden dependencias.

## Pendiente

- `Game Detail Polish`: refinar hero, logo, estados y composición final del
  detalle.
- Pulido del drawer de actividad y del drawer avanzado.

## Validación

Se añadieron/actualizaron tests para proteger ausencia de ruido técnico en la
primera capa, estructura del header, botonera 2x2, actividad compacta,
biblioteca limpia, acceso avanzado por shortcut y ausencia de secretos.

## Continuidad LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1

`Game Detail Polish` queda aplicado sobre esta base: el detalle del pack usa un
banner horizontal contenido, logo/titulo/semana, chips humanos acotados,
metadata con etiqueta y valor, descripcion local solo si existe, botonera 2x2 y
actividad local integrada.

Siguen pendientes tareas posteriores de favoritos avanzados y pulido de
drawers.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CARDS-1

`Library Cards` queda aplicado: las vistas `Portadas`, `Lista` e `Iconos` son
distintas, la card completa activa el pack, el boton `Activo` desaparece, la
estrella guarda favorito local y la sidebar permite ajustar anchura dentro de
limites seguros.

## Continuidad LOCAL-LAUNCHER-FAVORITES-SCOPED-2

Los favoritos locales quedan separados por cuenta activa con fallback anonimo
sin sesion. El archivo global antiguo no se migra automaticamente a cuentas.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2

Los controles de biblioteca quedan compactos: contador en pildora, `Más
filtros`, `Cambiar directorio` y vistas `Portadas`/`Lista`/`Iconos`. Busqueda y
temporada pasan a subtarjeta plegable, la lista de juegos gana scroll propio y
la vista `Iconos` mantiene tiles consistentes con punto de estado.

## Continuidad LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3

La barra lateral queda refinada por composicion: caratulas 2/3, lista compacta,
tiles de iconos 1/1 de 92px, filtros mas bajos, placeholder `Escribe aquí...` y
favoritos centrados con azul circuito.

## Continuidad LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4

La biblioteca queda anclada arriba y responde al ancho de sidebar por vista.
Sin sesion, los favoritos no son editables y Actividad local muestra un estado
neutro de inicio de sesion en lugar de una cola vacia.

## Continuidad LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

`Account Menu Polish` queda aplicado: el menu de cuenta usa una lista compacta
`Cuentas`, filas completas para cambiar, check de cuenta activa, boton de
olvidar por icono, login compacto y estado sin cuenta sin iniciales inventadas.
La primera capa ya no muestra textos largos de seguridad ni botones
administrativos `Cambiar`/`Quitar`.

## Continuidad LOCAL-LAUNCHER-ICON-SYSTEM-1

`Icon System` queda aplicado como base tecnica: los slots de header, botonera,
metadata, actividad, biblioteca, favoritos y cuenta llaman a `renderIcon()` y
buscan SVG locales en `gui/renderer/assets/icons/`. Si falta un SVG, se muestra
fallback discreto.
