# CONNECTIVITY-RANKING-RELIABILITY-2

## Diagnostico corregido

El estado anterior mezclaba el ultimo resultado estable con el periodo de
backoff. Tras un fallo escribia `status=connecting` aunque `inFlight=false`, por
lo que el chip podia quedar permanentemente en Conectando. `net.isOnline=true`
sin Ethernet era compatible con adaptadores virtuales de Windows y nunca debio
tratarse como confirmacion positiva.

El batch 503 convertia las cinco semanas solicitadas en cinco capacidades
`unknown`; no era una regla de semana cerrada. Ademas, la respuesta capturaba la
generacion de biblioteca, pero no la de reachability, de modo que una respuesta
iniciada online podia escribir cache despues de una perdida de red. El selector
actual y la revalidacion de main impiden tanto habilitar como abrir esa URL.

Durante operaciones busy se neutralizaban `activePack` y `game`. El panel
interpretaba el valor temporal nulo como ausencia estructural y podia mostrar el
hero HSL. Ademas, la activacion reconstruia el estado mediante
`getLauncherState`, que podia esperar membership y una renovacion de sesion. La
transicion ahora conserva el snapshot anterior, difiere esos accesos remotos,
usa el feedback comun de 600 ms y solo muestra marca para estados estructurales.

## Endpoint desplegado

El 15 de julio de 2026 health devolvio 204. Una primera llamada al batch devolvio
200/available, pero las repeticiones posteriores devolvieron 503, incluso al
consultar unicamente una identidad inexistente. Produccion aun ejecutaba la ruta
anterior y solo respondia el error generico, sin codigo de etapa. Eso demuestra
que falla la primera consulta a `weeks`, no una regla de publicacion ni la
consulta de contexto. El cliente admin llega a crearse, por lo que las dos
variables tienen algun valor en Vercel.

Con las credenciales locales, la consulta exacta y las columnas antiguas y
nuevas devuelven 200 y la semana esperada. Sin acceso a los logs y valores del
despliegue no se puede distinguir entre una credencial desplegada obsoleta y un
fallo de transporte del runtime. La ruta corregida reduce la seleccion y separa
configuracion, consulta inicial y contexto con codigos sanitizados. Debe
desplegarse, revisar la configuracion de Vercel y repetir `test:launcher-api`
antes de dar por validada produccion.

## Limites

Esta tarea no introduce snapshots versionados, revisiones de contenido o assets,
refresco de manuales ni publicacion atomica general de biblioteca. Esos cambios
pertenecen a LOCAL-LIBRARY-CONTENT-REFRESH-1. La desconexion fisica y posterior
recuperacion deben verificarse manualmente en un equipo donde se pueda retirar
Ethernet sin interrumpir el entorno de trabajo.
