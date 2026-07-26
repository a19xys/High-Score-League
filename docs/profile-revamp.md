# PROFILE-REVAMP-1: sistema de perfiles

## Resultado y concepto visual

Los perfiles usan una misma tarjeta de jugador de acabado arcade moderno: hero
oscuro con trama sutil, avatar protagonista, siglas y username, seguido de una
única banda de métricas reales. La trayectoria se presenta como una combinación
de lista de resultados oficiales y archivo de mejores marcas; no como una
colección de tarjetas equivalentes.

`/profile` usa navegación por anclas (`Resumen`, `Trayectoria`, `Editar perfil`,
`Cuenta` y, cuando corresponde, `Administración`). Las anclas conservan el
destino al recargar, funcionan sin JavaScript de estado y evitan una sidebar
permanente en móvil. `/players/[username]` comparte hero, métricas, trayectoria,
avatar y estados vacíos, pero no recibe datos ni controles privados.

## Arquitectura

- `lib/data/player-profile.ts`: agrega identidad pública y trayectoria
  competitiva. `weekly_results` es la fuente canónica de victorias, podios y
  resultados oficiales; `submissions` válidas aporta participaciones y mejores
  marcas.
- `components/profile/profile-hero.tsx`: cabecera compartida de identidad.
- `components/profile/profile-avatar.tsx`: avatar con fallback de siglas también
  cuando la imagen remota falla.
- `components/profile/profile-stats.tsx`: banda compartida de métricas reales.
- `components/profile/profile-history.tsx`: resultados y mejores marcas; añade
  los envíos recientes únicamente en el perfil propio.
- `components/profile/profile-navigation.tsx`: navegación interna accesible del
  perfil propio.
- `components/profile/profile-editor.tsx` y
  `profile-avatar-editor.tsx`: edición y encapsulación del mecanismo de avatar.
- `components/profile/profile-account-settings.tsx`: apariencia, sesión y
  explicación de conservación histórica.
- `components/profile/admin-profile-center.tsx`: accesos administrativos
  separados del rendimiento personal.
- `components/profile/public-profile-view.tsx`: composición pública sin datos
  internos.
- `components/profile-dashboard.tsx`: composición del centro personal y
  onboarding; ya no contiene edición, avatar, historial y administración en un
  único componente monolítico.

## Datos del perfil propio

Se muestran:

- avatar o fallback de siglas;
- siglas, username, bio y fecha de incorporación;
- victorias oficiales;
- podios oficiales;
- participaciones en semanas con actividad válida o resultado oficial;
- cantidad de resultados oficiales;
- resultados oficiales recientes;
- mejor score válido por semana;
- envíos recientes propios, incluidos los que RLS permite ver solo al dueño;
- email únicamente dentro del bloque privado de sesión;
- preferencia real `track_play_time` como permiso de recopilación;
- tema Claro, Oscuro o Sistema;
- centro admin solo si `is_admin` es real.

Si el perfil no puede crearse desde metadata, la sesión se conserva y aparece un
onboarding centrado en completar username y siglas. No se dibujan métricas
vacías ni placeholders de sistemas futuros.

## Datos del perfil público

La consulta de identidad solo selecciona `id`, `username`, `initials`,
`avatar_url`, `bio` y `created_at`. El `id` se usa únicamente en servidor para
agregar la trayectoria y nunca se renderiza.

La vista muestra identidad, fecha de incorporación, métricas oficiales,
resultados recientes y mejores scores públicos. No selecciona ni envía al árbol
público email, `is_admin`, `track_play_time`, preferencias Auth o timestamps
internos de actualización.

Las mejores marcas públicas excluyen submissions inválidas y submissions
ocultas mientras la semana no esté `closed` o `published`. Este filtro se aplica
además de RLS, incluso si un jugador abre su propio username mediante la ruta
pública. Los errores de Supabase se convierten en estados genéricos sin mensajes
técnicos.

La ruta sigue dentro de la liga privada: sin sesión devuelve `AccessRequired` y
un username inexistente o inválido devuelve 404.

