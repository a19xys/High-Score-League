# Archivo canónico y paginación de envíos

## Archivo de la liga

La navegación autenticada reúne el historial bajo `ARCHIVO`. Las tres rutas son
reales y comparten el mismo shell visual:

- `/archive`: shell neutral, sin sección seleccionada ni consulta de datos;
- `/archive/weeks`: Semanas seleccionada y contenido semanal;
- `/archive/seasons`: Temporadas seleccionada y contenido de temporadas.

La navegación superior lleva directamente a `/archive/weeks`. El breadcrumb
`Archivo` enlaza a `/archive`, que es la entrada deliberada al estado neutral.
El selector secundario sólo contiene Semanas y Temporadas; en la raíz ninguna
tiene `aria-current` ni estilo activo.

Compatibilidad mediante redirecciones permanentes:

- `/weeks` → `/archive/weeks`;
- `/seasons` y `/season` → `/archive/seasons`;
- `/archive?section=weeks` → `/archive/weeks`;
- `/archive?section=seasons` → `/archive/seasons`;
- un `section` desconocido → `/archive` sin el parámetro.

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

- raíz del archivo: `Liga / Archivo`;
- índices: `Liga / Archivo / Semanas|Temporadas`;
- temporada: `Liga / Archivo / Temporadas / [temporada]`;
- semana: `Liga / Archivo / Temporadas / [temporada] / [juego o semana]`;
- perfil público: `Liga / Jugadores / @[username]`;
- perfil propio: `Liga / Mi perfil`.

`Archivo` enlaza siempre a `/archive`.

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

La tabla usa `table-layout: fixed` y un `colgroup` compartido por header y body.
La identidad/semana ocupa el espacio flexible y las columnas de intentos, score
y fecha tienen anchos explícitos. El shell define un contenedor inline y las
container queries deciden, solo por el ancho disponible, cuándo mostrar la
identidad rica, el marcador de mejor intento y la fecha. Los textos y números
largos se truncan —los scores usan cifras tabulares— sin mover el origen de otra
columna. No hay mediciones ni estado responsive en JavaScript.

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
