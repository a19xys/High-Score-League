# Remote architecture baseline 1

> Este documento describe el comportamiento anterior a la simplificación de la arquitectura remota.
>
> Los timers, contadores, coordinadores y dependencias descritos aquí **NO son requisitos que deban preservarse**.
>
> Los únicos contratos a preservar están marcados explícitamente como **Product invariants**.

## Alcance y baseline Git

- Tarea: `LOCAL-REMOTE-ARCHITECTURE-BASELINE-1`.
- HEAD local auditado: `a003ddd5a5d717ff4230f93ba4a1fb2923b762d6` (`a003ddd Cerrar hardening`).
- Rama local: `master`.
- El HEAD coincide con el HEAD remoto observado en el encargo. No se hizo `fetch`, reset, checkout, rebase ni ninguna operación externa.
- Estado inicial del árbol: ya había cambios del usuario en `.env.example`, `app/layout.tsx`, `app/page.tsx`, `components/auth/forgot-password-form.tsx`, `docs/auth-setup.md`, `docs/deploy-checklist.md`, `docs/supabase-setup.md`, `lib/auth/password-recovery.ts`, `scripts/check-launcher-api.mjs`, `tests/launcher-ranking-capabilities.test.mts`, `tests/password-recovery.test.mts`, y ficheros nuevos en `docs/canonical-domain-1.md`, `lib/site-origin.ts`, `tests/canonical-domain.test.mts`. Esta tarea no los modifica.
- Versión del launcher observada y preservada: `0.3.0`.

## Método y significado de las cifras

Se usaron tres clases de evidencia:

- **MEASURED**: servicios de producción instanciados con reloj, `setTimeout`/`setInterval`, red, sesión y cache in-memory deterministas. La harness imita únicamente el fan-out explícito de la suscripción de Connectivity en `gui/main.js`; no importa Electron ni hace red real.
- **STATICALLY DERIVED**: lectura del grafo y del orden de `gui/main.js`, `gui/launcher-service.js` y servicios relacionados, contrastada con los tests existentes.
- **NOT MEASURED**: latencia real, orden de carreras dependiente de I/O, spawn real de MAME, Electron real y tráfico contra servicios desplegados.

La harness usa respuestas instantáneas. Por ello, el número de requests de servicios single-flight, especialmente Presence, es una medición reproducible de esta fixture, no una predicción independiente de latencia. Ningún test nuevo fija `30 health`, `50 presence` o cualquier otra cifra como contrato.

Las ventanas idle empiezan después de converger el startup en `t=0` y cubren `(0, 600000 ms]`. Por tanto:

- startup aporta 1 health;
- idle aporta 30 heartbeats;
- los primeros 10 minutos desde apertura suman 31 health;
- la cifra contractual es **ninguna** de las anteriores.

El contador `timerCallbacks` cuenta callbacks que llegaron a ejecutarse. No cuenta deadlines creadas y canceladas antes de disparar.

## Resumen numérico

| Escenario | Evidencia | Health | Membership | Week | Ranking | Presence | Profile | Playtime | Submission | Topology inspections | Timer callbacks |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| startup online | MEASURED | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 1 | 0 |
| idle foreground 10 min | MEASURED | 30 | 0 | 9 | 0 | 50 | 2 | 0 | 0 | 600 | 669 |
| idle background 10 min | MEASURED | 30 | 0 | 9 | 0 | 50 | 2 | 0 | 0 | 600 | 669 |
| SO offline 5 min, incluido `t=0` | MEASURED | 0 HTTP / 69 intentos lógicos | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 301 | 383 |
| SO online, HSL unreachable 5 min, incluido `t=0` | MEASURED | 69 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 301 | 383 |
| offline → online | MEASURED | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 1 |
| resume tras 2 min | MEASURED | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 1 |
| focus con estado fresco | MEASURED | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| focus con health y Week stale | MEASURED | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

En SO offline, las 301 inspecciones de topología incluyen el poll inicial. En idle post-startup son 600 polls. En la medición offline se ejecutan 68 canaries después del intento inicial; cada uno se evita antes de HTTP al ver `net.isOnline() === false`.

## Grafo actual de triggers

```text
Electron ready
  ├─ initializeRemoteServices
  │    ├─ Presence.start                         (timer 30 s)
  │    ├─ Week.initialize                       (cache durable + boundary timer)
  │    ├─ Connectivity subscription
  │    └─ service diagnostics provider
  ├─ Connectivity.start("startup")              (health)
  ├─ NetworkTopology.start                      (poll inmediato + cada 1 s)
  ├─ local session migration + Week initialize
  │    ├─ Presence.setActiveUserId
  │    ├─ Playtime.initialize
  │    └─ requestPlayTimeSync("startup-local-ready")
  ├─ session-maintenance cada 60 s
  └─ renderer initial state
       └─ syncRemoteContext
            ├─ Presence.setActiveUserId si cambia cuenta
            ├─ Ranking.updateContext + refresh
            ├─ Week.updateContext + refresh
            ├─ MembershipStartupCoordinator.observeState
            └─ PendingAutoSubmit.request

Cada emisión de Connectivity
  ├─ Ranking.updateDeployment
  ├─ Week.updateDeployment
  ├─ Presence.setOnline
  ├─ MembershipStartupCoordinator.updateConnectivity
  └─ si reachability === connected
       ├─ AccountProfileSync.request
       ├─ PlaytimeSync.request
       ├─ Ranking.refresh
       ├─ Week.refresh
       └─ si acaba de conectar: PendingAutoSubmit.request
```

La suscripción usa `isCommittedConnected`, que solo mira `reachability === "connected"`; no exige que `activity !== "suspended"` ni que el probe esté idle.

### Relaciones inversas y ciclos

