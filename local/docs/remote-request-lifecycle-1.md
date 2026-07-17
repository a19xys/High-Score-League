# LOCAL REMOTE REQUEST LIFECYCLE 1

Contrato comun para las peticiones remotas de producto del launcher.

## Alcance

Membership y envio de puntuaciones usan el mismo helper. El plazo por defecto
es 15 segundos y cubre toda la operacion: espera de cabeceras y lectura del
cuerpo. Cada peticion fuerza `redirect: error`; no se siguen redirecciones.

El resultado distingue `timeout`, `cancelled`, `transport-failure` y respuesta
HTTP. Esta ultima significa que el servidor fue alcanzado, aunque el producto
devolviera error.

## Cancelacion

Main mantiene una señal de ciclo de vida. `suspend` y `shutdown` la abortan; en
resume se crea una nueva señal. La invalidacion interactiva de cuenta o scope
aborta la comprobacion membership antigua sin cancelar indiscriminadamente el
lote multicuenta background ya congelado. Una señal ya abortada impide que se
invoque `fetch`, por lo que no nacen peticiones nuevas tras suspend o shutdown.

La cancelacion no consume `terminalKey`, no mueve `pending` y no se confunde
con timeout. Los motivos observables se limitan a una lista segura, sin URL,
token, cabeceras ni cuerpo.

## Autoridad de conectividad

Una peticion de producto nunca asigna `connected` ni `offline`. Un fallo de
transporte puede pedir una confirmacion al health, pero solo el servicio de
health compromete reachability. Un HTTP 503 de ingest o membership es un error
de producto alcanzable, no una prueba de desconexion.

## Diagnostico seguro

Se registran tipo de fallo, estado HTTP, plazo, motivo de cancelacion y tiempos
agregados. No se conservan Bearer tokens, bodies completos, HTML, cookies ni
URLs devueltas por un servidor.
