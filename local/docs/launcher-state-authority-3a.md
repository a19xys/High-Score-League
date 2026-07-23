# LAUNCHER STATE AUTHORITY 3A

Los snapshots completos tienen una unica autoridad en el proceso principal.
Cada handler IPC reserva `launcherStateRevision` al empezar, antes de esperar su
resultado. El push de autoenvio reserva al empezar el trabajo remoto. Por eso
una respuesta iniciada antes conserva una revision menor aunque termine
despues. La revision solo es monotona durante la vida del proceso y no se
persiste ni se mezcla con sessionRevision, queueRevision, revisiones de cuentas,
reachabilityGeneration, generaciones de Ranking o secuencias locales.

Son snapshots completos la carga `launcher:get-state`, los `state` incluidos en
respuestas de acciones y `launcher:state` de autoenvio. Todos cruzan la misma
autoridad antes de publicarse. Conectividad y Ranking son eventos parciales:
solo actualizan su dominio y mantienen respectivamente
reachabilityGeneration/stateSequence. No reconstruyen un estado global.

El renderer aplica todos los snapshots completos mediante un unico gate. Acepta
la primera revision valida y revisiones estrictamente superiores. Una revision
inferior o igual se ignora; en igualdad gana el primer snapshot aplicado. Como
compatibilidad acotada, se admite como maximo un snapshot legacy antes de ver
uno versionado. Un legacy nunca puede ganar despues de un snapshot versionado.
El diagnostico solo cuenta stale/legacy ignorados y conserva la revision maxima;
no registra payloads, tokens ni rutas de sesion.

Las protecciones locales siguen siendo independientes: secuencias de seleccion
y assets cancelan callbacks viejos, las preferencias visibles ganan a una
hidratacion iniciada antes y persistir preferencias no reaplica `response.state`.
Los eventos parciales de conectividad o Ranking no sustituyen biblioteca,
sesion, membership ni preferencias.

Riesgos residuales: la compatibilidad legacy existe solo para bootstrap de
transicion y debe retirarse cuando no queden productores antiguos. Una nueva
ventana dentro del mismo proceso recibe la revision vigente a traves del mismo
IPC; un reinicio abre una autoridad nueva desde revision 1.