```text
Week transport failure ───────────────┐
Ranking timeout/temporary failure ────┤
Membership transport failure ─────────┤
Auto-submit transport failure ────────┤
                                      v
                         Connectivity.refresh(force)
                                      │
                                      v
                         emisión de Connectivity
                                      │
                                      v
        Profiles / Playtime / Ranking / Week / Membership / Presence
```

Los callbacks de producto no pueden marcar Connectivity como connected: solo piden una confirmación health. Renderer `online`, `offline` y `navigator.connection.change` también son hints; Main vuelve a comprobar `net.isOnline()` y/o health.

## Trigger lógico ≠ request remota

La diferencia es observable en idle online. Cada heartbeat exitoso produce actualmente tres emisiones comprometidas: inicio del probe, resultado y programación del siguiente heartbeat. En 30 heartbeats:

| Consumidor | Triggers lógicos medidos | HTTP medido | Por qué difieren |
| --- | ---: | ---: | --- |
| Profiles | 90 | 2 | single-flight + freshness de 5 min; requests en los límites de 5 y 10 min |
| Playtime | 90 | 0 | la cuenta no tiene eventos de playtime pending |
| Ranking | 90 | 0 | resultado concluyente conservado durante la sesión, sin TTL |
| Week | 90 desde Connectivity | 9 autónomos | freshness/single-flight; timer a `checkedAt + 60001 ms` |
| Membership connectivity update | 90 | 0 | el contexto ya tiene terminal para esa generación |
| Presence `setOnline` | 90 | parte de 50 | single-flight; los 50 incluyen además 20 heartbeats propios |
| Auto-submit maintenance | 10 | 0 | inspecciona una cola vacía |

## Inventario de actividad autónoma

| Fuente | Política actual | Activa / detiene | Foreground / background | Trabajo local | HTTP / fan-out |
| --- | --- | --- | --- | --- | --- |
| Network topology | `os.networkInterfaces()` cada 1 s, con fingerprint SHA-256 | Main ready; stop suspend/shutdown; restart resume | igual | normaliza, ordena, serializa y hashea | solo un cambio real llama Connectivity; sin cambios, 0 HTTP |
| Connectivity heartbeat | 20 s activo y 20 s background | después de health OK; suspend/stop cancela | igual en este HEAD | timers, estados, generaciones | health GET; un fallo de heartbeat obtiene una confirmación inmediata adicional |
| Connectivity recovery | 3 s durante 60 s; 5 s hasta 5 min; después ciclo limitado por `[10,20,30,60] s` | al quedar offline; conexión/suspend/stop lo sustituye/cancela | igual | `net.isOnline()` y scheduler | si SO offline evita HTTP; si SO online hace canary health con timeout 1 s |
| Renderer signals | eventos `online`, `offline`, `navigator.connection.change` | vida del renderer | igual | debounce positivo 150 ms | pide Connectivity; no confirma reachability por sí mismo |
| Presence heartbeat | 30 s | `start`; suspend/shutdown limpia timer; resume rearma | no cambia por blur | timer + resolución de cuenta/sesión | POST best-effort si connected, cuenta activa y client id |
| Week freshness | `maxAgeMs=60000`; one-shot a `checkedAt + maxAgeMs + 1` | context/init/refresh; suspend/stop cancela; resume rearma | igual | reevalúa cache y calendario | POST batch solo para Week stale |
| Week calendar boundary | próximo `publicStartAt` o `finalDeadlineAt` | entrada durable; suspend/stop cancela | igual | puede cambiar estado derivado sin servidor | si connected fuerza refresh en boundary; offline solo reemite derivación durable |
| Week retry | exponencial 5 s hasta 5 min | fallo no cancelled/stale; éxito/context reset | igual | timer y estado retry | POST; fallo puede pedir health confirmation |
| Ranking unknown retry | 20 s, 60 s, 120 s; después no arma otro timer | solo entradas unknown; conclusive cancela necesidad | igual | cache Map y timer | POST batch; no hay TTL de conclusive |
| Pending auto-submit maintenance | Main cada 60 s | ready; solo shutdown limpia interval | sigue existiendo durante suspend | enumera cuentas/sesiones/colas y aplica guards | solo Membership/Submission si hay pending y readiness |
| Pending session retry | Retry-After o 30/60/120/300/900 s | deferral de sesión; cancel/shutdown limpia | igual | un timer para deadlines de varias cuentas | vuelve a inspeccionar y puede refrescar Auth |
| Pending submission cooldown | 30/60/120/300/900 s, pero sin timer propio | resultado retryable | igual | guarda `nextEligibleAt` | necesita otro trigger (p. ej. maintenance) para reintentar |
| Account Profiles freshness | 5 min, sin timer autónomo | requests de Connectivity/login | igual | compara cache, batch de cuentas, archivos avatar | REST batch si stale/force; avatar solo si cambió/falta |
| Playtime retry/backoff | sin timer; `retryNotBefore` desde Retry-After | startup/account/connectivity/MAME close | igual | enumera stores pending | POST por evento pending; otro trigger reintenta |
| Membership startup | sin polling; deadlines de connectivity y remote | snapshot deferred, reconnect/resume/manual | igual | terminal cache acotada en memoria | un GET por `account|instance|week|reachabilityGeneration` |
| Session/Auth | sin timer global propio | cualquier consumidor que necesita token | igual | token policy, locks, revisión, backoff por usuario | refresh POST solo al resolver una sesión próxima a expirar/no usable |

### Trabajo local periódico medido

En los dos idle de 10 min:

- 600 llamadas a `networkInterfaces()` y 600 fingerprints.
- 0 cambios reales de topología y 0 probes derivados de topología.
- 669 callbacks: 600 topología + 30 Connectivity + 20 Presence + 10 session maintenance + 9 Week freshness.
- Foreground y background son numéricamente iguales en este HEAD.

En los 5 min offline/unreachable:

