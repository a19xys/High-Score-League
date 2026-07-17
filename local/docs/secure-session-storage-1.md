# SECURE SESSION STORAGE 1

Las sesiones canonicas por cuenta usan envelope schema v2 con `userId`, `playerKey`,
`provider`, `encryptedPayload`, `savedAt` y `revision`. Access y refresh token
solo existen dentro del payload. Main configura Electron `safeStorage`; el
renderer, IPC, logs y diagnostico nunca reciben tokens.

El `provider` del envelope describe el backend de protección local. Es distinto
del `providerFingerprint` del payload, que vincula la sesión al origen Supabase
normalizado. Si no está disponible el backend que exige un envelope cifrado se
produce `storage-unavailable`; un origen remoto distinto produce
`provider-mismatch`. Ninguno autoriza usar el token.

La CLI usa un proceso minimo de Electron `safeStorage` apuntando al mismo
`userData`, de modo que sus envelopes son interoperables con la GUI. El valor
sensible viaja por stdin del proceso hijo, nunca en argumentos ni logs.

Windows y macOS usan el backend de sistema informado por Electron. Linux usa el
backend seleccionado; `basic_text` se marca como degradado y no se presenta
como cifrado disponible. Sin proveedor funcional se mantiene un fallback
codificado, archivo con permisos 0600 y warning `secure-provider-not-configured`.
Este fallback preserva funcionalidad, no confidencialidad frente a acceso al
archivo.

La escritura crea un temporal exclusivo 0600, escribe, fsync, cierra, renombra
y verifica mediante lectura y descifrado. `expectedRevision` implementa CAS y
la revision aumenta en cada escritura canonica. Si rename o verificacion falla,
se intenta restaurar el JSON anterior leído antes de la mutación, sin crear
backups persistentes con tokens. Esa restauración es compensatoria y best
effort, no una transacción durable.
La migracion schema v1 solo sustituye plaintext despues de verificar identidad
y lectura del envelope; si falla, conserva el original y elimina el temporal.

Estas garantías son por archivo. Envelope, ledger de revisión,
`known-accounts.json` y journal no forman una transacción atómica conjunta; la
recuperación depende del orden de escritura, tombstones y checkpoints. Tampoco
se afirma durabilidad absoluta ante pérdida de energía en todas las
plataformas. Detalle y riesgos:
[canonical-account-sessions-stabilization-2.md](canonical-account-sessions-stabilization-2.md).
