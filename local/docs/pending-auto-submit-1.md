# PENDING-AUTO-SUBMIT-1

Electron main coordina el autoenvio con la clave
`userId:reachabilityGeneration:queueRevision`. Sus estados son `scheduled`,
`deferred`, `running`, `completed` y `cancelled`; solo un resultado terminal
consume la clave. Health y estado local pueden terminar en cualquier orden.

El indice recorre `userData/players/<playerKey>/packs/<packKey>` para la cuenta
activa. Valida `meta.json`, propietario, pack, week, origen y cada JSON pending.
Incluye scopes vacios y omitidos en diagnostico, pero solo procesa scopes
aceptados con pending. Legacy y staging ambiguos se preservan; `failed` y
`sent` nunca se envian.

`queueRevision` usa identidad estable del meta y nombre, tamano, mtime y validez
de pending. No usa `Date.now()` ni `meta.updatedAt`. Los disparadores son
startup, recuperacion, login/cambio de cuenta, captura/adopcion, restore y todo
snapshot interno que aumente la revision. Focus, refresh y cambio de pack no
son necesarios.

Cada scope reconstruye configuracion desde meta sin activar el pack. Se usa la
sesion recordada y congelada de la cuenta, se comprueba membership y se llama al
mismo `submitAll` del envio manual. Los scopes son secuenciales. Transporte,
auth, lock o precondiciones temporales conservan pending y quedan `deferred`.

Manual y automatico comparten locks. No hay overlay ni popup de background. Al
terminar se publica un snapshot y, si hubo envios, una sola linea de actividad.
El diagnostico anonimiza jugador e incluye trigger, revision, generacion,
scopes, omisiones, pending, validos, enviados, conservados y fallidos.