- 301 inspecciones de topología, incluido startup.
- 0 cambios reales de fingerprint.
- 68 callbacks de recovery, 10 de Presence, 5 de maintenance y 300 polls posteriores al inicial: 383 callbacks.

## Inventario HTTP

| Propósito | Método / endpoint lógico | Trigger | Bearer | Timeout | Retry owner | Idempotencia / dedupe |
| --- | --- | --- | --- | ---: | --- | --- |
| Health | GET `/api/launcher/health` | startup, heartbeat, recovery, focus, renderer/topology/product hints, manual/Jugar | no | 3 s; canary/confirmación 1 s | Connectivity | single-flight; GET |
| Membership | GET `/api/local/season-membership?weekId=…` | coordinator, manual, auto-submit pre-check | HSL bearer | 15 s por request y deadline coordinator | nuevos triggers/generación; Auth puede reintentar una vez tras 401 | coordinator dedupe por identidad/generación |
| Week Capability | POST `/api/launcher/week-capabilities` | context/connectivity/focus/freshness/boundary/retry/preflight | no | 4 s | Week | single-flight, batch, lectura idempotente |
| Ranking Capability | POST `/api/launcher/ranking-capabilities` | context/connectivity/unknown retry/dev force | no | 4 s | Ranking | single-flight, batch; conclusive cache process-session |
| Presence | POST/DELETE `/api/launcher/presence` | startup/account/connectivity/30 s/activity/resume/shutdown | HSL bearer | 10 s | no retry propio; siguiente trigger | single-flight; identidad estable `clientId`; best-effort |
| Playtime | POST `/api/launcher/playtime/ingest` | startup/account/connectivity/MAME close | HSL bearer | 15 s | trigger externo + `retryNotBefore` | evento durable; backend devuelve NEW/DUPLICATE |
| Submission | POST `/api/submissions/ingest` | auto-submit o CLI explícito | HSL bearer | 15 s | Pending coordinator / maintenance | `duplicateKey`; success y duplicate son ACK terminal |
| Profile | GET Supabase `/rest/v1/profiles?...` | Connectivity, login/account mutation | bearer Supabase + apikey | 15 s | siguiente trigger | single-flight, freshness 5 min, un batch de IDs |
| Avatar storage | GET Supabase `/storage/v1/object/public/hsl-public-media/...` | profile cambió o falta cache | bearer Supabase + apikey | 15 s | siguiente profile sync | hash de fuente + fichero local; máx. 2 MiB |
| Avatar legacy | GET URL HTTP(S) validada | profile legacy cambió/falta | no | 15 s | siguiente profile sync | máx. 3 redirects, SSRF checks, cache hash |
| Supabase Auth | POST `/auth/v1/token?grant_type=refresh_token` | token policy / 401 canónico | apikey; refresh token en body | 15 s | repository session backoff | single-flight por usuario; nunca más de un refresh por authenticated request |

La harness solo registra categoría, método y URL sanitizada. Elimina credenciales de URL y sustituye todos los valores de query por `[redacted]`; nunca conserva headers, body, email, token, apikey o password.

## Escenarios

### A — startup online

**MEASURED** en fixture determinista; orden Electron exacto **STATICALLY DERIVED**.

| Métrica | Valor |
| --- | ---: |
| Connectivity emissions | 3: probe startup, resultado, scheduler |
| Health | 1 |
| Membership | 1 |
| Week | 1 |
| Ranking | 1 |
| Profile REST | 1 |
| Presence | 1 |
| Playtime | 0 HTTP / 2 triggers desde emisiones connected |
| Auto-submit | 0 HTTP / 2 triggers (`startup`, `state-ready`) |
| Topology | 1 inspección y fingerprint inicial |

El orden parcial real es: construir servicios → empezar Presence/Week cache → empezar Connectivity y Topology → migrar sesiones/inicializar Playtime → publicar estado inicial → Membership/Week/Ranking/Profile/Presence/auto-submit convergen. Las promesas de sesión/Week, health y renderer pueden intercalarse; por eso no se afirma un orden total entre los seis requests de producto.

Tiempo de convergencia real: **NOT MEASURED**. En la fixture todos los responses son instantáneos y convergen en el mismo tiempo lógico `t=0`, cifra que no representa producción.

### B/C — idle online foreground/background, 10 min

**MEASURED**. No hay diferencias en este HEAD.

| Métrica | Foreground | Background |
| --- | ---: | ---: |
| Health HTTP | 30 | 30 |
| Presence HTTP | 50 | 50 |
| Week HTTP | 9 | 9 |
| Profile REST | 2 | 2 |
| Ranking / Membership / Playtime / Submission / Auth / Avatar | 0 | 0 |
| Connectivity emissions | 90 | 90 |
| Profile / Playtime / Ranking / Week triggers por emissions | 90 cada uno | 90 cada uno |
| Membership connectivity updates | 90 | 90 |
| Auto-submit maintenance triggers | 10 | 10 |
| Topology inspections | 600 | 600 |
| Timer callbacks | 669 | 669 |

Los 50 Presence son 20 heartbeats propios y, con respuestas instantáneas, 30 requests coalescidas por los 30 ciclos health. Con latencia real, single-flight puede coalescer coincidencias de forma distinta.

### D — SO claramente offline, 5 min

**MEASURED** desde `t=0`.

- 69 intentos lógicos de Connectivity: startup + 68 recovery callbacks.
- 0 health HTTP; cada intento se corta por `net.isOnline() === false`.
- 138 inspecciones de `net.isOnline()` porque el path actual lo consulta en `refresh` y de nuevo en `confirmSystemOffline`.
- 0 requests de producto.
- Ranking/Week reciben una solicitud lógica de launcher-state pero el gate offline evita HTTP.
- Auto-submit recibe `state-ready` y 5 maintenance triggers; queda deferred `offline`.
- UI/authority: Connectivity `offline`; Membership no inventa member; Week solo puede exponer autoridad durable offline.

