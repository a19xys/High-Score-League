# OFFLINE RECOVERY CANARY 1

La latencia cercana a 20 s procedia de depender del siguiente heartbeat cuando
el sistema no emitia a tiempo una senal util de topologia/online. El recovery
canary elimina esa dependencia sin considerar `net.isOnline=true` como prueba
de conectividad.

Politica:

- 0-60 s offline: health cada 3 s, timeout 1 s.
- 1-5 min offline: health cada 5 s.
- Mas de 5 min: 10, 20, 30 y maximo 60 s.
- Suspend detiene timers; resume solicita health.
- Foco, blur y minimizado usan exactamente el mismo scheduler.

Unicamente health 204 confirma connected. Existe un timer y una peticion en
vuelo; eventos concurrentes se deduplican. El diagnostico incluye intervalo,
timeout, intento, trigger, timestamps y motivo de deduplicacion.

Los tests con reloj controlado verifican tramos, deduplicacion y suspension. La
mediana fisica de cinco recuperaciones por foco/sin foco/minimizado sigue
pendiente; no se presentan valores simulados como medicion real.
