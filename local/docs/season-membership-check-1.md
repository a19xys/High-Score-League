# LOCAL-SEASON-MEMBERSHIP-CHECK-1

Comprobacion inicial de participacion en temporada antes de jugar en modo
competicion desde la app local.

## Fuente de verdad

La autoridad sigue estando en la web y Supabase:

- `weeks.season_id` identifica la temporada de la semana del pack.
- `season_memberships` indica si el usuario autenticado participa.
- Solo `status = active` permite competir y enviar puntuaciones.
- La app local usa la sesion Supabase del usuario; no usa ni necesita
  `service_role`.

El endpoint de ingest mantiene su propia comprobacion final. Esta tarea solo
anade una comprobacion previa para mejorar la UX local y evitar partidas de
competicion claramente no enviables.

## Endpoint local-web

La web expone:

```text
GET /api/local/season-membership?weekId=<weekId>
Authorization: Bearer <access_token>
```

Respuestas principales:

- `member`: el usuario participa; puede jugar competicion y subir pendientes.
- `not_member`: el usuario no participa; competicion y subida quedan
  bloqueadas, con enlace a la temporada web.
- `invalid_week`: el `weekId` no existe; competicion bloqueada.
- `unauthenticated`: la sesion no es valida; competicion bloqueada.
- `error`: fallo controlado de comprobacion; la app local puede permitir jugar
  competicion con aviso, pero no debe subir puntuaciones.

El endpoint consulta con la anon key y el token del usuario, por lo que respeta
RLS y no devuelve tokens al cliente renderer.

## Cliente local

`local/hsl-local-app/src/season-membership.js` encapsula la comprobacion y
normaliza estados para la GUI:

- `canPlayCompetition`: controla el boton `Jugar competicion`.
- `canSubmit`: controla `Subir pendientes`.
- `message`: texto amigable para el jugador.
- `technicalReason`: detalle para herramientas de desarrollo.
- `joinUrl`: URL web para abrir la temporada o unirse.

Estados bloqueantes para competicion:

```text
no_session
missing_week
invalid_week
not_member
unauthenticated
```

Estados desconocidos o de red no bloquean la partida de competicion, porque el
jugador podria estar temporalmente sin conexion. En esos casos la GUI avisa de
que la puntuacion quedara local y bloquea la subida hasta poder verificar.

## GUI

La pantalla principal muestra una insignia de participacion junto al pack
activo:

- `Participas`
- `No participas`
- `Sin cuenta`
- `Semana no valida`
- `No se pudo comprobar`

`Jugar competicion` queda deshabilitado cuando la comprobacion conoce un estado
bloqueante. `Practicar` sigue disponible porque no es competicion. `Subir
pendientes` queda deshabilitado si `canSubmit` no es verdadero.

Cuando la respuesta incluye `joinUrl`, la GUI muestra una accion secundaria:

```text
Unirse desde la web
Abrir temporada en la web
```

La accion abre el navegador desde el proceso principal de Electron. El renderer
solo recibe estado normalizado y nunca recibe access tokens ni refresh tokens.

## Limites

- No cambia el endpoint de ingest.
- No cambia el payload de submissions.
- No cambia `duplicateKey`.
- No cambia la cola scoped por cuenta y pack.
- No cambia el plugin MAME.
- No cambia `config.json`.
- No implementa auto-submit.
- No implementa cache persistente de membership.

La accion actual de actualizar estado de la GUI vuelve a consultar la
membership porque la comprobacion no se cachea de forma persistente.

## Diagnostico posterior

`LOCAL-SEASON-MEMBERSHIP-CHECK-2` estabiliza la normalizacion de errores y anade
detalles tecnicos seguros para diagnosticar la comprobacion sin exponer tokens:

```text
URL consultada
HTTP status
Body status
Body ok
Mensaje
Motivo tecnico
WeekId
SeasonId
```

Ver [`season-membership-check-2.md`](season-membership-check-2.md).
