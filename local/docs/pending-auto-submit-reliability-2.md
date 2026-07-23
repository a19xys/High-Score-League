# PENDING AUTO SUBMIT RELIABILITY 2

La causa real era una clave terminal fijada antes de cargar cuenta y cola. Si
startup health terminaba primero, la oportunidad quedaba consumida. La clave
tampoco incluia pending, por lo que una captura nueva online no la rearmaba.

El indice autoritativo devuelve cuenta, jugador, revision, scopes, totales y
omisiones. La revision estable cambia cuando aparece, desaparece o cambia un
pending. Meta actualizado por una lectura no cambia la revision.

El coordinador reevalua precondiciones sin delays. `deferred` es reintentable;
`completed` fija la clave. El guard de submission es exactamente `userId +
queueRevision + sessionRevision`; la generacion de conectividad solo describe
la ejecucion y no crea trabajo nuevo. Los scopes usan `submitAll` y locks
compartidos, se procesan secuencialmente y preservan pending ante transporte o
auth. Legacy/staging sin propietario determinista se conservan.

`sessionDeferred` tiene otra identidad: `userId + sessionRevision`. Por eso una
captura, un cambio de orden o cuenta activa, una nueva `queueRevision` o una
reconexion no saltan el backoff canonico de refresh. Una revision de sesion
nueva (login o refresh utilizable) elimina la espera anterior y permite
reevaluacion inmediata.

Las esperas se guardan por cuenta y conservan su deadline absoluto. Hay un solo
timer, siempre para el deadline mas cercano; al vencer reevalua una vez y se
rearma si el repositorio devuelve otro aplazamiento. `Retry-After` canonico gana
cuando existe. Sin el, el fallback crece de 30 s a 15 min, sin incrementar el
intento de submission. `sessionDeferred` no crea auth block ni terminalidad y
no borra un cooldown de ingest.

Suspend/cancel invalidan el trabajo y desmontan el timer sin perder deadlines;
resume reevalua y rearma una sola vez. Logout/remove eliminan esperas obsoletas
al observar las identidades actuales. Shutdown cierra el coordinador, cancela
el timer y rechaza solicitudes nuevas. `resetGuards` sigue reservado a
`development-force`.

El autoenvio enumera todas las cuentas recordadas, procesa primero la activa y
despues una cuenta cada vez. Cada indice y envio se construye con el userId y la
sesion de su propietario. Una cuenta con auth revocada no bloquea a las demas.

La accion ordinaria "Subir pendientes" se retiro. Solo development expone
"Forzar sincronizacion de cuentas elegibles", que reutiliza el mismo scheduler,
sesiones, ownership, locks e idempotencia.

Riesgo residual: el timer vive en memoria del proceso; tras reiniciar, el
repositorio canonico vuelve a calcular el tiempo restante del backoff y el
coordinador arma un deadline nuevo a partir de ese valor, sin persistir handles.
