# Playtime live en perfiles web

Los perfiles conservan el Playtime obtenido durante el renderizado de servidor como primera autoridad visual. Tanto `/profile` como `/players/[username]` siguen resolviendo el total antes de renderizar; no hay skeleton, estado de carga ni sustitución del SSR por una lectura cliente.

Cuando el resumen está montado, `ProfileLiveStats` mantiene los snapshots SSR de Playtime y Presence y activa un único lifecycle de refresco. Ambos datos comparten una sola cadencia visible de 15 segundos, el refresh inmediato al recuperar foco o volver a una pestaña visible, el guard de request en curso y el mismo cleanup. Una pestaña oculta no conserva polling. Las dos lecturas se resuelven de forma independiente dentro de cada tick, por lo que un fallo de Presence no impide aplicar un Playtime válido, ni al contrario.

La lectura estrecha `GET /api/players/[username]/playtime` es dinámica y `no-store`. Requiere una sesión y un perfil visitante activos, valida el username y resuelve el perfil objetivo no anonimizado con el cliente Supabase autenticado. No usa service role. El propietario puede leer su total aunque `play_time_public` sea falso; para terceros privados, la aplicación devuelve `private` antes de consultar `player_play_time_totals`, además de conservar RLS como segunda barrera.

El contrato distingue explícitamente estos casos:

- consulta correcta sin fila agregada: total visible de `0`, presentado como `No jugado`;
- error de lectura o transporte: no es cero y el cliente conserva el último snapshot válido;
- respuesta privada válida: sustituye inmediatamente cualquier cifra anterior;
- respuesta visible válida: sustituye el estado privado y también acepta correcciones que reduzcan el total.

Las respuestas cliente se validan antes de actualizar el estado. Una respuesta mal formada, un `503` o una excepción no causan un falso cero ni un flash de carga. Un `AbortController`, el guard de generación y el estado disposed impiden que una respuesta tardía actualice otro perfil o un componente desmontado.

Esta convergencia usa polling acotado al perfil montado. No añade Supabase Realtime, WebSockets, SSE, polling global ni `router.refresh()`.
