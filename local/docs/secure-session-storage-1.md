# SECURE SESSION STORAGE 1

Las sesiones canonicas por cuenta usan envelope schema v2 con `userId`, `playerKey`,
`provider`, `encryptedPayload`, `savedAt` y `revision`. Access y refresh token
solo existen dentro del payload. Main configura Electron `safeStorage`; el
renderer, IPC, logs y diagnostico nunca reciben tokens.

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
se restaura el ultimo envelope verificado en memoria, sin crear backups con
tokens.
La migracion schema v1 solo sustituye plaintext despues de verificar identidad
y lectura del envelope; si falla, conserva el original y elimina el temporal.
