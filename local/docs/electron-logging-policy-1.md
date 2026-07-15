# ELECTRON LOGGING POLICY 1

Chromium se configura antes de `app.whenReady()`. En ejecucion normal se usa
nivel de error (`log-level=2`) y no se activan `ELECTRON_ENABLE_LOGGING` ni stack
dumps. Con `HSL_ELECTRON_VERBOSE_LOGGING=1` se habilita logging detallado y
`log-level=0` para diagnostico deliberado.

No se analiza, filtra ni usa el texto `Failed to read DnsConfig` como senal de
red. La politica de nivel no captura ni oculta TypeError, excepciones no
controladas, rechazos, errores IPC, filesystem, auth, submission, Ranking o
startup, que siguen sus canales de diagnostico propios.

La comparacion manual normal/verbose de ese warning queda pendiente en esta
sesion; el comportamiento de flags esta cubierto por inspeccion y tests de
codigo.
