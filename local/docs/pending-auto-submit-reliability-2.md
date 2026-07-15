# PENDING AUTO SUBMIT RELIABILITY 2

La causa real era una clave terminal fijada antes de cargar cuenta y cola. Si
startup health terminaba primero, la oportunidad quedaba consumida. La clave
tampoco incluia pending, por lo que una captura nueva online no la rearmaba.

El indice autoritativo devuelve cuenta, jugador, revision, scopes, totales y
omisiones. La revision estable cambia cuando aparece, desaparece o cambia un
pending. Meta actualizado por una lectura no cambia la revision.

El coordinador reevalua precondiciones sin delays. `deferred` es reintentable;
`completed` fija la clave. La clave estable incluye userId, generacion de
conectividad, queueRevision y sessionRevision. Los scopes usan `submitAll` y
locks compartidos, se procesan secuencialmente y preservan pending ante
transporte o auth. Legacy/staging sin propietario determinista se conservan.

El autoenvio enumera todas las cuentas recordadas, procesa primero la activa y
despues una cuenta cada vez. Cada indice y envio se construye con el userId y la
sesion de su propietario. Una cuenta con auth revocada no bloquea a las demas.

La accion ordinaria "Subir pendientes" se retiro. Solo development expone
"Forzar sincronizacion de cuentas elegibles", que reutiliza el mismo scheduler,
sesiones, ownership, locks e idempotencia.
