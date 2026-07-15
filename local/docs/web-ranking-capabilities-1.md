# LOCAL-WEB-RANKING-CAPABILITIES-1

El boton Ranking ya no se habilita porque el pack contenga o permita construir
una URL. La web decide por lotes si la semana canonica dispone de ranking y
devuelve la URL que Electron puede abrir.

## Identidad y fuente de verdad

La identidad canonica es `weekId`. `requestKey` solo correlaciona peticiones y
respuestas. No se usan titulo, posicion de card, nombre de carpeta, `packId` ni
una URL aportada por Electron.

`resolvePublicRankingCapability` comparte la decision con la carga de la pagina
de semana. Una capacidad es `available` cuando:

- existen temporada, semana y juego;
- la temporada no es draft;
- la semana no es futura respecto a la semana activa de su temporada;
- el estado derivado es activo, tramo final, cerrado o publicado.

Una tabla sin puntuaciones sigue siendo una pagina valida. Una semana
publicada explicitamente sigue disponible. El endpoint no carga puntuaciones,
perfiles ni HTML.

## Cliente Electron

El cliente consulta `POST /api/launcher/ranking-capabilities` solo cuando la
conectividad es `connected`. Deduplica `weekId`, usa un unico batch hasta 100
identidades y parte lotes mayores. Las consultas no bloquean el arranque, el
escaneo, la seleccion ni el render local.

Cache en memoria por `origen + weekId`:

- `available`: 5 minutos;
- `unavailable`: 2 minutos;
- `unknown`: 20 segundos;
- timeout de request: 4 segundos.

El servidor solo devuelve resultados concluyentes `available` o `unavailable`.
Electron anade `checking` y `unknown`; timeout, DNS, HTTP temporal, payload
invalido y URL insegura nunca se convierten en `unavailable`.

Los cambios de biblioteca o `webBaseUrl` incrementan una generacion y descartan
respuestas obsoletas. La cache puede conservarse internamente al perder red,
pero no habilita Ranking mientras la conexion no sea `connected`.

## Matriz del boton

- pack sin `weekId`: disabled, `Este pack no tiene un ranking configurado.`
- offline: disabled, `Necesitas conexion para abrir el ranking.`
- connecting: disabled, `Comprobando conexion con High Score League.`
- connected + checking: disabled, comprobando disponibilidad.
- connected + unknown: disabled, no se pudo comprobar.
- connected + unavailable: disabled, todavia no disponible.
- connected + available: enabled.

El click vuelve a exigir conectividad fresca y capacidad no expirada. Solo el
proceso principal llama a `shell.openExternal`, despues de comprobar que la URL
es HTTP(S), pertenece al mismo origen de `webBaseUrl` y corresponde al `weekId`
activo.

## IPC y diagnostico

- `launcher:get-ranking-capabilities-state`
- `launcher:request-ranking-capabilities-refresh`
- evento `launcher:ranking-capabilities-state`

El diagnostico muestra para el pack activo identidad, estado, motivo,
timestamps, expiracion, URL segura y version del contrato. Tambien resume las
entradas available, unavailable, unknown y expiradas. No contiene secretos.

