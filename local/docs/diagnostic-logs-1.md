# Diagnostic logs

## Fiabilidad remota prelaunch

El bloque `autoSubmit.coordinator` expone estado, motivo de defer, revision de
cola/sesion, intento de cooldown, `nextEligibleAt`, bloqueo de autenticacion y
ultima clave terminal. Los resultados remotos usan motivos enumerados para
HTTP reintentable, transporte, timeout y cancelacion.

El bloque de sesiones canonicas agrega schema y migracion, recuentos de cuentas
y sesiones, hashes del activo y de usuarios en vuelo, contadores de lock,
refresh, deferred, revocacion, corrupcion y stale writes, mas revision,
expiracion y `requiresLogin` por cuenta. No incluye email, tokens, cuerpos del
proveedor ni rutas fisicas de credenciales.

La estabilización añade el backoff de refresh por hash de usuario, intento,
motivo, estado HTTP permitido, `nextEligibleAt` y plazo restante. Los resultados
de sesión sanitizan y acotan `reason`, `error` y `lockState`; nunca debe
serializarse `storedSession`. Un diagnóstico puede describir
`provider-mismatch`, `storage-unavailable`, `lock-timeout` o
`recovery-required`, pero no repara archivos, no valida la configuración remota
de Supabase y no demuestra que staging haya pasado. Contrato completo:
[canonical-account-sessions-stabilization-2.md](canonical-account-sessions-stabilization-2.md).

El sanitizer sigue excluyendo tokens, Authorization, cookies, cuerpos completos,
HTML, IP y URLs devueltas por servidor. La causa tecnica se limita a estado
HTTP, tipo/codigo de error y motivo de ciclo de vida permitido.

When the local launcher user presses **Diagnosticar**, the launcher still shows the normal UI result and also writes a persistent support report under the app data folder:

```text
<userData>/diagnostics/
```

On Windows this resolves to a path like:

```text
C:\Users\<usuario>\AppData\Roaming\High Score League\diagnostics\
```

Reports are JSON files named with a safe timestamp, for example:

```text
diagnose-2026-07-03T211422000Z.json
```

The report includes the generation time, launcher version when available, OS/runtime details, `userData`, configured pack directory state, active pack identifiers and paths, MAME/shared-runtime state, diagnostic errors, warnings and recommendations, safe session state, local queue counts, bridge/config source and library totals.

The report is for installation health and support/debugging. It is not the npm development test suite and does not run repository tests.

Sensitive data is minimized and sanitized before writing. Reports must not include Supabase access tokens, refresh tokens, Authorization headers, passwords, cookies or full private score payloads. Session state is stored as non-sensitive summary data such as `hasSession` and a shortened user id when available.

If the report cannot be written, Diagnose should still complete and show a warning that the diagnostic report could not be saved.
