# LOCAL-SCORE-SUBMIT-CONVERGENCE-1

## Invariante durable

La ruta canonica de una puntuacion competitiva es siempre:

```text
captura
-> publicacion local atomica
-> adopcion durable en pending scoped
-> intencion causal score-adopted
-> POST remoto
-> sent tras ACK
```

El plugin nunca envia directamente a la red. `pending` sigue siendo la
autoridad offline-first y sobrevive a perdida de conectividad, timeout, 429,
fallo de sesion, cierre de MAME y cierre inesperado del launcher.

## Publicacion atomica del plugin

`core/writer.lua` escribe el JSON completo y su newline en un archivo
`<nombre>.json.tmp`, cierra el handle y usa `os.rename` dentro del mismo
directorio del run para publicar `<nombre>.json`. El consumidor solo enumera
extensiones `.json`, de modo que un temporal abandonado nunca se adopta ni se
envia.

El destino se comprueba antes del rename y no se reemplaza deliberadamente. El
nombre incorpora una secuencia monotona del proceso, ademas del tiempo, ROM y
score, para separar capturas legitimas dentro del mismo segundo. En Windows,
que es el producto soportado, temporal y final estan en el mismo volumen y el
rename publica el nombre final sin una ventana de JSON parcial. Un fallo de
escritura, cierre o rename se registra y conserva el temporal como evidencia
ignorada por la cola.

## Competicion v2

Cada run congela esta frontera de autoridad al lanzarse:

```text
runId + stagingPendingDir + playerKey + packKey + scopedPendingDir
```

El monitor no vuelve a consultar la cuenta o el pack visibles. Por ello una
captura de A/X nunca se redirige a B/Y si cambia el contexto del launcher.

El staging aislado se observa con `fs.watch({ persistent: false })`. La
notificacion es solo un hint: se ignoran `filename`, tipo y numero de eventos,
y se vuelve a enumerar autoritativamente todo `.json` del staging. No hay
polling ni timers recurrentes.

Solo puede existir un scan activo. Una señal durante ese scan marca una unica
pasada posterior coalescida. `moveFileSafe` mueve cada archivo a la cola scoped
sin sobrescribir un destino. Las notificaciones duplicadas causadas por el
propio rename pueden producir otra enumeracion vacia, pero no una segunda
adopcion.

Tras una adopcion no vacia se emite `score-adopted`. El callback registra la
solicitud en `pending-auto-submit-coordinator` y no espera a la red. El
coordinador conserva sus contratos de readiness, serializacion, account
discovery, guards, cooldown, `Retry-After`, session deferral, cancelacion y
recuperacion de conectividad. Si B se adopta mientras A se envia, la solicitud
de B queda encadenada como una pasada posterior; nunca hay dos coordinadores de
POST paralelos.

La configuracion de submission de una cola scoped usa umbral de fichero
reciente `0`: esa cola nunca es destino de un writer con el `.json` final
abierto, sino de un move/rename de archivo completo o de una restauracion. Se
elimina asi la espera legacy de 2 segundos exactamente despues de cruzar la
frontera durable, sin relajar la proteccion para staging o colas CLI donde un
writer si puede exponer un final abierto.

## Cierre y lifecycle

Al terminar MAME se dejan de aceptar callbacks, se cierra el watcher, se espera
el scan activo y se ejecuta una enumeracion final completa. Cualquier `.json`
no observado se adopta y emite la misma intencion causal. La finalizacion
espera la durabilidad local, no el resultado del servidor.

```text
watcher = hint de latencia
rescan al cierre = garantia de correccion
```

Si el spawn falla, el `finally` cierra el monitor sin dejar handles o listeners.
Si `fs.watch` no puede arrancar, Diagnostics conserva el error y el rescan al
cierre sigue siendo la garantia disponible.

## Legacy v1

Legacy mantiene snapshot y adopcion despues de cerrar MAME; no se observa en
vivo porque su staging no tiene la frontera limpia de un run v2. La diferencia
es que una adopcion legacy no vacia ya emite `score-adopted` inmediatamente.

## Offline, backoff y autoridad remota

La adopcion local no depende de Connectivity ni de la sesion. Cada intento
remoto vuelve a pasar por las autoridades existentes. Offline, timeout,
transporte, servidor, 429 y session refresh deferred conservan `pending`. La
reconexion y los timers ya propiedad del coordinador reintentan sin bypass de
cooldown. Login requerido o un item terminal no se tratan como mera espera.

El publisher background reutiliza `pendingAutoSubmitCoordinator.onResult`, las
revisiones de `launcher-state-authority` y el snapshot autorizado. La
publicacion post-MAME mantiene `scheduleAutoSubmit: false`; no se ha reabierto
la convergencia de Playtime ni se han introducido efectos remotos incidentales.

## Presentacion de producto

Los estados tecnicos se conservan, pero se proyectan asi:

- `Sincronizando`: hay un submit activo, aunque los archivos sigan durables.
- `Pendiente de sincronizar`: hay trabajo sano que aun no ha arrancado; es
  informativo y normalmente fugaz.
- `Envio aplazado`: existe un impedimento recuperable real como offline,
  transporte, timeout, 429/cooldown o session deferral.
- `Requiere atencion`: hace falta login o existen puntuaciones terminales.
- `Envio bloqueado`: el scope, week o membership son estructuralmente
  invalidos para ese envio.

## Diagnostics

El informe incluye identificadores hash de run/scope, `watching`,
`scanInFlight`, `rescanQueued`, señales, scans, adopciones live/close, ultima
adopcion, solicitudes de submit y contadores/codigos de error. No incluye rutas
del run, tokens, email, sesiones ni payloads de puntuacion.

## Limites

`fs.watch` no garantiza entregar todos los eventos; por diseño, esa garantia no
es necesaria para correccion. Un crash simultaneo de MAME y launcher puede
dejar el run para soporte y recuperacion posterior, como antes. La firma de
adapters, hardening anti-cheat y protocolos realtime quedan fuera de alcance.
