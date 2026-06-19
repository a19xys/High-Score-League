# LOCAL-SEASON-MEMBERSHIP-CHECK-2

Estabilizacion y diagnostico seguro de la comprobacion local de participacion
en temporada.

## Por que existe

`LOCAL-SEASON-MEMBERSHIP-CHECK-1` anadio la comprobacion previa contra la web.
Despues de desplegar el endpoint, la GUI seguia mostrando estados demasiado
genericos como:

```text
No se pudo comprobar la participacion
```

Eso no permitia distinguir una sesion invalida, un `weekId` incorrecto, una
respuesta HTML/404, un error 500 o un problema de red.

Esta segunda tarea no cambia el modelo competitivo. Solo hace la comprobacion
mas estable, explicita y depurable sin exponer secretos.

## Estados

La app local normaliza estos estados:

```text
member          -> Participas
not_member      -> No participas
no_session      -> Sin cuenta
unauthenticated -> Sesion no valida
missing_week    -> Falta weekId
invalid_week    -> Semana no valida
error           -> Error de comprobacion
unknown         -> No se pudo comprobar
```

`member` permite jugar competicion y subir pendientes.

`not_member`, `no_session`, `unauthenticated`, `missing_week` e `invalid_week`
bloquean competicion y subida. Practicar sigue disponible.

`error` y `unknown` permiten jugar competicion con la puntuacion guardada en
local, pero bloquean la subida hasta poder verificar la participacion.

## unauthenticated

`unauthenticated` significa que la sesion local no es valida para la web:

- falta o falla el Bearer token;
- Supabase rechaza el token;
- el endpoint devuelve HTTP 401;
- la sesion guardada no se puede refrescar.

La GUI lo muestra como:

```text
Sesion no valida
La sesion no es valida. Cierra sesion e inicia sesion de nuevo.
```

## error y unknown

`error` significa que hubo respuesta de la web pero la comprobacion fallo, por
ejemplo HTTP 500 o una respuesta no JSON/HTML.

`unknown` se reserva para casos donde no se pudo completar o interpretar la
comprobacion, por ejemplo error de red o configuracion incompleta.

## Detalles tecnicos

En:

```text
Herramientas de desarrollo > Detalles tecnicos
```

la GUI muestra la comprobacion de temporada:

```text
Estado
URL consultada
HTTP status
Body status
Body ok
Mensaje
Motivo tecnico
Comprobado
WeekId
SeasonId
```

La URL consultada tiene este formato:

```text
<webBaseUrl>/api/local/season-membership?weekId=<weekId>
```

La URL no contiene tokens y se puede mostrar para diagnosticar si la app esta
llamando a `localhost`, al deploy correcto o a otro `webBaseUrl`.

Si la respuesta no es JSON, la GUI no guarda ni muestra el HTML completo. El
estado tecnico usa:

```text
non_json_response
```

Si la respuesta esta vacia, usa:

```text
empty_response
```

## Probar el endpoint sin token

Abrir en el navegador:

```text
https://high-score-league.vercel.app/api/local/season-membership?weekId=<weekId>
```

La respuesta esperada sin `Authorization` es:

```json
{
  "ok": false,
  "status": "unauthenticated",
  "message": "Necesitas una sesion valida."
}
```

Eso confirma que el endpoint responde JSON y que no acepta llamadas sin sesion.

## Si siempre aparece No se pudo comprobar

Revisar en detalles tecnicos:

- `URL consultada`: confirma `webBaseUrl` y `weekId`.
- `HTTP status`: distingue 404, 500, 401 o ausencia de respuesta.
- `Body status`: muestra `member`, `not_member`, `unauthenticated`,
  `invalid_week`, `error`, `non_json_response` o `empty_response`.
- `Motivo tecnico`: resume el fallo sin volcar HTML ni secretos.

Luego usar:

```text
Comprobar de nuevo
```

La accion recalcula solo la membership del pack activo. No hace polling, no
escanea todos los packs y no sube puntuaciones.

## Seguridad

No se muestran ni guardan en el estado renderer:

- `access_token`;
- `refresh_token`;
- cabecera `Authorization`;
- `session.json` completo;
- password;
- `service_role`;
- Supabase anon key.

La app local si usa el access token en el proceso principal para llamar al
endpoint, pero el renderer solo recibe estado normalizado y detalles seguros.

## Limites

No se implementa en esta tarea:

- unirse a temporada desde la app;
- selector de cuentas;
- auto-sync;
- polling continuo;
- deep link;
- cambios en payload;
- cambios en plugin MAME;
- cambios en scoped queue;
- migraciones nuevas;
- cambios de RLS;
- `service_role`.
