# LOCAL-COMPETITION-INTEGRITY-SCOPE-FIX-1

Este cierre conserva todos los contratos de Integridad ya congelados y corrige
únicamente la reconstrucción durable de scoped queues.

## Autoridad Protected durable

Un scope Protected contiene:

```text
<scopedQueueRoot>/competition/scope-authority.json
```

El schema v1 guarda sólo `mode=protected_v2`, `playerKey`, `packKey`, `packId`,
`weekId` y `establishedAt`. No contiene identidad cruda, URLs ni secretos. Se
crea una vez con temporal, sync y rename cuando el launcher dispone del Pack
Contract v2 completo. Una autoridad existente se valida y nunca se reemplaza
por legacy; cualquier contradicción falla cerrado.

Discovery transporta `competitionMode=protected_v2` hasta
`buildScopedSubmitConfig()`. Por ello borrar evidence, cambiar el evento o
retirar/mover el pack después de capturar no transforma un pending protegido en
legacy. El finalizer y recovery verifican la misma autoridad antes de publicar
outputs.

## Migración y ambigüedad

Un scope anterior al fix puede crear la autoridad sin red cuando todos sus
finalized-run receipts locales son canónicos y coinciden con pack, week y
player binding de `meta.json`. Si existe `competition/` pero falta/corrompe la
authority y no hay señal concluyente, discovery clasifica el scope como
Protected inválido: no envía, no borra eventos y no degrada a legacy. Un scope
sin subtree competitivo continúa siendo legacy.

## Autoridad remota

`meta.pack.webBaseUrl` se conserva sólo como metadata histórica o de
diagnóstico. Nunca se copia a `config.webBaseUrl`. Submission y membership usan
exclusivamente `hslOrigin`, `webBaseUrl` y `remoteConfiguration` resueltos por el
launcher. Así, tanto `.vercel.app` histórico como un origin externo declarado
por un pack reciben cero requests y ningún Bearer.

## Metadata crash-safe

`meta.json` se actualiza mediante un temporal en el mismo directorio, escritura
completa, sync, cierre y rename atómico; después se intenta sincronizar el
directorio. Un fallo antes del rename conserva el meta anterior o deja ausente
el destino inicial, nunca JSON parcial. Discovery omite metadata corrupta sin
eliminar pending; un contexto completo posterior puede repararla atómicamente.

## Límites

No se añaden requests, timers, polling, caches remotas, migraciones, cambios
WEB/RLS ni nuevos schemas de evidence, receipt, close seal, pack o plugin.
Space Invaders continúa en `space-invaders-s1-w1-r2`, MAME en 0.287, plugin en
0.4.0 y launcher source en 0.3.0.
