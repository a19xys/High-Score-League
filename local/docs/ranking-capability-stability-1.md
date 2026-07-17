# RANKING CAPABILITY STABILITY 1

El flicker de cinco minutos tenia dos causas: el renderer exigia
`expiresAt > Date.now()` y el servicio programaba revalidacion al vencer el TTL.
Ademas, `activeInstanceKey` formaba parte del fingerprint y de la cache aunque
la capacidad pertenece a una semana, no a una tarjeta visual.

Ranking usa ahora verificacion de duracion de proceso. `available` y
`unavailable` son concluyentes hasta cerrar la app o hasta un cambio semantico
real de origen/deployment/weekIds. No existen TTL, soft-stale, hard-expired ni
timer periodico para resultados concluyentes.

La cache key es `trustedOrigin + deploymentKey + weekId`. El fingerprint es el
origen global, deployment y lista ordenada de weekIds. Cuenta, membership,
cola, seleccion, orden y `activeInstanceKey` quedan fuera.

Al conocer la biblioteca se consulta un batch con todas las semanas unicas. Un
cambio posterior consulta solo IDs nuevos o sin resultado. Startup offline
mantiene unknown y recovery consulta inmediatamente. Un deployment diferente
invalida el namespace anterior y vuelve a consultar todas las semanas actuales.

Los errores temporales permanecen unknown y tienen retry limitado. Nunca
sobrescriben un resultado concluyente previo. La accion de desarrollo
"Forzar comprobacion de rankings" puede revalidar explicitamente el batch.

Cada snapshot conserva `stateSequence`, `contextGeneration` y
`requestGeneration`; respuestas stale no escriben cache y el renderer ignora
secuencias anteriores. El ring buffer sigue acotado a 75 transiciones.
