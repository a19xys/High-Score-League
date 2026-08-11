# Sistema de perfiles

## Resultado actual

Los perfiles propio y público comparten una identidad visual de acabado arcade:
hero oscuro, avatar protagonista con aro luminoso, bio y una banda compacta de
métricas. La información competitiva se resume en métricas y una tabla de
mejores marcas; ya no existen las cards de marcas ni el bloque de resultados
oficiales recientes.

`/profile` es un centro personal organizado por vistas:

- `Resumen`: hero, métricas, aviso de datos cuando corresponda y mejores marcas;
- `Envíos`: historial privado filtrable por juego;
- `Editar perfil`: avatar, identidad, bio y privacidad en un único formulario;
- `Cuenta`: apariencia, sesión y anonimización;
- `Administración`: accesos de gestión, solo para administradores.

El selector es un tablist accesible. En móvil usa dos columnas y
`Administración`, si existe, ocupa una fila completa; con espacio suficiente usa
cuatro o cinco columnas compactas. Solo se ve un panel a la vez, pero todos
permanecen montados para no perder cambios sin guardar. Las flechas, Home y End
mueven el foco y la selección. El hash (`#resumen`, `#envios`, `#editar`,
`#cuenta`, `#administracion`) conserva el contexto mediante `replaceState` sin
scroll ni nuevas rutas. Los hashes legacy `#trayectoria`, `#editar-perfil` y
`#centro-admin` se resuelven a su vista nueva.

`/players/[username]` sigue siendo una página autenticada de solo lectura. No
recibe tabs privadas, email, envíos privados, edición, cuenta ni administración.

## Arquitectura

- `lib/data/player-profile.ts` agrega identidad y trayectoria competitiva en el
  servidor. `weekly_results` es la fuente canónica de victorias, podios y puesto
  oficial; las submissions válidas aportan participaciones y mejores marcas.
- `lib/profile-best-scores.ts` construye las mejores marcas sobre los datasets ya
  cargados. Usa mapas de semanas, juegos, temporadas y resultados, sin N+1.
- `lib/profile-submission-games.ts` deriva opciones únicas por actividad,
  selección inicial y filtrado cliente del historial privado.
- `lib/profile-sections.ts` normaliza los hashes actuales y legacy.
- `components/profile/profile-section-switcher.tsx` contiene únicamente el
  estado y la accesibilidad de las vistas; las consultas siguen en servidor.
- `components/profile/profile-hero.tsx`, `profile-stats.tsx` y
  `profile-best-scores-table.tsx` forman el resumen compartido.
- `components/profile/profile-submissions-history.tsx` contiene el selector y la
  tabla privada de envíos.
- `components/profile/profile-editor.tsx` conserva un único ciclo de guardado
  para identidad, avatar y privacidad.
- `components/profile/profile-account-settings.tsx` conserva apariencia, sesión
  y la zona de peligro de cuenta.
- `components/profile/admin-profile-center.tsx` presenta warnings y accesos como
  una superficie normal, sin hero propio.
- `components/profile/public-profile-view.tsx` compone exclusivamente datos
  públicos.

## Resumen y métricas

La banda muestra cuatro métricas reales:

1. victorias;
2. podios;
3. participaciones;
4. tiempo jugado, visible o privado según `play_time_public`.

Una quinta posición muestra `Estado —`. Es solo una reserva visual para
`PROFILE-PRESENCE-1`: no existen heartbeat, online/offline, última actividad ni
juego actual, y no se infieren desde Playtime. `officialResults` se conserva en
el modelo competitivo para consumidores internos, aunque ya no se renderiza en
la banda.

En móvil las métricas forman dos columnas y Estado ocupa ambas; en escritorio
forman cinco columnas. Las ayudas extensas se ocultan en anchos reducidos.

## Avatar protagonista

El avatar grande de `/profile` y `/players/[username]` usa un aro específico con
gradiente cónico cyan, teal, violeta y fuchsia. Dos capas independientes rotan
con `transform`; la foto o las siglas permanecen inmóviles. El efecto no se
aplica a `PlayerPill`, chat, tablas, hover cards, editor ni avatares pequeños.
Con `prefers-reduced-motion: reduce` el aro sigue visible pero no gira.

## Mejores marcas

La tabla compartida contiene `Puesto`, `Juego` y `Mejor marca`. La celda de juego
enlaza a `/weeks/[weekId]` y añade `Semana N · Temporada`. El agregado selecciona
el mejor score válido de cada semana, añade el `rank` de `weekly_results` cuando
existe y muestra `—` si la semana no tiene resultado oficial. La tabla usa layout
fijo, puesto y score compactos y juego flexible con truncado, por lo que funciona
desde 320 px.

## Historial privado de envíos

La vista `Envíos` usa solo las submissions ya cargadas del propietario. Las
opciones se deduplican y se ordenan por la actividad más reciente del usuario;
la selección inicial es el juego de su submission más reciente. `Todos los
juegos` queda disponible al final como opción secundaria. Cambiar el juego
vuelve la paginación a la página 1. Sin submissions se muestra `EmptyState` y no
un selector vacío.