### E — SO online, HSL inalcanzable, 5 min

**MEASURED** desde `t=0`, con fallo DNS instantáneo.

- 69 health HTTP fallidos: startup; cada 3 s hasta 60 s; cada 5 s desde 65 s hasta 300 s.
- 69 transport failures; 0 heartbeat confirmations, porque nunca llegó a connected.
- 207 emisiones de Connectivity: probe, settle offline y scheduler por cada intento.
- 0 requests de producto: el fan-out connected queda evitado.
- 68 canary wakeups y 69 inspecciones de `net.isOnline()`.
- No hubo product-triggered confirmations porque ningún producto llegó a hacer HTTP en este escenario estable.

### F — offline → online

**MEASURED** tras un hint `renderer-online` y debounce de 150 ms.

| Fan-out | Triggers lógicos | HTTP |
| --- | ---: | ---: |
| Connectivity | 1 | 1 health |
| Presence `setOnline` | 3 emissions | 1 POST |
| Profile | 2 | 1 REST |
| Playtime | 2 | 0, sin pending |
| Ranking | 2 | 1 POST |
| Week | 2 | 1 POST |
| Membership | 3 updates | 1 GET |
| Auto-submit | 1 | 0, cola vacía |

Las dos solicitudes de producto proceden de las emissions de resultado y scheduler; sus servicios las deduplican/frenan por freshness.

### G — suspend → resume

Acciones de suspend **STATICALLY DERIVED**:

- aborta `productOperationsController`;
- suspende Week, pausa Playtime recorder y cancela Playtime sync;
- suspende Presence, cancela Profile, Membership manual/startup, sesiones y auto-submit;
- intenta un drain de sesiones de 2 s;
- detiene Topology;
- suspende Connectivity y cancela su timer/probe.

Resume **MEASURED** después de 2 min suspendido:

- 1 Week POST al estar stale;
- 1 Presence POST;
- 1 health tras debounce `resume`;
- 1 poll inmediato de Topology;
- 0 Ranking, Membership, Profile, Playtime y Submission HTTP en el contexto ya conclusive/sin pending;
- Connectivity emite 5 veces: cambio a active + scheduler, y probe + resultado + scheduler.

Discrepancia actual importante: el interval de `session-maintenance` no se detiene en suspend. Además, `setActivity("suspended")` conserva `reachability="connected"`; la propia emisión puede volver a solicitar Profile/Playtime/Ranking desde el subscriber. Week y Presence tienen gate de suspend, pero Ranking no tiene API de suspend y Profile/Playtime se cancelan antes de esa emisión. No se corrigió en esta tarea.

### H — focus

**MEASURED** con heartbeat apartado para aislar el trigger.

- fresh: Connectivity comprueba `net.isOnline()` pero hace 0 health; Week hace 0 HTTP por freshness; Ranking no se refresca desde el handler de focus.
- stale: 1 health, 1 Week POST y 1 Presence POST derivado de las emisiones Connectivity; Ranking 0.
- En ejecución normal el heartbeat de 20 s hace muy improbable superar `focusStaleMs=90 s` sin suspend/fallo, pero el handler mantiene el path.
- Blur solo cambia activity a background; los intervalos connected active/background son ambos 20 s.

### I — Jugar online

**STATICALLY DERIVED** y cubierto por tests existentes.

```text
Jugar
  → prepareRemoteAction("play-preflight", force=true)
      → 1 health si Connectivity ya estaba committed connected
  → rechazar si Membership coordinator/manual sigue activo y no hay entitlement estable
  → leer estado local con Membership deferred/reutilizada
  → runCompetitionPlayPreflight
      → congelar fingerprint {account, pack, week, origin, deploymentKey, reachabilityGeneration}
      → Week.ensureFreshCapability(force=true)
          → 1 POST Week aunque la entrada estuviera fresh
      → releer estado y fingerprint
      → bloquear si response no es autoritativa/ACTIVE o cambió contexto
  → service.playCompetition({confirmedCompetition, expectedCompetitionAttempt})
      → reutiliza Membership y Week confirmadas
      → readiness y cola local
      → preparar captura
      → spawn MAME
```

En el camino estable actual hay 1 health preventivo y 1 Week autoritativa antes del spawn; no se repite Membership si el coordinator ya terminó. La petición estrictamente autoritativa para decidir la semana es Week; health es una duplicación preventiva/gate de transporte actual. La autoridad final de la puntuación seguirá siendo `/ingest`.

Si health cambia Connectivity a offline, preflight entra en el camino durable offline; no se afirma que health sea un requisito de producto.

### J — Jugar offline

**STATICALLY DERIVED**, protegido por `competition-play-preflight.test.js` y caches tests.

- Connectivity no committed: `prepareRemoteAction` no hace request.
- Preflight no llama Week remota y pasa las autoridades actuales a `playCompetition`.
- Con Membership durable `member`, Week durable `active/offline-durable`, sesión y pack/captura/scope locales válidos, MAME puede lanzarse con 0 HTTP.
- Sin Membership o Week durable concluyente, `competitionAccess`/readiness bloquea; offline nunca crea una conclusión nueva.
- Práctica usa `deferRemoteMembership` y no depende de Connectivity.

### K — score pending + reconnect

**STATICALLY DERIVED** y protegido por pending/submission tests.

Para un score, una cuenta y un scope:

```text
connected transition
  → PendingAutoSubmit.request("connectivity-restored")
  → inspect remembered accounts + canonical sessions + queue revisions
  → runPendingAutoSubmitForAccounts
  → checkSeasonMembership()                         1 GET
  → si member/canSubmit
       → submitAll()
       → POST /api/submissions/ingest               1 POST por score
       → success o duplicate ACK
       → mover pending → sent
```

