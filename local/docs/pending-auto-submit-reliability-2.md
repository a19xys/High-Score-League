# PENDING AUTO SUBMIT RELIABILITY 2

La causa real era una clave terminal fijada antes de cargar cuenta y cola. Si
startup health terminaba primero, la oportunidad quedaba consumida. La clave
tampoco incluia pending, por lo que una captura nueva online no la rearmaba.

El indice autoritativo devuelve cuenta, jugador, revision, scopes, totales y
omisiones. La revision estable cambia cuando aparece, desaparece o cambia un
pending. Meta actualizado por una lectura no cambia la revision.

El coordinador reevalua precondiciones sin delays. `deferred` es reintentable;
`completed` fija la clave. Manual y automatico usan `submitAll` y locks
compartidos, procesan scopes secuencialmente y preservan pending ante transporte
o auth. Legacy/staging sin propietario determinista se conservan.

El boton manual usa una derivacion unica de conectividad, sesion, scope,
pending valido, lock y membership. El tooltip explica el motivo disabled. El
boton representa el pack activo; el autoenvio recorre todos los packs de la
cuenta.