## Enlaces desde identidades

`PlayerPill` enlaza por defecto todo el bloque de identidad y admite
`linkToProfile={false}` para contextos incompatibles. Solo crea el enlace si hay
username, usa `encodeURIComponent`, conserva truncado/fallback y expone nombre
accesible y foco visible.

La misma navegación se aplica a leaderboards, clasificaciones, podios,
resultados oficiales, historial visible, ganadores de archivos y autores del
chat. Ningún enlace de jugador se anida dentro de otro anchor.

## Avatar actual

`avatar_url` sigue siendo compatible con todas las imágenes existentes. El
editor prioriza preview y fallback; el campo URL vive dentro de la acción
`Cambiar imagen mediante URL`, por lo que la composición definitiva no depende
visualmente de un input desnudo. Dejarlo vacío recupera las siglas. No existe un
botón de subida falso.

La frontera `ProfileAvatarEditor` permite reemplazar el control URL por un
uploader futuro sin rediseñar el editor ni los perfiles.

## Privacidad actual

`track_play_time` significa permiso para recopilar tiempo de juego. No controla
visibilidad pública, presencia, estado jugando ni última conexión. Esos cuatro
conceptos se mantienen separados:

1. recopilación de tiempo;
2. visibilidad pública del tiempo;
3. presencia online/jugando;
4. última actividad.

No se muestran controles sin persistencia. La vista pública no consulta
`track_play_time` y no hay presencia ni tiempo ficticio.

## Tareas futuras

### PROFILE-PRIVACY-1

Diseñar y persistir controles independientes para visibilidad del tiempo,
presencia, última conexión y, si el producto lo aprueba, actividad reciente o
estadísticas concretas. La presencia necesitará heartbeats web/launcher,
timestamp de último heartbeat, expiración explícita, Realtime o polling y reglas
RLS. Una última conexión no debe inferirse de actividad exacta del launcher. La
tarea debe decidir defaults, migración, semántica y qué datos se excluyen en
servidor; ocultarlos con CSS no es suficiente.

### PROFILE-ANONYMIZATION-1

Diseñar la baja preservando `submissions`, `weekly_results`, memberships,
posiciones, puntos y estadísticas históricas. Debe anonimizar o retirar username,
avatar, bio, email/Auth, preferencias, presencia, última conexión y cualquier
dato privado, e impedir nuevo acceso.

Antes de usar `auth.admin.deleteUser()` hay que resolver integridad referencial,
identificador público estable, username anónimo único, representación `Usuario
eliminado`, chat, votos, auditoría admin, confirmación, periodo de gracia y
reversibilidad. El endpoint físico continúa bloqueado y esta tarea no añade
botones destructivos ni migraciones.

### MEDIA-UPLOADS-1

Crear un sistema transversal para avatar, imágenes de juegos, headers, logos,
opciones de cuestionarios, capturas futuras y otros assets administrables. Debe
incluir backend de archivos (previsiblemente Supabase Storage), buckets y RLS,
MIME permitidos, peso y dimensiones máximas, compresión/redimensionado,
sustitución y eliminación seguras, nombres no predecibles, URLs persistidas,
componente común, preview, progreso, errores y accesibilidad.

La migración desde URLs legacy debe ser gradual: continuar leyendo las URLs
existentes, subir nuevos assets mediante el componente común y retirar el editor
URL solo cuando todos los consumidores estén preparados.

## Limitaciones conscientes

- No hay Storage, uploads, presencia, última conexión ni tiempo jugado real.
- No hay controles de visibilidad adicionales ni schema nuevo.
- El archivo de mejores marcas depende de submissions que RLS y el estado de
  semana permiten leer.
- La trayectoria muestra las ocho entradas más recientes para mantener una
  lectura compacta; no implementa paginación.
- El centro admin no incorpora gestión de usuarios.

No se modifican schema, puntos, generación de `weekly_results`, ingest, cron,
Auth SSR, launcher, MAME ni nada dentro de `local/`.
