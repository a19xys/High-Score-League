# CONNECTIVITY FINAL RISK REGISTER 3

| Riesgo | Sev. | Estado/evidencia | Mitigacion y test | Propietario / residual |
| --- | --- | --- | --- | --- |
| Schema drift de `weeks.id` | P1 | Mitigado localmente; UUID confirmado | Filtro UUID + batch mixto/inexistente | Web; bajo tras deploy |
| Credenciales Supabase obsoletas | P1 | Config local consulta; Vercel no inspeccionado | Clasificacion auth/proyecto + revisar env y smoke | Operador deploy; abierto |
| Deployment drift | P1 | Produccion anterior sin fingerprint | Headers/body + SHA esperado | Operador deploy; abierto hasta publicar |
| Service role expuesto | P0 | Cerrado; solo server | Tests de campos privados y sanitizacion | Web; residual bajo |
| Señal OS falsa positiva | P1 | Mitigado | `net.isOnline=true` solo permite health | Electron; residual bajo |
| Evento online perdido | P2 | Mitigado | heartbeat 45 s/4 min + focus/resume | Electron; ventana acotada |
| Heartbeat falso negativo | P1 | Mitigado | confirmation probe; tests de doble intento | Electron; residual bajo |
| Respuesta stale | P1 | Mitigado | generaciones reachability/library/deploy | Electron; tests stale |
| URL insegura/origen distinto | P0 | Cerrado | normalizacion y same-origin antes de abrir | Electron; residual bajo |
| Mezcla multi-cuenta | P0 | Cerrado | playerKey/meta/session copy/epoch | Local; tests otra cuenta |
| Auto-submit duplicado | P1 | Mitigado | clave generacion+usuario, chain y locks | Main; idempotencia servidor residual |
| Cierre durante envio | P1 | Mitigado | invalidate epoch y guardas entre archivos | Main; request ya enviada puede completar |
| Suspension/timer dormido | P1 | Mitigado en codigo | sin polling suspendido; health resume | Usuario prueba fisica pendiente |
| Overlay solapado | P1 | Mitigado | busy lock + runId | Renderer; residual bajo |
| Diagnostico fugaz | P2 | Mitigado | default 600 ms exito/error | Renderer; fake timers |
| Endpoint 503 | P1 | Causa corregida localmente | filtro UUID + smoke real | Operador deploy; abierto hasta deploy |
| Secretos en logs | P0 | Cerrado | sanitizer Bearer/JWT/keys + tests | Web/local; residual bajo |
| Desconexion/reconexion fisica | P1 | Codigo cubierto, hardware pendiente | retirar/reconectar Ethernet y medir señal | Usuario QA; abierto |

No queda P0 abierto. Los P1 abiertos tienen propietario y validacion concreta.
No se autoriza declarar produccion cerrada ni iniciar la tarea 2 hasta completar
deploy con fingerprint/smoke y la prueba fisica de red/suspension.
