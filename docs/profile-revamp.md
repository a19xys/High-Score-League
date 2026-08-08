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
  el historial paginado completo de envíos únicamente en el perfil propio.
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
- siglas, username, bio y fecha de incorporación completa en la zona horaria de
  la competición (`En la liga desde el …`);
- victorias oficiales;
- podios oficiales;
- participaciones en semanas con actividad válida o resultado oficial;
- cantidad de resultados oficiales;
- resultados oficiales recientes;
- mejor score válido por semana;
- historial completo de envíos propios ya cargados, incluidos los que RLS
  permite ver solo al dueño, paginado a 10, 25 o 50 filas;
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

En filas de submissions, `PlayerPill` usa la variante semántica `submission`:
avatar o siglas compactas sin repetir el username, manteniendo enlace, hover
card, foco y nombre accesible.

## Hover card compartida

`PlayerHoverCard` envuelve las identidades compartidas en escritorio. Espera
600 ms de hover continuo antes de abrir y cancela el timer si el puntero sale;
una vez abierta se cierra en el siguiente ciclo de eventos al abandonar trigger
y tarjeta, sin una espera perceptible. Un puente transparente permite recorrer
el pequeño espacio entre ambos sin cerrar. El contenido usa un portal a
`document.body`, medición real, ajuste horizontal y cambio arriba/abajo para no
quedar recortado por tablas o bordes del viewport. No se añadió una dependencia:
la implementación propia cubre el alcance con portal, `ResizeObserver` y
listeners de scroll/resize que se limpian al cerrar.

La preview contiene solo avatar, siglas, username, bio pública completa,
victorias,
podios y cantidad de resultados oficiales. Se solicita a
`/api/players/[username]/preview` únicamente al abrir tras confirmar intención;
el endpoint exige sesión, valida el username, usa el cliente Supabase del
usuario y RLS, y selecciona solo campos públicos y tres conteos ligeros de
`weekly_results`. El cliente mantiene una caché compartida por ID y username
con TTL de 45 segundos, deduplica solicitudes simultáneas y limpia las
solicitudes pendientes. Al guardar el perfil invalida ID, username anterior y
username nuevo; una respuesta iniciada antes de esa invalidación no puede
repoblar la caché. Un fallo conserva la identidad y el enlace sin mostrar
detalles técnicos.

La tarjeta cargada usa altura natural, conserva su límite máximo respecto al
viewport y activa scroll interno solo si hace falta. No reserva alturas vacías,
no recorta la bio ni muestra líneas de “Trayectoria competitiva”. El fallback
de bio compartido en perfiles y tarjetas es exactamente `Sin descripción.`.

La edición comparte un límite de 150 caracteres entre UI y validación. El
textarea muestra ayuda, contador y `maxLength`; un pegado que exceda el límite
se rechaza con error explícito antes de Supabase. La migración
`0023_profile_bio_max_length.sql` replica el contrato en base de datos sin
truncar bios existentes.

El ID autenticado se distribuye una vez desde el layout para reconocer la
identidad propia sin prop drilling. Sus triggers y botón llevan a `/profile`,
muestran `Este eres tú` e `Ir a mi perfil`; los demás llevan a
`/players/[username]` y muestran `Ver perfil`. La tarjeta aparece en
`PlayerPill`, top 3, podios y autores del chat, cubriendo leaderboards,
clasificaciones, submissions, resultados e historiales que reutilizan esas
identidades.

No se aplica al hero grande de `/profile` o `/players/[username]`, a la preview
del editor de avatar ni al control de cuenta del header. En dispositivos sin
hover no se programa la apertura y el tap sigue el enlace en un solo paso. Con
teclado, el foco abre inmediatamente, Tab entra en la acción de la tarjeta,
Mayús+Tab vuelve al trigger y Escape cierra sin perder el foco. Las transiciones
respetan `prefers-reduced-motion`.

## Avatar actual

`avatar_url` sigue siendo compatible con todas las imágenes existentes. El
editor prioriza preview y fallback; el campo URL vive dentro de la acción
`Cambiar imagen mediante URL`, por lo que la composición definitiva no depende
visualmente de un input desnudo. Dejarlo vacío recupera las siglas. No existe un
botón de subida falso.

La frontera `ProfileAvatarEditor` permite reemplazar el control URL por un
uploader futuro sin rediseñar el editor ni los perfiles.

El aro multicolor introducido por el revamp se retiró tras auditar el estado
inmediatamente anterior (`a56976f`). `ProfileAvatar` vuelve a centralizar el
tratamiento previo: círculo sin borde, gradiente ni sombra; foto con
`object-cover`; y fallback de siglas con `theme-surface-strong`. Los mismos
tokens responden a Claro, Oscuro y Sistema. El cambio se limita a la superficie
del avatar y conserva tamaños, composición del hero y el resto del revamp.

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

Completado en código. Avatar, imágenes de juego y opciones de cuestionario usan
el componente común `MediaUpload`, procesamiento WebP en navegador y el bucket
`hsl-public-media`. Se conservan las URLs legacy y el resolver prefiere el path
Storage cuando existe. El ciclo sube, persiste y solo entonces limpia el objeto
anterior, con rollback de subidas nuevas si falla la persistencia.

La migración `0024_media_uploads.sql` continúa pendiente de aplicación manual
en el Supabase remoto. Detalles de rutas, presets, RLS, límites y despliegue:
`docs/media-uploads.md`.

## Limitaciones conscientes

- La implementación de Storage público está terminada; `0024` debe aplicarse
  manualmente antes del deploy. No hay Storage privado de capturas, presencia,
  última conexión ni tiempo jugado real.
- No hay controles de visibilidad adicionales ni schema nuevo.
- El archivo de mejores marcas depende de submissions que RLS y el estado de
  semana permiten leer.
- El historial privado pagina en cliente el conjunto completo ya cargado. La
  paginación en servidor queda reservada para `SUBMISSIONS-SERVER-PAGINATION-1`.
- El centro admin no incorpora gestión de usuarios.

No se modifican schema, puntos, generación de `weekly_results`, ingest, cron,
Auth SSR, launcher, MAME ni nada dentro de `local/`.