Sí: Membership se comprueba antes de `/ingest`. El backend vuelve a consultar `season_memberships` antes de insertar. Esto es **CURRENT DEFENSIVE DUPLICATION**, no Product invariant. El servidor es la autoridad de persistencia.

`duplicateKey` es `hsl:v1:` + SHA-256 de `hsl|v1|weekId|userId|rom|score|detectedAt|source|mameVersion|pluginVersion`. El backend consulta `(player_id, duplicate_key)`, devuelve duplicate si el evento canónico coincide y conflicto terminal si no coincide; también resuelve la carrera de unique violation.

### L — cambio de cuenta

**STATICALLY DERIVED**.

- `withMembershipContextMutation` invalida coordinator/manual Membership, Profile sync, pending service y coordinator.
- Presence limpia por DELETE la cuenta anterior antes de conectar la nueva; el `requestGeneration` descarta resultados antiguos.
- Session revision y active account cambian; repositorios y refresh backoff están aislados por userId/provider.
- `syncRemoteContext` cambia `activeUserId`, pide Presence para la nueva cuenta y Playtime `account-change`.
- Membership context key contiene account, instance, week y reachability generation.
- Profile filtra rows por IDs esperados y cancela el run anterior; auto-submit guard incluye user, queue revision y session revision.
- Launcher state revisions y competition fingerprint impiden publicar/usar respuesta de otra cuenta.

### M — cambio de pack

**STATICALLY DERIVED**.

- invalida Membership startup/manual y auto-submit en curso;
- Ranking/Week recalculan fingerprint por origin/deployment/lista de week IDs, incrementan generation y abortan request anterior;
- Membership key incluye `activeInstanceKey` y week;
- competition attempt incluye `activeInstanceKey`, week, account, origin, deployment y reachability generation;
- auto-submit vuelve a descubrir scopes; queue revision/packKey separan colas;
- Presence no envía un evento específico de pack mientras está connected; el week aparece cuando MAME publica `playing`.

## Matriz de retries

| Operación | Owner | Retryable | Backoff / jitter | Límite | Abort | Wakeup | Idempotencia |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Connectivity | Connectivity | health transport/timeout/status/contract | connected: heartbeat 20 s; offline 3/5/10-60 s; `retryBackoffMs` con 15% jitter existe para retry path | sin máximo total | supersede, suspend, origin change, stop | timers + renderer/topology/product/focus/resume | GET |
| Membership | coordinator + caller | unknown/error/auth deferred/transport/timeout | sin backoff propio; una identidad por reachability generation | cache attempted 64; deadline 3 s waiting + 15 s remote | context/account/pack/connectivity/suspend/shutdown | new snapshot/generation/resume/manual/auto-submit | GET; Auth wrapper máx. dos intentos de producto por 401 |
| Week | Week | timeout, temporary y HTTP; no cancelled/stale | 5 s exponencial hasta 5 min, sin jitter | delay cap, sin attempt cap | context, suspend, stop, 4 s timeout | freshness/boundary/retry/connectivity/focus/preflight | POST de lectura, single-flight |
| Ranking | Ranking | solo unknown no conclusive | 20/60/120 s, sin jitter | 3 retries programables tras fallo inicial | context/deployment/stop, 4 s timeout | timer/connectivity/dev force | POST de lectura, single-flight |
| Session/Auth | session repository | 429, 5xx, timeout, transient | 30/60/120/300/900 s; respeta Retry-After hasta 15 min; sin jitter | delay cap; sin timer autónomo | account/suspend/shutdown/caller | próximo consumidor o auto session timer | refresh single-flight por usuario; un refresh después de 401 |
| Pending submissions | coordinator | transport, timeout, 408/425/429/5xx/ambiguous | cooldown 30/60/120/300/900 s; Retry-After mínimo 5 s/máx. 15 min; sin timer genérico | delay cap | account/pack/suspend/shutdown/context generation | maintenance, reconnect, score, session timer, resume | duplicateKey y ACK duplicate |
| Playtime | Playtime sync | transport/timeout/throttled/server/auth | solo `retryNotBefore` de Retry-After; sin timer | sin attempt cap | account/suspend/shutdown | startup/account/connectivity/MAME close | eventId; NEW/DUPLICATE |
| Presence | no retry específico | fallo best-effort | siguiente heartbeat 30 s o trigger; sin jitter | no aplica | timer se detiene; resultado stale se ignora | heartbeat/account/connectivity/activity/resume | clientId + estado actual; single-flight |
| Profile | no retry específico | cualquier fallo del run | siguiente trigger; freshness 5 min no es backoff | no aplica | account/suspend/shutdown | Connectivity/login/account mutation | single-flight, batch y avatar identity hash |

Un fallo Week/Ranking/Membership/auto-submit puede activar un retry en otra capa: una confirmación health. No convierte la respuesta de producto en autoridad Connectivity.

## Matriz de caches

