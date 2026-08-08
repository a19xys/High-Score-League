# Archivo canónico y paginación de envíos

## Archivo de la liga

La navegación autenticada reúne el historial bajo un único acceso `ARCHIVO`.
`/archive` es una landing privada y ligera: no consulta semanas ni temporadas y
ofrece dos tarjetas grandes para elegir sección:

- `/archive/weeks`: Semanas;
- `/archive/seasons`: Temporadas.

Cada subpágina consulta únicamente sus propios datos y conserva tabs secundarios
con enlaces reales. Las URLs copiadas, la recarga y Atrás/Adelante funcionan sin
estado React ni parámetros de consulta.

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
control se oculta cuando hay 10 envíos o menos.

El orden de procesamiento es deliberado:

1. submissions originales;
2. decoración del conjunto completo;
3. numeración global de intentos;
4. cálculo global de mejores intentos y visibilidad;
5. orden global seleccionado;
6. ajuste de página y paginación;
7. render del segmento visible.

Cambiar el orden o el tamaño vuelve a página 1. Si cambian los datos, la página
se limita a la última existente. En móvil sólo se muestran los botones anterior
y siguiente y el rango centrado (`1–10 de 39`) en una cuadrícula
`44px / 1fr / 44px`. En escritorio se muestra `1–10 de 39`, el selector
`[10] por página` y `[‹] 1 / 4 [›]`.

El texto completo para lectores de pantalla anuncia “Mostrando elementos X a Y
de Z” y “Página X de Y” en una única región viva. El selector conserva la
etiqueta accesible “Envíos por página” y los botones tienen nombres explícitos.

La columna se llama siempre `Intentos` y su control accesible es `Ordenar por
intentos`. El perfil propio entrega todos los envíos válidos ya cargados, sin el
antiguo corte de ocho filas. El perfil público no recibe ni renderiza ese
historial privado.

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
