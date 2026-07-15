# PENDING-AUTO-SUBMIT-1

El coordinador en Electron main dispara autoenvio una vez por clave
`reachabilityGeneration:userId` al completar startup connected, recuperar
conexion o cambiar/iniciar cuenta mientras connected. Un heartbeat exitoso no
crea otra ejecucion.

La enumeracion se limita a
`userData/players/<playerKey>/packs/<packKey>`. Solo acepta directorios reales,
`meta.json` schema 1, propietario coincidente, packKey coincidente, weekId
valido, origen HTTP(S) y al menos un JSON pending. No enumera colas legacy de
propietario ambiguo y nunca procesa `failed` o `sent`.

Cada scope reconstruye la configuracion desde su meta sin activar el pack. Usa
la copia de sesion recordada de la cuenta capturada, comprueba membership de la
semana y llama al mismo `submitAll` que el envio manual. El procesamiento es
secuencial. `submitAll` admite guardas opcionales entre archivos para detenerse
por cambio de cuenta, cierre o conectividad, conservando pending.

Los locks manual/automatico son compartidos. El duplicado confirmado conserva
la politica idempotente existente; validacion/membership mantienen su politica
actual; transporte y auth conservan pending. Cambio de cuenta y shutdown
incrementan un epoch que invalida el ciclo previo.

No hay overlay ni popup. Al finalizar se publica un unico snapshot para
contadores y, si hubo envios, una sola linea amigable. Diagnostico incluye
trigger, playerKey sanitizado, generacion, scopes, pending encontrados,
enviados, conservados, failed, estado inFlight y ultima ejecucion.