| Recurso | Memoria | Durable | Key actual | Freshness | Stale usable | Invalidadores | Autoridad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Membership | cache object por `userDataDir`; terminal coordinator acotada | `competitive-authority/season-memberships.json` | origin + deploymentKey + userId + seasonId | sin TTL destructivo | member/not_member durable; `canSubmit=false`, revalidation required | origin/deployment/account/season key; mutations olvidan terminal coordinator | endpoint Membership; `/ingest` decide persistencia |
| Week | estado, last results, timers | `competitive-authority/week-capabilities.json` | origin + deploymentKey + weekId | 60 s para autoridad online | sí offline si conclusive; calendario puede derivar inactive/closed | context origin/deployment/week, suspend/stop; old entries quedan aisladas | endpoint Week + límites temporales durables |
| Ranking | `Map` process-session | no | origin + deploymentKey + weekId | conclusive sin TTL | sí para display; abrir URL exige connected | context/deployment/stop | endpoint Ranking |
| Profiles/avatar | `lastCompletedAt`, run single-flight | known accounts + `accounts/avatars/<playerKey>` | userId; avatar identity hash de storage/legacy source | 5 min | sí, metadata/fichero previos | force login/account, remote change, forget/remove | Supabase Profiles/Storage |
| Session | repository state, in-flight, backoff | canonical encrypted session + revision ledger por player | provider fingerprint + userId + sessionRevision | refresh recomendado ≤60 s; uso absoluto >5 s | sesión local puede existir; token no usable no sale remoto | login/logout/remove/provider mismatch/revision/tombstone | proveedor Supabase + canonical repository |
| Playtime | recorder y sync state | stores por player con summary/pending/failed | playerKey + eventId/gameKey | no TTL | pending sí | ACK/terminal reject; account isolation | servidor ACK, store local hasta entonces |
| Library state | snapshot authority por scope | directorios/selection/preferences del launcher | packDirectoryFile o userDataDir/appDir; pack instance/duplicate keys | hasta invalidate/refresh explícito | snapshot sí durante lecturas | rescan, location/pack mutations | filesystem y contratos del pack |

Las colas de submissions no son un cache: son estado durable de producto separado por player/pack con `pending`, `sent`, `failed` y `rejected`.

## Deployment identity

El servidor construye:

```text
build = VERCEL_GIT_COMMIT_SHA[0..12]
     || VERCEL_DEPLOYMENT_ID
     || HSL_BUILD_VERSION
     || "unknown"

environment = VERCEL_ENV || NODE_ENV || "development"
apiVersion = 1
deploymentKey = `${build}:${environment}:${apiVersion}`
```

Papel actual:

- health entrega los tres campos en headers; Connectivity incrementa `deploymentGeneration` si cambia el key;
- Week/Ranking exigen coincidencia health ↔ headers ↔ body; build solo se compara si ambos lados lo conocen, environment/apiVersion siempre;
- Week durable y Membership durable incluyen deploymentKey en su autoridad; Ranking memory cache también;
- cambios reales de key reemplazan context, abortan/inutilizan in-flight y fuerzan revalidación;
- competition fingerprint incluye deploymentKey, origin y reachability generation;
- Week conserva un key durable previo para hidratar un health todavía unknown, pero no lo trata como deployment confirmado hasta observar metadata compatible.

Esto es implementación actual, no Product invariant. En particular, acoplar autoridad durable al SHA/deployment es candidato de simplificación posterior.

## Estado técnico → estado visible

| Estado técnico | Presentación visible actual |
| --- | --- |
| Connectivity unknown | “Conexión sin comprobar” |
| probe startup/checking | “Comprobando conexión” |
| connected | “Conectado” |
| retry/manual in-flight | “Reconectando” |
| offline | “Sin conexión”; recuerda práctica y seguridad local |
| suspended | “Comprobación en pausa” |
| Membership checking con identidad viva exacta | “Comprobando participación” |
| member | “Participas en la temporada” |
| not_member | “No participas en la temporada” + acción web |
| unknown/error | “No se pudo consultar la participación” |
| auth deferred | “Comprobación aplazada” |
| Week active | competencia disponible si el resto del access está listo |
| Week closed/inactive/unlinked | preflight: semana cerrada/todavía no activa/no vinculada; práctica permitida |
| Week unknown/stale-error online | “No se pudo confirmar que la semana siga activa”; bloquea Jugar online |
| auto-submit syncing | “Sincronizando”; copy explicita que sigue local |
| pending temporal/offline | “Envío aplazado…” o “Pendiente de sincronizar” |
| failed/attention | “Requiere atención” |
| synced/empty | “Sincronizado” / “Sin pendientes” |
| session requiresLogin | “Vuelve a iniciar sesión” |
| session deferred auto-recoverable con sesión local | visible como “Sesión activa”, con recovery técnico silencioso |

El header público proyecta Connectivity de forma binaria (`Conectado`/`Desconectado`) aunque Diagnostics conserve estados técnicos más ricos.

## Diagnóstico existente

`remoteDiagnostics` ya reúne, sin infraestructura nueva:

- Connectivity: request/heartbeat/confirmation/dedup/transport counters, generations, scheduler, deployment, timings renderer, origin/config, remote availability;
- Topology: poll interval/count, generation, fingerprint hash, interface/address counts y último error/cambio/probe;
- Ranking: cache/conclusive/unknown, request/deployment, transitions, retry timer;
- Week: capabilities, cache path, context/deployment, last request/preflight/failure/success, retry/timer;
- Membership coordinator: scheduled/requests/completed/aborted/discarded, attempts/terminals/timer;
- auto-submit: service + coordinator guards, cooldown/session timers y estado;
- Profile, Playtime, Presence, sessions/repository/backoff, score capture, session storage, startup milestones y window focus/minimize.

`Diagnose` guarda un informe sanitizado y ya incluye partes de Connectivity, Ranking, Week, Playtime y score capture. La harness reutiliza las APIs `getDiagnostics`; no añade telemetría, analytics, endpoint ni tracking.

## Product invariants

Esta es la única sección contractual del documento. `CONFIRMED` significa que el HEAD y tests actuales ya sostienen la garantía. `QUALIFIED` registra una discrepancia que una refactorización no debe ocultar ni convertir retroactivamente en “comportamiento garantizado”.

