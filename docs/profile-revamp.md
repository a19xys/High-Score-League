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

La banda muestra cuatro bloques:

1. victorias, con el total de podios integrado como metadata secundaria;
2. medallas, representadas por `—` y `Próximamente` hasta que exista el sistema;
3. tiempo jugado, visible o privado según `play_time_public`;
4. Presence como indicador de estado, no como una métrica gigante.

Estado presenta punto más `Desconectado`, `Conectado`, `Jugando` u `Oculto`;
`—` queda para indisponibilidad. Al jugar, el nombre canónico aparece en una
segunda línea. El label usa `whitespace-nowrap`, por lo que `Desconectado` no se
parte. `officialResults` se conserva en el modelo competitivo aunque ya no se
renderiza en la banda.

En móvil los cuatro bloques forman una rejilla 2 × 2; en escritorio forman
cuatro columnas. Estado ya no necesita un span compensatorio.

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

El editor es una única superficie con eyebrow `PERFIL` y usa el mismo orden en
todos los tamaños: foto, username/siglas, bio, privacidad y guardar. No existe
un segundo heading `Identidad`. `Foto de perfil` es el label normal del uploader
y sustituye a `Avatar público`. La foto ya no ocupa una columna
lateral; su preview y controles sólo se disponen en fila dentro del propio
subapartado cuando hay espacio. El copy se limita a formatos y máximo de 12 MB,
y Cambiar, Quitar y Deshacer pueden envolver con targets táctiles de 44 px.
Sigue habiendo un solo guardado. El éxito se representa junto al botón con un
check accesible que permanece hasta la siguiente modificación, también en la
misma línea desde 320 px, sin reservar altura en idle. En `MediaUpload`, el
estado `Imagen lista: dimensiones · peso` reemplaza al copy gris; Quitar muestra
su warning en ese mismo slot, nunca ambos mensajes a la vez. Errores y avisos de cleanup siguen siendo texto visible.
`MediaUpload` mantiene preview local, conversión WebP, upload al guardar,
persistencia, cleanup, rollback, invalidación de caché y metadata Auth.

Cuenta agrupa apariencia y un único subapartado `Sesión`. El email aparece con
el contexto `Sesión iniciada con la cuenta:` y las acciones Cerrar sesión y
Eliminar mi cuenta quedan juntas, envolviendo en móvil. Ambas comparten radio,
padding, peso y altura; Eliminar mi cuenta se distingue mediante borde, texto,
hover y foco rojos. El copy permanente redundante desaparece, mientras el modal
conserva toda la explicación de irreversibilidad. El traslado visual no modifica el endpoint, RPC, confirmación,
tombstone, Storage cleanup ni lifecycle de anonimización.

En Administración, `Semana actual` sigue dentro de Accesos, pero es la card
featured: usa identidad circuit, mayor jerarquía interna y ocupa dos unidades
desde el grid de dos columnas. La composición progresa de una a dos, tres y seis
unidades; en escritorio grande Semana actual ocupa dos y Semanas, Temporadas,
Juegos y Cuestionarios una cada una. La ruta y el fallback dependen todavía de
la semana activa real y los warnings permanecen por encima del grid.

## Hover cards e identidades enlazadas

`PlayerPill` enlaza el bloque de identidad cuando existe un username activo y
admite `linkToProfile={false}`. Los tombstones no enlazan. `PlayerHoverCard`
aparece tras 600 ms de intención sostenida en dispositivos con hover. Las
identidades no cambian fondo, sombra, posición ni superficie al apuntarlas, pero
conservan foco visible. El portal deja un gap transparente de 6 px y aplica 220
ms de gracia al salir del trigger o popup; entrar en el popup cancela el cierre.
La primera apertura inicia preview y Presence en paralelo y mantiene un único
skeleton hasta que ambas lecturas concluyen, de modo que bio, métricas y estado
aparecen conjuntamente. Las reaperturas reutilizan en memoria el último
snapshot resuelto de Presence —incluido `null`— y vuelven a consultar el
endpoint no-store en segundo plano, sin loader. Un resultado nuevo se aplica
silenciosamente y un fallo conserva el último snapshot válido. Presence sigue
fuera de la caché de preview y no tiene polling. El popup muestra Victorias,
Podios y Medallas (`—`); la preview ya no consulta resultados oficiales. Para
Presence muestra texto más color para conectado/offline y el juego para
playing; privado, indisponible o fallo se omiten silenciosamente.

El posicionamiento prefiere `bottom-start`; si no cabe horizontalmente usa
`bottom-end` y solo después hace clamp con 12 px de margen. Si falta altura,
aplica el mismo orden arriba. `maxHeight` procede del espacio real del viewport,
no de la altura provisional del skeleton, por lo que la primera apertura puede
crecer sin heredar un scrollbar falso. Teclado, touch, Escape, caché,
tombstones y reduced motion mantienen sus contratos. El bio compartido está
limitado a 150 caracteres y su fallback es `Sin descripción.`.

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

El cuarto bloque `Estado` de `ProfileStats` recibe Presence inicial por SSR y se
actualiza cada 15 segundos mientras el documento está visible. Los estados
visuales son `Jugando`, `Conectado`, `Desconectado` u `Oculto`; un fallo de
lectura conserva el último valor válido o muestra `—`, nunca inventa una
desconexión. `JUGANDO` tiene prioridad sobre conexiones web o launcher y el
detalle del juego siempre procede del `game_id` canónico resuelto en servidor.

La presentación se comparte con las hover cards mediante
`PlayerPresenceIndicator`; no muestra source Web/Launcher. Presence es efímera y su privacidad se presenta como la acción de ocultarla.
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
