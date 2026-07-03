# Diagnostic logs

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
