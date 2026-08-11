# Archivo canónico y paginación de envíos

## Archivo de la liga

La navegación autenticada reúne el historial bajo un único workspace. El
servidor de `/archive` carga Semanas y Temporadas en paralelo y entrega ambos
paneles montados a un selector cliente. Los estados canónicos son:

- `/archive#weeks`: Semanas, estado inicial y destino de `ARCHIVO`;
- `/archive#seasons`: Temporadas.

Cambiar de pestaña usa `history.replaceState`: no navega con Next, no hace una
consulta nueva y conserva el estado local de ambos paneles. `/archive` no es una
tercera vista neutral: muestra Semanas desde el primer render y el cliente
normaliza el hash ausente o desconocido a `#weeks` sin añadir historial.

Compatibilidad mediante redirecciones permanentes:

- `/archive/weeks` y `/weeks` → `/archive#weeks`;
- `/archive/seasons`, `/seasons` y `/season` → `/archive#seasons`;
- `/archive?section=weeks` → `/archive#weeks`;
- `/archive?section=seasons` → `/archive#seasons`;
- un `section` desconocido → `/archive#weeks`.

Los detalles conservan `/weeks/[weekId]` y `/seasons/[seasonId]`. En ellos,
`ARCHIVO` aparece activo, salvo que la semana activa deba dar prioridad a
`LEADERBOARD` o la temporada activa a `CLASIFICACIÓN`.

## Filtro por año

Semanas y temporadas filtran por año en lugar de estado. Las columnas, badges y
ordenación por estado no cambian. Las opciones se derivan de los intervalos
visibles y se ordenan de más reciente a más antiguo, sin años hardcodeados.

Un intervalo pertenece a todos los años naturales que cruza según
`Europe/Madrid`; por ejemplo, del 28 de diciembre de 2025 al 3 de enero de 2026
pertenece a 2025 y 2026. Los intervalos activos se recortan a la fecha actual
para no anunciar años futuros. Los intervalos completados conservan todo su
rango. Las semanas secretas o futuras y las temporadas borrador no generan
opciones públicas.

El año se combina con la búsqueda, temporada, editor, género y líder existentes.

## Breadcrumbs

Las páginas internas usan un componente compartido con `nav`, lista ordenada,
enlaces reales y `aria-current="page"` en el último elemento. Las migas siempre
empiezan por `Liga` (`/`), permiten varias líneas y no fuerzan overflow
horizontal. Home no muestra breadcrumbs.

Jerarquías públicas:

- archivo semanal: `Liga / Semanas`;
- archivo de temporadas: `Liga / Temporadas`;
- temporada: `Liga / Temporadas / [temporada]`;
- semana: `Liga / Semanas / [juego o semana]`;
- perfil público: `Liga / Jugadores / @[username]`;
- perfil propio: `Liga / Mi perfil`.

`Semanas` enlaza a `/archive#weeks` y `Temporadas` a `/archive#seasons`.

La tabla “Calendario · Semanas incluidas” de una temporada conserva sus cinco
columnas en escritorio. En móvil usa el mismo dataset y componente con tres
columnas: Semana incorpora la fecha, Juego incorpora un badge compacto de
estado y Acción muestra `Ver` o una indisponibilidad compacta. El layout fijo y
el truncado evitan overflow horizontal desde 320 px.

## Paginación compacta de submissions

`SubmissionsTable` pagina todas sus instancias de forma compartida. Muestra 10
filas inicialmente y permite seleccionar 25 o 50; 50 es el máximo expuesto. El
footer se oculta cuando hay 10 envíos o menos.

El orden de procesamiento es deliberado:

1. submissions originales;
2. decoración del conjunto completo;
3. numeración global de intentos;
4. cálculo global de mejores intentos y visibilidad;
5. orden global seleccionado;
6. ajuste de página y paginación;
7. render del segmento real;
8. render de slots vacíos puramente presentacionales.

Cambiar el orden o el tamaño vuelve a página 1. Si cambian los datos, la página
se limita a la última existente. En móvil sólo se muestran los botones anterior
y siguiente y el rango centrado (`1–10 de 24`) en una cuadrícula
`44px / 1fr / 44px`.

En escritorio se usa una cuadrícula `1fr / auto / 1fr`: navegación
`[‹] 1–10 de 24 [›]` en el centro geométrico y selector `[10] por página`
alineado al extremo derecho. No se muestra ningún indicador `1 / 3`.

El resumen para lectores de pantalla anuncia el rango real y la página. El
selector conserva la etiqueta accesible “Envíos por página” y los botones tienen
nombres explícitos.

Cuando existe al menos un submission, la tabla completa la página elegida con
filas vacías después del corte real. Así, 24/10 termina en 4 filas reales y 6
vacías; 39/25, en 14 y 11; y 4/10 muestra 4 y 6 sin footer. Con cero submissions
se mantiene el `EmptyState` y no se crean filas. Estos slots son filas con
`aria-hidden="true"`, sin contenido ni interacción, y no entran en ningún array
de dominio, conteo, orden, intento, score o regla de visibilidad.

Las filas reales y los slots usan un único contrato de altura por variante. La
variante con identidad de semana y juego reserva dos líneas y es ligeramente más
alta; la variante compacta usa una sola línea. El contenido real está truncado,
contenido en altura y no puede ensanchar ni estirar una fila individual. Por
tanto, una página llena y una página completada con slots conservan exactamente
la misma altura de body.

La tabla usa `table-layout: fixed`. Su `colgroup` sólo contiene los tracks que
siempre participan en móvil: Semana cuando corresponde, Intentos y Score. No
existe un `<col>` de fecha a anchura cero; la celda de fecha queda fuera del
formato de tabla hasta la container query de 42 rem y entonces adopta un ancho
explícito de 9,5 rem. Así WebKit móvil no puede reservar una columna fantasma.
Los textos y números largos se truncan —los scores usan cifras tabulares— sin
mover otra columna y no hay mediciones responsive en JavaScript.

El área concreta de tabla y paginación usa `overflow-anchor: none`. Junto con el
contrato idéntico de diez filas reales o completadas evita que el scroll
anchoring móvil reajuste el viewport al cambiar de página, sin usar
`window.scrollTo` ni desactivar el anclaje global.

La columna se llama siempre `Intentos` y su control accesible es `Ordenar por
intentos`. El perfil propio entrega todos los envíos válidos ya cargados, sin el
antiguo corte de ocho filas. La vista `Envíos` permite filtrar por juego, elige
por defecto el de la submission más reciente, ordena las opciones por actividad
y ofrece `Todos los juegos`; cada cambio vuelve a la página 1. El perfil público
no recibe ni renderiza ese historial privado.

## Marca estática

La navegación solicita directamente `/brand/logo.png` y la landing
`/brand/logo-horizontal.png`. Ya no dependen de `process.cwd()` ni de
comprobaciones server-side del filesystem. El fallback textual se activa sólo
si el navegador recibe un error real al cargar la imagen y se reinicia si
cambia la fuente.

## Alcance y evolución

La paginación y los filtros continúan siendo cliente/presentación: no añaden
consultas, no cambian RLS y no alteran leaderboards, scoring, ingest ni resultados
oficiales.

`SUBMISSIONS-SERVER-PAGINATION-1` queda como tarea futura cuando el volumen haga
costoso cargar todo el historial. Deberá diseñar consultas paginadas, conteo
total, índices, RPC o vistas y cálculos globales de intento/mejor score.
