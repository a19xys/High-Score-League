# GLOBAL HSL ORIGIN 1

El monitor de conectividad se inicializa una vez desde
`service.getRemoteBootstrapState()`, cuya fuente es `config.webBaseUrl`. Main
conserva ese `trustedGlobalOrigin`; `syncRemoteContext` no llama a
`connectivity.setWebBaseUrl`.

Biblioteca vacia, missing, inaccesible, pack-root, inside-pack, layout no
soportado, cancelacion, seleccion y reescaneo solo modifican estado local. No
cambian endpoint, reachability, generaciones, deployment, scheduler, sesiones
ni autoenvio de otras cuentas.

Un `pack.webBaseUrl` same-origin se acepta como declaracion compatible, pero el
config efectivo sigue usando el origen global. Una declaracion foreign-origin o
invalida genera warning y se ignora. Nunca alimenta health ni Ranking.

Si en el futuro se permite cambiar HSL desde Configuracion, debera ser una
operacion global explicita, validada y unica que reinicie conectividad y
capacidades. No puede depender de contenido importado.
