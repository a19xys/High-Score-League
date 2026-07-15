# LOCAL-WEB-RANKING-CAPABILITIES-1

La web decide por lotes si una semana canonica tiene ranking publico. Electron
no habilita el boton por la mera presencia de una URL en el pack.

## Politica web

La identidad es `weekId`; `requestKey` solo correlaciona el batch. El helper
compartido con la pagina de semana considera disponible una semana cuando:

- existen temporada, semana y juego;
- la temporada no es draft;
- no es una semana futura secreta;
- el estado derivado es `active`, `final_stretch`, `closed` o `published`.

`draft`, `scheduled`/inactiva, futura oculta, temporada draft, sin juego o no
encontrada son `unavailable`. No se exige que existan puntuaciones ni resultados
oficiales.

La ruta usa el cliente admin solo en servidor porque la RLS actual requiere
sesion para estas tablas. Selecciona las columnas minimas y solo devuelve
`available`/`unavailable` y una URL canonica. Si falta la configuracion o falla
una consulta devuelve 503 con uno de estos codigos publicos sanitizados:

- `RANKING_SERVICE_NOT_CONFIGURED`;
- `RANKING_WEEKS_QUERY_FAILED`;
- `RANKING_CONTEXT_QUERY_FAILED`.

No se devuelve el error de Supabase, claves, perfiles, scores ni membership.
Un 503 deja la capacidad en `unknown`, pero confirma que HSL ha respondido y no
convierte la conectividad global en offline.

## Cliente Electron y cache

El cliente consulta `POST /api/launcher/ranking-capabilities` solo con
reachability estable. Deduplica `weekId`, divide lotes por el maximo de 100 y no
bloquea arranque, escaneo, seleccion ni render local.

- `available`: 5 minutos;
- `unavailable`: 2 minutos;
- `unknown`: 20 segundos;
- timeout: 4 segundos.

Cada respuesta captura las generaciones de biblioteca y reachability. No puede
escribir cache si cambia la conexion, el pack, `weekId` u origen mientras esta
en curso. La cache puede conservarse offline, pero no habilita acciones.

## Selector unico de Ranking

`getRankingActionState` exige en el mismo snapshot:

- `reachability=connected` y estado visible `connected`;
- capacidad `available`, vigente y del `weekId` activo;
- URL HTTP(S) del mismo origen que `webBaseUrl`.

Connecting, reconnecting, offline, checking, unknown, unavailable, capacidad
expirada o identidad distinta quedan deshabilitados. `open-ranking` vuelve a
validar todas estas condiciones en main antes de `shell.openExternal`.

## Transicion de packs

La activacion local no espera el batch remoto, la consulta de membership ni una
renovacion de sesion. Conserva el pack anterior bajo el overlay, aplica un minimo
visual de 600 ms y publica el nuevo snapshot cuando los datos locales estan
listos. Membership y Ranking se resuelven despues de forma asincrona y con guardas
de identidad. El fallback de marca depende de estados estructurales de
biblioteca, no de un `game` temporalmente nulo ni de una comprobacion remota.
