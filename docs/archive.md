# Archivo unificado y paginación de envíos

## Archivo público de la liga

La navegación autenticada reúne el historial de la liga bajo un único acceso
`ARCHIVO`. La URL canónica es `/archive` y muestra `Semanas` de forma
predeterminada. `Temporadas` usa `/archive?section=seasons`.

La selección pertenece a la URL y se valida en servidor. Solo se aceptan
`weeks` y `seasons`; una sección ausente, `section=weeks`, un array o cualquier
valor inesperado cae de forma segura en `weeks`. Los enlaces reales del selector
permiten recargar, copiar la dirección y usar Atrás/Adelante sin depender de
estado React ni de hashes.

La página consulta únicamente los datos de la sección activa y reutiliza las
tablas existentes con sus filtros, orden, avisos y estados vacíos. Sus títulos
de documento son `Semanas | Archivo | High Score League` y
`Temporadas | Archivo | High Score League`.

Compatibilidad:

- `/weeks` redirige permanentemente a `/archive`;
- `/seasons` y la ruta legacy `/season` redirigen permanentemente a
  `/archive?section=seasons`;
- `/weeks/[weekId]` y `/seasons/[seasonId]` conservan sus URLs;
- las rutas `/admin/weeks`, `/admin/seasons`, APIs y enlaces del launcher no
  cambian.

En los detalles históricos, `ARCHIVO` aparece activo. La semana activa mantiene
la prioridad de `LEADERBOARD` y la temporada activa conserva la de
`CLASIFICACIÓN`.

## Paginación de historiales de envíos

`SubmissionsTable` pagina todas sus instancias de forma compartida. Muestra 20
filas inicialmente y permite seleccionar 50 o 100; 100 es el máximo disponible
en la interfaz. El control se oculta cuando hay 20 envíos o menos.

El orden de procesamiento es deliberado:

1. submissions originales;
2. decoración del conjunto completo;
3. numeración global de intentos;
4. cálculo global de mejores intentos y visibilidad;
5. orden global seleccionado;
6. ajuste de página y paginación;
7. render del segmento visible.

Cambiar el orden o el tamaño vuelve a la página 1. Si cambian los datos, la
página se limita a la última que siga existiendo. Anterior y Siguiente son
botones nativos deshabilitados en los extremos, el selector tiene etiqueta
visible y el resumen anuncia el intervalo `X–Y de Z`.

El perfil propio entrega todos los envíos válidos ya cargados a la tabla, sin el
antiguo corte de ocho filas. El perfil público continúa recibiendo un array
privado vacío y nunca renderiza esta tabla.

## Alcance y evolución

La paginación es cliente/presentación: no añade consultas, no cambia RLS y no
altera leaderboards, scoring, ingest ni resultados oficiales. Esta decisión
mantiene correctos el número de intento, el mejor intento y las reglas de scores
ocultos sobre el conjunto completo.

`SUBMISSIONS-SERVER-PAGINATION-1` queda como tarea futura cuando el volumen haga
costoso cargar todo el historial. Deberá diseñar consultas paginadas, conteo
total, índices, RPC o vistas y cálculos globales de intento/mejor score, además
de separar los datos del leaderboard de las filas del historial.
