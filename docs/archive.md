# Archivo canónico y paginación de envíos

## Archivo público de la liga

La navegación autenticada reúne el historial bajo un único acceso `ARCHIVO` y
dos rutas canónicas independientes:

- `/archive/weeks`: Semanas;
- `/archive/seasons`: Temporadas.

Cada página consulta únicamente los datos de su sección y reutiliza las tablas,
filtros, orden, avisos y estados vacíos existentes. El selector usa enlaces
reales, de modo que recarga, URLs copiadas y Atrás/Adelante funcionan sin estado
React ni parámetros de consulta.

Compatibilidad mediante redirecciones permanentes:

- `/archive` y `/weeks` → `/archive/weeks`;
- `/seasons` y `/season` → `/archive/seasons`;
- `/archive?section=seasons` → `/archive/seasons`;
- `/archive?section=weeks` o un valor desconocido → `/archive/weeks`.

Los detalles conservan `/weeks/[weekId]` y `/seasons/[seasonId]`. En ellos,
`ARCHIVO` aparece activo, salvo que la semana activa deba dar prioridad a
`LEADERBOARD` o la temporada activa a `CLASIFICACIÓN`.

## Breadcrumbs

Las páginas internas usan un componente compartido con `nav`, lista ordenada,
enlaces reales y `aria-current="page"` en el último elemento. Las migas siempre
empiezan por `Liga` (`/`), permiten varias líneas y no fuerzan overflow
horizontal. Home no muestra breadcrumbs.

Jerarquías públicas:

- archivo: `Liga / Archivo / Semanas|Temporadas`;
- temporada: `Liga / Archivo / Temporadas / [temporada]`;
- semana: `Liga / Archivo / Temporadas / [temporada] / [juego o semana]`;
- perfil público: `Liga / Jugadores / @[username]`;
- perfil propio: `Liga / Mi perfil`.

Las pantallas admin, de autenticación y diagnóstico siguen la misma convención
con una jerarquía útil. Los enlaces “Volver” solo permanecen cuando son una
acción real y no navegación estructural duplicada.

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
se limita a la última existente. Anterior y Siguiente son botones nativos
deshabilitados en los extremos; el selector tiene etiqueta visible y el resumen
anuncia `X–Y de Z`.

La columna se llama siempre `Intentos` y su control accesible es `Ordenar por
intentos`. Las identidades usan `PlayerPill variant="submission"`: avatar o
siglas de 28 px sin repetir username, manteniendo enlace, hover card, foco y
nombre accesible. El resto de celdas y el espaciado vertical también se
compactan sin alterar semántica.

El perfil propio entrega todos los envíos válidos ya cargados, sin el antiguo
corte de ocho filas. El perfil público no recibe ni renderiza ese historial
privado.

## Alcance y evolución

La paginación continúa siendo cliente/presentación: no añade consultas, no
cambia RLS y no altera leaderboards, scoring, ingest ni resultados oficiales.
Esto mantiene correctos el número de intento, el mejor intento y las reglas de
scores ocultos sobre el conjunto completo.

`SUBMISSIONS-SERVER-PAGINATION-1` queda como tarea futura cuando el volumen haga
costoso cargar todo el historial. Deberá diseñar consultas paginadas, conteo
total, índices, RPC o vistas y cálculos globales de intento/mejor score, además
de separar los datos del leaderboard de las filas del historial.