| Invariante de producto | Estado en este HEAD | Evidencia / matiz |
| --- | --- | --- |
| Práctica no depende de red | CONFIRMED | `playPractice` difiere Membership y no usa Connectivity |
| Una puntuación capturada localmente no se pierde por fallo de red | CONFIRMED | adopción/cola durable; transport/timeout preservan pending |
| El flujo automático solo saca pending por ACK idempotente o clasificación terminal explícita | QUALIFIED | submit automático cumple; CLI `mark-sent` puede mover manualmente sin ACK y debe tratarse como excepción operativa, no garantía automática |
| `duplicateKey` protege idempotencia | CONFIRMED | hash estable; lookup previo y manejo de unique race en backend |
| El servidor es autoridad final de submissions | CONFIRMED | autentica, revalida perfil, week, membership, ventana, idempotencia e inserta |
| Respuestas de otra cuenta/pack/week/origin no contaminan el contexto | CONFIRMED | generations, revisions, scoped keys y fingerprints |
| Cambiar cuenta invalida trabajo remoto stale | CONFIRMED | abort/cancel/revision/user keys; Presence/profile/session guards |
| Cambiar pack invalida trabajo remoto stale | CONFIRMED | context generations, membership/competition fingerprints y queue scopes |
| Suspend/shutdown cancela trabajo remoto sensible | QUALIFIED | shutdown sí; suspend cancela muchas capas, pero la emisión still-connected puede despertar Profile/Playtime/Ranking y Ranking carece de suspend; Presence invalida resultado sin abortar explícitamente su controller activo |
| Offline no inventa conclusión remota nueva | CONFIRMED | no product HTTP; solo autoridad durable/calendario conservador |
| Jugar online no lanza tras Week autoritativamente unavailable | CONFIRMED | preflight forced + re-read + fingerprint antes de launch |
| Jugar offline solo usa conocimiento durable previo | CONFIRMED | branch offline no refresca y access bloquea unknown |
| Presence no es requisito para jugar | CONFIRMED | lifecycle best-effort compuesto, no readiness gate |
| Ranking no es requisito para competir | CONFIRMED | capability de ranking solo gobierna abrir ranking |
| Fallo Presence/Ranking no bloquea captura ni submissions | CONFIRMED | servicios separados; no forman parte de access/submit readiness |
| Bearer HSL y sesiones mantienen aislamiento actual | CONFIRMED | canonical session por user/provider; HSL bearer solo en requests autenticadas; renderer no recibe fetch/token |
| Un 401 no produce refresh infinito | CONFIRMED | authenticated request permite exactamente un refresh y un segundo intento |
| Pack import permanece independiente | CONFIRMED | servicio/lifecycle separado; fuera del grafo competitivo auditado |
| Windows Update permanece independiente | CONFIRMED | servicio y lifecycle separado |
| Colas locales sobreviven restart/crash según contratos actuales | CONFIRMED | filesystem scoped, writes/renames atómicos y tests de durability/restart |

Para refactorizaciones posteriores, las dos filas `QUALIFIED` requieren una decisión explícita: preservar solo la garantía automática ya real o elevar el comportamiento deseado mediante otra tarea con cambio de producto y tests apropiados.

## Mapa y clasificación de tests existentes

| Área / tests | Clasificación | Garantía principal |
| --- | --- | --- |
| `connectivity-service.test.js`, `network-topology-monitor.test.js` | CURRENT ARCHITECTURE / MIXED | timers/canaries/heartbeat son históricos; stale probes, origin y no-false-connected son invariantes |
| `remote-reliability-integration.test.js`, `connectivity-ranking-integration.test.js` | MIXED | hints no adquieren autoridad y renderer no obtiene fetch son producto; fan-out/health confirmation es arquitectura |
| `membership-startup-coordinator.test.js`, `membership-startup-main-integration.test.js` | MIXED | coordinator/deadlines son arquitectura; identidad, stale rejection y gate de Jugar son producto |
| `season-membership.test.js`, `membership-authority.test.js` | PRODUCT INVARIANT / MIXED | auth isolation, durable member, no invented membership, 401 bounded; endpoint separado es actual |
| `week-capabilities-service.test.js`, `competitive-authority-cache.test.js` | MIXED | 60 s/retry/deployment key son arquitectura; durable offline, calendar safety y stale rejection son producto |
| `ranking-capabilities-service.test.js` | MIXED | retry/session cache es arquitectura; URL/origin/deployment response isolation es producto |
| `competition-play-preflight.test.js`, `competition-week-launch-integration.test.js` | PRODUCT INVARIANT | online conclusive gate, offline durable, fingerprint, no stale spawn |
| `competition-authority-integration.test.js` | MIXED | health-before-Jugar es arquitectura; closed/failed Week blocks y lifecycle spawn son producto |
| `pending-auto-submit-coordinator.test.js`, `pending-auto-submit.test.js` | MIXED | exact cooldown/maintenance ownership es arquitectura; queue/session guards y non-terminal preservation son producto |
| `submission-service.test.js`, `submission-outcome.test.js`, `submission-auth-integration.test.js` | PRODUCT INVARIANT | durability, terminal classification, idempotency, auth and retry preservation |
| `multi-account-background-submit.test.js`, `scoped-queue.test.js` | PRODUCT INVARIANT | cuentas/scopes no se cruzan y retry de una cuenta no contamina otra |
| `playtime-sync-service.test.js`, `playtime-store.test.js`, `playtime-exit-convergence.test.js` | PRODUCT INVARIANT / MIXED | durability/ACK/stale cancellation son producto; triggers concretos son arquitectura |
| `presence-service.test.js` | MIXED | 30 s y Connectivity trigger son arquitectura; best-effort, account isolation y no coupling con Playtime son producto |
| `account-profile-sync.test.js` | MIXED | 5 min es arquitectura; safe URL/path, user isolation, old-avatar preservation son producto |
| `session-refresh-policy.test.js`, `session-lifecycle-integration.test.js`, `authenticated-request.test.js` | PRODUCT INVARIANT / MIXED | provider/user isolation, bounded 401, drains son producto; delays exactos son arquitectura |
| `account-membership-connectivity-presentation.test.js`, `product-presentation.test.js` | MIXED | copy actual es arquitectura visible; no false checking/account warning authority es producto |

