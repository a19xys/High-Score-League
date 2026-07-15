# CONNECTIVITY-RANKING-RELIABILITY-2

## Causa del 503

La reproduccion controlada separo health, batch vacio, semana real e identidad
inexistente. La semana UUID real devolvio 200/available. La identidad publica no
UUID devolvio `RANKING_WEEKS_QUERY_FAILED` porque se enviaba a
`weeks.id IN (...)`, columna PostgreSQL UUID. Un solo valor no UUID hacia fallar
todo el batch antes de aplicar reglas de publicacion.

La reproduccion directa devolvio PostgreSQL `22P02`: `invalid input syntax for
type uuid` para la identidad de comprobacion no UUID.

La ruta mantiene el contrato publico permisivo, pero solo consulta Supabase con
identidades UUID. Las demas se resuelven como `unavailable/not-found`; un batch
mixto ya no se contamina. No se añadio excepcion por juego, pack o semana.

La consulta sigue usando service role exclusivamente en servidor debido a la
RLS actual. No se eligio RPC porque la consulta minima existente es suficiente.
Los fallos internos se clasifican y registran solo en servidor, con request ID,
stage, operacion y diagnostico sanitizado; el cliente conserva codigos estables.

## Electron

La cache se segmenta por origen, weekId y fingerprint de health. Cada request
captura generaciones de biblioteca, reachability y deployment. Un cambio de
cualquiera descarta la respuesta. Health y Ranking deben coincidir en build,
entorno y contrato; en desarrollo se admite `unknown` cuando ambos lados
carecen de build.

Ranking solo se habilita con reachability connected, capability available y
vigente, mismo weekId, URL HTTP(S) del mismo origen y generaciones actuales.
Main repite la validacion antes de `shell.openExternal`.

## Validacion pendiente de entorno

El codigo local y sus pruebas estan cerrados, pero produccion seguia sin headers
de fingerprint antes de este cambio. El operador de despliegue debe publicar el
commit resultante y ejecutar el smoke con SHA esperado. La retirada/reconexion
fisica de Ethernet y suspend/resume requieren validacion manual en el equipo del
usuario; no se simulan con comandos del sistema operativo.
