# CONNECTIVITY FINAL RISK REGISTER 3

| Riesgo | Sev. | Estado | Mitigacion / residual |
| --- | --- | --- | --- |
| Senal OS falsa positiva | P1 | Mitigado | OS solo dispara health; residual bajo |
| Evento de red perdido | P1 | Mitigado | topologia 1 s + heartbeat 20 s |
| Heartbeat falso negativo | P1 | Mitigado | confirmacion corta, un probe concurrente |
| Respuesta stale | P1 | Mitigado | generaciones y abort al cambiar topologia |
| Mezcla multi-cuenta | P0 | Cerrado | player/meta/sesion congelada/epoch |
| Autoenvio duplicado | P1 | Mitigado | usuario+generacion+revision e idempotencia |
| Cola legacy ambigua | P1 | Mitigado | conservar y diagnosticar; no inferir dueno |
| Cierre durante envio | P1 | Mitigado | invalidate y guardas; request emitida puede terminar |
| Suspension | P1 | Mitigado en codigo | prueba fisica pendiente |
| Warning DNS Chromium | P2 | Aceptado | no se analiza; vigilar contadores de health |
| Desconexion/reconexion fisica | P1 | Codigo cubierto | QA Ethernet/foco/minimizado pendiente |
| Secretos o IP en diagnostico | P0 | Cerrado | hash y agregados; sanitizer existente |

No queda P0 abierto. No se declara cerrada la validacion fisica hasta medir
desconexion y recuperacion con foco, sin foco y minimizado sobre hardware real.
