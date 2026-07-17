# PERSISTENT ACCOUNT SESSIONS 1

Persistencia indefinida significa renovar silenciosamente access tokens de
corta duracion mientras el refresh token remoto siga siendo valido. No se
fabrican expiraciones, no se ignora `expires_at` y no se configuran JWT de anos.

Los estados visuales `unavailable`, `loading`, `refreshing` y
`deferred-offline` son proyecciones de UI. El resultado de dominio distingue
material local, aptitud remota, reintento y necesidad de login. Por defecto se
recomienda refresh a 60 s, pero un token solo es apto para red si conserva más
de 5 s, identidad válida y binding exacto al origen configurado. Los fallos de
red, timeout, DNS, 429 y 5xx conservan el material; no se presentan como
revocación. Los pending nunca se borran por auth.

La renovacion se evalua en startup, antes de sincronizar, tras recovery, al
reanudar y mediante mantenimiento espaciado mientras la app esta abierta. Solo
hace red si la sesion esta proxima a expirar o se fuerza desde development. No
se renueva por heartbeat, archivo o render.

Checklist Supabase Auth pendiente de verificacion manual:

- Time-boxed sessions desactivado o sin limite.
- Inactivity timeout desactivado o compatible.
- Single-session per user desactivado salvo decision explicita.
- JWT lifetime razonable y de corta duracion.
- Refresh token rotation activa conforme a la politica del proyecto.

El panel remoto no se verifico en esta sesion y no se afirma lo contrario.

## Autoridad canonica

Cada cuenta usa ahora un unico envelope en `accounts/sessions/<playerKey>.json`;
`lastActiveUserId` es solo un pointer. Lectura y renovacion pasan por el
repositorio canonico, con single-flight y lock interproceso por usuario.
`session.json` solo es entrada legacy del migrador y se elimina tras verificar
el destino. Véanse
[canonical-account-sessions-1.md](canonical-account-sessions-1.md) y la matriz
vigente en
[canonical-account-sessions-stabilization-2.md](canonical-account-sessions-stabilization-2.md).

El backoff de refresh es por usuario (`30/60/120/300/900 s`, con
`Retry-After` acotado) y vive en memoria: un reinicio lo pierde. La
configuración remota de Supabase y el protocolo end-to-end de staging siguen
pendientes de verificación manual; no se deducen de las pruebas automáticas.