Ejemplos que deben sobrevivir conceptualmente: offline usa autoridad durable, stale response no lanza MAME, una cuenta/pack no consume respuesta de otro, network failure no consume pending, duplicate ACK converge, segundo 401 termina.

Ejemplos reemplazables: heartbeat necesita confirmación inmediata, canary cada 3/5 s, Week caduca exactamente a 60 s, MembershipStartupCoordinator posee el startup, deployment `build-b` cambia exactamente una generation.

## Nueva harness

- `test/support/remote-architecture-baseline-harness.js`: fake clock completo, red fake, cache Week in-memory, servicios reales, fan-out explícito de Main, request recorder sanitizado y escenarios.
- `test/remote-architecture-baseline.test.js`: verifica terminación, coherencia, clasificación, sanitización, 0 in-flight y drenaje de timers; solo usa comparaciones relacionales/no-contractuales para las cifras.
- No importa `gui/main.js`.
- No usa Electron, MAME, producción, Supabase, Vercel, R2 ni red del host.

## Complexity candidates for later removal

| Candidato | Problema que intentaba resolver | Garantía que protege hoy | Otra frontera posible, sin diseño definitivo |
| --- | --- | --- | --- |
| Topology polling 1 s | detectar cambios que los eventos no notifican | recuperación y offline rápido | SO/renderer hints + request on demand |
| Health heartbeat global | saber disponibilidad global | no operar remoto contra HSL caído | cada operación clasifica su propio transporte |
| Offline recovery canaries | recuperar sin interacción | eventual reconnect | eventos SO/focus/operación pendiente |
| Renderer online/offline duplication | capturar señales web | wakeup rápido | un único adapter Main |
| `navigator.connection` signals | interfaces móviles/cambio | wakeup | eventos `online`/SO o demanda |
| Product failure → health loop | separar fallo dominio/transporte | no dejar connected stale | clasificación local por request y estado menos global |
| Global connected gates | evitar requests inútiles | offline no inventa autoridad | guards por operación/autoridad durable |
| deployment SHA in cache authority | evitar mezclar deployments incompatibles | stale response isolation | contract/schema/origin identity estable |
| Membership startup coordinator | serializar startup y stale responses | identity + bounded checking | contexto competitivo canónico/on-demand |
| Membership + Week separadas | autoridades con ciclos distintos | member + active antes de Jugar | frontera de contexto competitivo posterior |
| Week freshness 60 s | detectar cierre/apertura | online no lanza tras cierre | preflight autoritativo + boundary local |
| Manual Membership orchestration | feedback/recheck explícito | no race con startup | misma operación canónica de contexto |
| reachabilityGeneration coupling | rechazar responses cruzando reconnect | stale isolation | operation/context token propio |
| auto-submit Membership pre-check | no POST si localmente no member | ahorro/feedback defensivo | autoridad backend `/ingest` |
| session-maintenance wakeup 60 s | reintentar colas/sesiones | eventual delivery | timers propiedad de cola/sesión o eventos |
| Connectivity-driven Presence | publicar estado tras reconnect | eventual presence | Presence posee reconnect/heartbeat |

No se propone ni crea `/api/launcher/competition-context`; no se unen Membership y Week en esta baseline.

## Limitaciones y no medido

- Electron real, BrowserWindow, focus del SO y carreras reales de startup: **NOT MEASURED**.
- Latencia/consumo CPU/nanosegundos: **NOT MEASURED**; solo frecuencia y fan-out.
- Requests Presence bajo latencia real: **NOT MEASURED**; single-flight puede reducir el conteo frente a la fixture instantánea.
- Spawn real MAME y captura end-to-end durante esta tarea: **NOT MEASURED**; cadena **STATICALLY DERIVED** y cubierta por tests existentes.
- Cambio de cuenta/pack y pending real en filesystem: **STATICALLY DERIVED**; no se mutaron datos reales.
- Avatar fetch: 0 en la fixture porque el perfil no declara avatar; política **STATICALLY DERIVED**.
- Auth refresh: 0 en la fixture porque el token es usable; política/retries **STATICALLY DERIVED** y cubierta por tests.
- Ninguna cifra proviene de producción ni de una instancia Electron real.

## Validación de esta baseline

| Validación | Resultado |
| --- | --- |
| `node --test test/remote-architecture-baseline.test.js` | 6 tests, 6 pass, 0 fail, 0 cancelled, 0 skipped |
| 14 suites focales relacionadas | 192 tests, 192 pass, 0 fail, 0 cancelled, 0 skipped |
| `npm test` | 1108 tests, 1094 pass, 0 fail, 0 cancelled, 14 skipped |
| `git diff --check` | exit 0; solo warnings informativos LF→CRLF sobre cambios preexistentes del usuario |

Suites focales ejecutadas: `connectivity-service`, `network-topology-monitor`, `week-capabilities-service`, `ranking-capabilities-service`, `competition-play-preflight`, `membership-startup-coordinator`, `membership-startup-main-integration`, `pending-auto-submit-coordinator`, `pending-auto-submit`, `submission-service`, `playtime-sync-service`, `presence-service`, `account-profile-sync` y `session-refresh-policy`.

Ficheros añadidos por esta tarea:

- `local/docs/remote-architecture-baseline-1.md`;
- `local/hsl-local-app/test/remote-architecture-baseline.test.js`;
- `local/hsl-local-app/test/support/remote-architecture-baseline-harness.js`.

No se modificó código productivo ni el comportamiento distribuible. No se tocaron backend, `app/api/**`, Supabase, RLS, migrations, R2, Cloudflare, updater, packs, import, deep links, schemas ni versión. No se ejecutaron `dist:win`, `smoke:packaged`, despliegues, workflows, GitHub, releases ni operaciones externas.

No se ejecutó `git add`, `git commit`, `git push` ni `git tag`.
