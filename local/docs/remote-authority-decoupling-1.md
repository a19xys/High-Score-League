# Remote authority decoupling 1

## Problema anterior

El launcher utilizaba `deploymentKey = build:environment:apiVersion` para dos
responsabilidades distintas: observar qué deployment técnico respondió y
decidir qué conocimiento remoto era compatible. Como `build` suele derivar del
SHA de Vercel, un cambio web sin cambios de contrato separaba las caches Week,
Membership y Ranking, descartaba requests en vuelo e invalidaba el fingerprint
de `Jugar`.

La baseline histórica permanece en
`local/docs/remote-architecture-baseline-1.md`. Sus cifras y su descripción de
`deploymentKey` representan el comportamiento **BEFORE** y no se reescriben.

## Modelo final

La identidad funcional estable es:

```text
origin HTTP(S) exacto
+
authorityKey = launcher-api:1
```

`authorityKey` se deriva localmente de `SUPPORTED_LAUNCHER_API_VERSION`; no
contiene build, environment, deployment ID ni SHA.

La metadata técnica continúa separada:

```text
deployment metadata
  build
  environment
  apiVersion observada
  deploymentGeneration
```

Connectivity sigue incrementando `deploymentGeneration` cuando cambia esa
metadata. Week y Ranking la exponen en Diagnostics, pero no la usan como
barrera de producto. Un cambio compatible A → B no cambia la generación
semántica, no vacía caches y no aborta una respuesta en vuelo.

## Caches v2

Las claves actuales son equivalentes a:

```text
Week
<origin>|launcher-api:1|week:<weekId>

Membership
<origin>|launcher-api:1|user:<userId>|season:<seasonId>

Ranking (solo memoria de proceso)
<origin>|launcher-api:1|<weekId>
```

Build y environment no forman parte de ninguna de ellas. Origin, versión de
API y la identidad propia del recurso sí forman parte. Membership mantiene el
aislamiento por cuenta y temporada; Week y Ranking mantienen el aislamiento por
week.

## Migración v1 → v2

Al inicializar Week o Membership se admite solamente un fichero
`schemaVersion: 1` con claves legacy reconocibles:

```text
<origin>|<build>:<environment>:<apiVersion>|week:<weekId>
<origin>|<build>:<environment>:<apiVersion>|user:<userId>|season:<seasonId>
```

Cada entrada debe tener origin HTTP(S) válido, IDs coherentes con la clave,
`checkedAt` válido, forma concluyente válida para su tipo y API version igual a
la soportada. Entradas incompatibles o corruptas se descartan individualmente.

Si varios builds convergen en la misma clave v2 se conserva la entrada con
`checkedAt` más reciente. Un empate se resuelve de forma determinista por la
clave legacy de origen. La escritura usa la infraestructura atómica existente.
Si no puede persistirse, la inicialización no falla, el fichero anterior no se
trunca y solo las entradas ya validadas se usan en memoria.

No existe migración genérica entre origins. Una entrada de un origin válido se
mantiene bajo ese mismo origin; no se transforma un alias en otro hostname.

## Rolling deployments y validación

Health build A y Week/Ranking build B son compatibles cuando todos declaran
Launcher API v1, el endpoint conserva su contrato v1, el origin solicitado no
cambia y la respuesta pertenece al contexto vigente. Incluso header y body
pueden reflejar metadata de builds diferentes durante el rolling deployment.
Diagnostics registra si la metadata coincide, sin convertir la diferencia en
un fallo funcional.

Continúan fail-closed:

- Launcher API no soportada;
- `payload.version` incorrecta, JSON o estructura inválidos;
- `requestKey` o week incorrectos;
- URL Ranking insegura o de otro origin;
- cambio real de origin, cuenta, pack, week o `reachabilityGeneration`;
- cambio de `authorityKey` contractual.

El preflight de competición congela `activeInstanceKey`, `origin`,
`authorityKey`, `reachabilityGeneration`, `userId` y `weekId`. Build y
environment pueden cambiar durante la operación sin producir
`competition-context-changed`.

## Fuera de alcance deliberado

Esta fase no cambia heartbeat, canaries, topology polling, señales del renderer,
focus refresh, confirmaciones product → Health ni el gate global connected.
Tampoco corrige suspend, crea `/api/launcher/competition-context`, une
Membership y Week, simplifica auto-submit, altera identidades anti-cheat o
decide aliases de dominio. Build/environment y el smoke por SHA permanecen para
QA y diagnóstico.

Los documentos `deployment-fingerprint-1.md`,
`ranking-capability-stability-1.md` y `connectivity-ranking-reliability-2.md`
describen fases históricas previas; este documento sustituye únicamente su uso
de deployment como autoridad funcional.
