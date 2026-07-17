# RANKING SESSION VERIFICATION 1

La verificacion se realiza al cargar la aplicacion cuando HSL esta conectado y
la biblioteca ya aporta su conjunto de weekIds. El request es batch, deduplica
IDs y conserva resultados durante toda la sesion del proceso.

Triggers de red permitidos:

- batch inicial;
- primera recovery si startup fue offline;
- weekId nuevo o todavia unknown;
- cambio real de origen o deployment;
- retry limitado de unknown;
- refresh explicito solo en desarrollo.

No son triggers: cinco minutos, reloj, heartbeat, recovery con deployment igual,
pack activo, `activeInstanceKey`, orden, cuenta, membership, cola ni autoenvio.

Al pulsar Ranking, un `available` confirmado se abre sin revalidacion por TTL.
Main vuelve a comprobar la compuerta comprometida, identidad weekId, pack actual
y URL same-origin. Unknown y unavailable no abren.

Tradeoff aceptado: una modificacion administrativa remota mientras la app sigue
abierta puede requerir reinicio, cambio semantico de biblioteca/deployment o la
herramienta de desarrollo. Se evita asi una inestabilidad periodica visible.