El filtrado es cliente. Después se conserva el pipeline compartido completo:
decoración, intentos, mejor/visibilidad, orden, clamp, paginación y, al final,
slots visuales. El perfil público nunca recibe este dataset.

## Editor y cuenta

El editor es una única superficie. En móvil ordena foto, identidad, bio,
privacidad y guardar; en escritorio coloca la foto en una columna lateral
compacta y los campos en la principal. Sigue habiendo un solo guardado.
`MediaUpload` mantiene preview local, conversión WebP, upload al guardar,
persistencia, cleanup, rollback, invalidación de caché y metadata Auth.

Cuenta agrupa apariencia, email/sesión y zona de peligro. El traslado visual no
modifica el endpoint, RPC, confirmación, tombstone, Storage cleanup ni lifecycle
de anonimización.

## Hover cards e identidades enlazadas

`PlayerPill` enlaza el bloque de identidad cuando existe un username activo y
admite `linkToProfile={false}`. Los tombstones no enlazan. `PlayerHoverCard`
aparece tras intención sostenida en dispositivos con hover, usa portal,
posicionamiento contra viewport, caché corta y endpoint autenticado. Teclado,
Escape y reduced motion mantienen sus contratos. El bio compartido está limitado
a 150 caracteres y su fallback es `Sin descripción.`.

## Avatar administrado

`ProfileAvatarEditor` reutiliza `MediaUpload`: valida JPEG/PNG/WebP, procesa a
WebP en el navegador, previsualiza y sube al guardar bajo
`avatars/<USER_ID>/<UUID>.webp`. Solo limpia el objeto anterior después de
confirmar la persistencia y revierte objetos nuevos ante fallo.
`avatar_storage_path` es la referencia canónica y `avatar_url` conserva
compatibilidad legacy. Consulta [media uploads](media-uploads.md).

## Privacidad y Playtime

El registro identificado de Playtime está separado de su visibilidad pública.
El propietario ve su agregado; otro jugador solo lo recibe cuando
`play_time_public = true`. `track_play_time` es legacy. Playtime no representa
presencia, última actividad ni ranking.

## PROFILE-ANONYMIZATION-1

`0027_profile_anonymization.sql` está aplicada correctamente en Supabase remoto.
El schema, endpoint `POST /api/profile/anonymize` y zona de peligro están
operativos. El QA destructivo exhaustivo con una cuenta desechable fue diferido
deliberadamente por decisión del usuario; no es un bloqueo documental ni exige
reaplicar la migración.

La baja irreversible conserva UUID e historia competitiva, crea un tombstone no
interactivo, reserva el username mediante huella, retira datos personales,
Playtime, avatar y privilegios, y hace soft-delete de Auth. Un tombstone no puede
recrear el perfil ni usar las operaciones protegidas. El último administrador
activo no puede anonimizarse. El texto libre histórico no se reescribe salvo el
mensaje de sistema exacto documentado.

El preflight de solo lectura se conserva en
`supabase/preflight/0027_profile_anonymization.sql` para instalaciones o
verificaciones futuras. `0028_player_presence.sql` es la migración posterior
deliberada para Presence y no modifica la historia de 0027.

## PROFILE-PRESENCE-1

La quinta celda `Estado` de `ProfileStats` recibe Presence inicial por SSR y se
actualiza cada 15 segundos mientras el documento está visible. Los estados
visuales son `JUGANDO`, `CONECTADO`, `DESCONECTADO` y `PRIVADO`; un fallo de
lectura conserva el último valor válido o muestra `—`, nunca inventa una
desconexión. `JUGANDO` tiene prioridad sobre conexiones web o launcher y el
detalle del juego siempre procede del `game_id` canónico resuelto en servidor.

Presence es efímera y su privacidad se presenta como la acción de ocultarla.
Desde `0029_profile_privacy_defaults.sql`, `presence_public` vale `true` para
perfiles nuevos; los valores históricos no se migran porque no hay una señal
fiable que distinga privacidad elegida del antiguo default. Web y launcher
emiten heartbeats independientes cada 30 segundos y el servidor solo considera
vivas las filas de los últimos 90 segundos. No se publica última conexión,
historial, número de dispositivos, vía de conexión ni timestamps.
Playtime continúa siendo histórico/acumulativo y las submissions continúan
siendo la autoridad competitiva: ninguno se usa para inferir Presence.

## Roadmap y limitaciones

`PROFILE-PRESENCE-1` queda implementado sin “última actividad” ni historial por
diseño. Una presencia de baja latencia mediante Realtime, dots en avatares o
actividad social requeriría una tarea posterior.

- La paginación privada sigue siendo cliente sobre el conjunto ya cargado;
  `SUBMISSIONS-SERVER-PAGINATION-1` queda para un volumen futuro.
- No hay Storage privado de evidencias ni panel admin completo de usuarios.
- El archivo de mejores marcas depende de lo visible según RLS y estado de la
  semana.
