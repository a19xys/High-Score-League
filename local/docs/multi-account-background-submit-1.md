# MULTI ACCOUNT BACKGROUND SUBMIT 1

El scheduler enumera todas las cuentas recordadas y ordena la cuenta activa
primero. Cada cuenta resuelve su propia sesion mediante single-flight, construye
su indice con su userId/playerKey y procesa sus scopes secuencialmente. Las
cuentas se procesan una a una y la cuenta visible no cambia.

El caso cuenta 1 con pending y cuenta 2 activa queda cubierto: cuenta 1 usa su
sesion y metadata, se envia despues de la activa y el renderer sigue mostrando
cuenta 2. Una cuenta revocada conserva pending, queda en waiting-login y no
bloquea cuentas elegibles.

La deduplicacion de submission combina userId, queueRevision y sessionRevision.
ConnectivityGeneration solo invalida una ejecucion remota en curso. El backoff
de sesion usa por separado userId y sessionRevision, con deadlines por cuenta y
un unico timer para el mas cercano. Estados temporales no consumen una
oportunidad terminal. Los locks global, por cuenta, por scope y de `submitAll`
evitan cruces y duplicados.
El menu solo muestra el aviso discreto de login cuando el fallo es concluyente
y esa cuenta tiene pending.
