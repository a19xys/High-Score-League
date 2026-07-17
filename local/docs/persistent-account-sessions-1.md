# PERSISTENT ACCOUNT SESSIONS 1

Persistencia indefinida significa renovar silenciosamente access tokens de
corta duracion mientras el refresh token remoto siga siendo valido. No se
fabrican expiraciones, no se ignora `expires_at` y no se configuran JWT de anos.

Cada cuenta recordada tiene estado `unavailable`, `loading`, `valid`,
`refreshing`, `deferred-offline`, `revoked` o `corrupt`. Los fallos de red,
timeout, DNS y 5xx conservan el material y pasan a `deferred-offline`. Solo una
revocacion concluyente, identidad distinta o material ausente/corrupto requiere
login. Los pending nunca se borran por auth.

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
el destino. Vease `canonical-account-sessions-1.md`.
