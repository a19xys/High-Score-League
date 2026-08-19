# Playtime live en perfiles web

Los perfiles conservan el Playtime obtenido durante el renderizado de servidor como primera autoridad visual. Tanto `/profile` como `/players/[username]` siguen resolviendo el total antes de renderizar; no hay skeleton, estado de carga ni sustitución del SSR por una lectura cliente.

Cuando el resumen está montado, `ProfileLiveStats` mantiene los snapshots SSR de Playtime y Presence y activa un único lifecycle de refresco. Ambos datos comparten una sola cadencia visible de 15 segundos y los mismos triggers de foco y `visibilitychange`; no existe un segundo timer ni un mecanismo paralelo. Una pestaña oculta no conserva polling.

Dentro de ese lifecycle hay dos lanes independientes. Presence y Playtime tienen cada una su propio estado `inFlight`, generación, `AbortController` y timeout determinista de 10 segundos. Un tick intenta avanzar ambas: si una sigue en vuelo no duplica esa request, mientras la otra sí puede ejecutar su siguiente pasada. Cada respuesta válida se aplica en cuanto llega, sin esperar a la otra lane. Un timeout aborta solo su lane, conserva el último snapshot válido y la deja disponible para el siguiente trigger. El cleanup invalida las dos generaciones, aborta sus requests, libera sus esperas y elimina intervalo, timeouts y listeners.

La lectura estrecha `GET /api/players/[username]/playtime` es dinámica y `no-store`. Requiere una sesión y un perfil visitante activos, valida el username y usa el cliente Supabase autenticado; no usa service role.

Identidad del perfil no anonimizado, `play_time_public` y el agregado autorizado se leen en una única operación PostgREST relacional `profiles -> player_play_time_totals`. La FK/PK existente permite que PostgreSQL evalúe privacidad y agregado en una sola snapshot lógica, con RLS como autoridad. No hay una lectura de privacidad seguida de otra lectura del total, de modo que un cambio concurrente de privacidad no puede mezclar estados temporales y producir un falso `No jugado`. No fue necesaria una migración, RPC, `SECURITY DEFINER` ni bypass de policies.

El propietario puede leer su total aunque `play_time_public` sea falso. Para un tercero privado, la misma fila de snapshot determina `private` y la relación queda además protegida por RLS.

El contrato distingue explícitamente estos casos:

- consulta correcta sin fila agregada: total visible de `0`, presentado como `No jugado`;
- error de lectura o transporte: no es cero y el cliente conserva el último snapshot válido;
- respuesta privada válida: sustituye inmediatamente cualquier cifra anterior;
- respuesta visible válida: sustituye el estado privado y también acepta correcciones que reduzcan el total.

Las respuestas cliente se validan antes de actualizar el estado. Una respuesta mal formada, un `503` o una excepción no causan un falso cero ni un flash de carga. Los `AbortController`, guards de generación por lane y el estado disposed impiden que una respuesta tardía actualice otro perfil, otra generación o un componente desmontado.

Esta convergencia usa polling acotado al perfil montado. No añade Supabase Realtime, WebSockets, SSE, polling global ni `router.refresh()`.
