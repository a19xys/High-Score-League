# NETWORK TOPOLOGY MONITOR 1

Main consulta `os.networkInterfaces()` cada 1000 ms. Es una lectura local
multiplataforma: no usa ping, shell, nombres de adaptador ni dependencias
nativas, y no genera trafico de red.

El fingerprint SHA-256 ordena interfaces y direcciones y considera family,
address, netmask, cidr, internal y scopeid. Las IP participan en el hash para
detectar DHCP, cable, Wi-Fi y VPN, pero nunca se publican. Diagnostico expone
solo hash, generacion y contadores agregados.

Un cambio solicita inmediatamente health y puede reemplazar un probe anterior.
No asigna connected. Si no quedan direcciones externas y `net.isOnline()` es
false, aplica offline inmediato; si es true, health decide. Suspend detiene el
monitor y resume restablece polling y health. Heartbeat de 20 s cubre perdidas
sin cambio de interfaces.

Cuando el estado ya es offline, el monitor comparte el scheduler con recovery
canary. Un cambio de fingerprint solicita una comprobacion inmediata, pero no
crea una segunda peticion si ya existe health en vuelo. El diagnostico expone
`timerKind`, intervalo, timeout, intento, trigger y motivo de deduplicacion.
