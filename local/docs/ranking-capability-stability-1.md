# RANKING CAPABILITY STABILITY 1

La oscilacion procedia de sustituir un resultado `available` confirmado por un
estado intermedio cada vez que comenzaba una revalidacion o llegaba un contexto
equivalente con nueva identidad de objeto. Tambien existia riesgo de que una
respuesta antigua pisara un IPC posterior.

El servicio conserva por separado el ultimo resultado confirmado, el estado de
revalidacion y el ultimo error temporal. La cache distingue `fresh`,
`revalidating`, `soft-stale` y `hard-expired`, con 60 s de gracia soft-stale.
Durante esa gracia Ranking sigue disponible solo si conectividad, weekId,
origen, deployment y `activeInstanceKey` siguen siendo compatibles. Al abrir
Ranking desde soft-stale se fuerza revalidacion y no se abre si falla.

El fingerprint normaliza y ordena weekIds y usa la instancia activa del pack.
Cambios de cola, contadores, autoenvio u objetos semanticamente equivalentes no
invalidan la capacidad. Cambios reales de pack, origen, weekId, deployment,
offline o unavailable confirmado si la invalidan.

Cada snapshot lleva `stateSequence`, `contextGeneration` y
`requestGeneration`. El renderer ignora secuencias menores a la aplicada. Un
ring buffer acotado a 75 transiciones conserva triggers, estados, razones,
cache, tiempos, pack y generaciones sin secretos.
