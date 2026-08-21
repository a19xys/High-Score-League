# Estado actual de la web

Este documento es la fotografía canónica de la web de High Score League. Separa
lo implementado en el repositorio, la infraestructura cuya aplicación remota
está confirmada, el procedimiento para entornos nuevos y el estado de despliegue
de una revisión concreta.

## Producto web implementado

- Next.js App Router, TypeScript, Tailwind y Supabase como fuente real; no hay
  fallback de producto a mocks.
- Supabase Auth con email/password, sesión SSR refrescada por middleware,
  onboarding inline en `/profile`, rutas privadas con `AccessRequired` y
  comprobación server-side de `is_admin` en las rutas administrativas.
- Perfiles propio y público con identidad, bio de hasta 150 caracteres, aro de
  avatar protagonista y una banda 2 × 2 / cuatro columnas con Victorias,
  Medallas, Tiempo jugado y Estado. Las hover cards autenticadas muestran
  Victorias, Podios y Medallas y coordinan preview con Presence. El
  perfil propio es un workspace por vistas y mantiene el historial privado
  filtrable por juego.
- Playtime identificado separado de su visibilidad pública. El propietario ve
  su agregado; otro miembro sólo lo recibe cuando `play_time_public = true`.
  `track_play_time` es legacy y no gobierna ni el registro ni la publicación.
- Catálogo de juegos, temporadas, semanas, memberships, submissions,
  benchmarks, resultados oficiales, clasificación de temporada, chat global y
  cuestionario único de Home conectados a Supabase.
- Panel admin para juegos, temporadas, semanas, submissions, benchmarks,
  cuestionarios y publicación/regeneración manual de `weekly_results`. En el
  centro de Administración, Semana actual es el acceso featured dentro de un
  grid responsive de seis unidades, sin cambiar su resolución segura.
- `/submit` se conserva como herramienta legacy/interna para admins, pero el
  botón de envío manual está deshabilitado. El contrato de integración vigente
  es `POST /api/submissions/ingest` con sesión o bearer token Supabase.
- `/supabase-test` y `/real-data-test` son diagnósticos protegidos para admin y
  no forman parte de la navegación pública.

## AUTH-RECOVERY-SCOPE-REDUCTION-1

Recovery queda reducido a la frontera web del navegador:

- `getClaims()` clasifica `JWT.amr.method=recovery` antes de que una página o
  mutación web sensible acepte una sesión de producto;
- `getServerSession()` distingue `recovery`; navegación privada, perfil, Home,
  hover current user y Presence sólo aceptan `signed-in`;
- reset exige marker + Recovery verificada + usuario coherente, repite el guard
  en el POST y ofrece cancelación local;
- los endpoints Bearer del launcher conservan el modelo normal `auth.getUser()`;
- no se añade schema, RLS, Storage ni una autoridad Recovery transversal.

El QA pendiente es exclusivamente browser/web. Detalle y riesgo aceptado en
[Recovery authorization boundary](auth-recovery-authorization-boundary.md).

## MEDIA-UPLOADS-1

Estado operativo confirmado en agosto de 2026:

```text
IMPLEMENTADA
MIGRACIÓN 0024 APLICADA
FUNCIONAL
```

`MediaUpload` gestiona avatar, header y logo de juego e imágenes de opciones de
cuestionario. Procesa JPEG, PNG o WebP en el navegador, genera WebP mediante
Canvas nativo o el fallback WASM lazy `@jsquash/webp`, muestra una preview y
sólo sube al guardar. Los objetos viven en el bucket público
`hsl-public-media` bajo paths nuevos y no sobrescribibles:

- `avatars/<USER_ID>/<UUID>.webp`;
- `games/headers/<UUID>.webp`;
- `games/logos/<UUID>.webp`;
- `polls/options/<UUID>.webp`;
- `benchmarks/icons/<UUID>.webp` tras aplicar `0030`.

El guardado sigue `upload → persistencia → cleanup`. Si falla una subida o la
persistencia, elimina los objetos nuevos ya creados; nunca elimina el anterior
antes de confirmar la base de datos. Los campos URL anteriores siguen como
compatibilidad: el path administrado es canónico para el lifecycle y la URL
legacy actúa como fallback. Las URLs externas existentes no se rehostean ni se
migran automáticamente.

Las capturas de submissions no usan este bucket. El Storage privado de
evidencias sigue pendiente y necesitará un diseño separado.

Los benchmarks usan el mismo pipeline WebP/alpha y lifecycle para
`image_storage_path`; la web muestra la imagen sin máscara o `REF` cuando falta.
La UI anterior de speedometers está retirada. `icon_key` sigue únicamente como
compatibilidad de schema hasta una migración futura. `0030` está preparada pero
no aplicada remotamente en esta tarea.

## Archivo, filtros, paginación y marca

- `/archive` es un workspace que carga ambos datasets en paralelo. Sus estados
  canónicos son `/archive#weeks` y `/archive#seasons`; no existe vista neutral.
- `ARCHIVO` lleva a `/archive#weeks`. Las pestañas cambian con `replaceState`,
  sin request, y los alias de rutas y `section` redirigen al hash equivalente.
  Los breadcrumbs son `Liga / Semanas|Temporadas`, sin nivel Archivo.
- Semanas y temporadas filtran por `AÑO`. Un intervalo pertenece a todos los
  años que cruza en `Europe/Madrid`; los activos se recortan a `now` para no
  revelar años futuros. La columna, los badges y la ordenación por Estado se
  conservan.
- El detalle de temporada extrae `SeasonWeeksTable`: Semana, Juego y Acción
  forman la base móvil; Estado aparece en intermedio y Fechas en escritorio.
  Juego conserva el espacio flexible y las semanas secretas siguen mostrando
  `Por anunciar` sin enlace.
- `SubmissionsTable` calcula intentos, mejor score, visibilidad y orden sobre el
  conjunto completo y pagina después. Usa 10 por defecto y permite 10/25/50.
  En móvil muestra `[‹] 1–10 de 24 [›]`; en escritorio centra ese bloque y
  alinea `[10] por página` a la derecha. No muestra `1 / 3`.
- Las páginas no vacías se completan con slots presentacionales
  `aria-hidden=true`; no son submissions ni afectan conteos, orden, intentos,
  score, visibilidad o rango. Con cero filas se usa `EmptyState`.
- Filas reales y slots comparten una altura por variante. `table-layout: fixed`
  y un `colgroup` sin track de fecha móvil fijan el layout; la fecha sólo entra
  en el formato desde 42 rem. La identidad compacta mantiene avatar y siglas
  incluso en anchos estrechos; las container queries reservan el marcador sin
  medir contenido con JavaScript.
- La región de tabla/paginación conserva `overflow-anchor: none` como defensa,
  pero paginación y sorting preservan explícitamente el `scrollTop` del
  documento: restauran antes del paint tras el commit y vuelven a comprobarlo
  una sola vez en el siguiente frame para absorber ajustes móviles tardíos.
- La navegación solicita `/brand/logo.png` y la landing
  `/brand/logo-horizontal.png` directamente. El fallback textual sólo aparece
  tras un `onError` real del navegador; no existe detección server-side con
  `existsSync`, `process.cwd()` o `hasBrandLogo`.
- La landing mantiene una sola estructura y consume variables semánticas
  propias para claro, oscuro explícito y oscuro de Sistema. Conserva la aurora
  en ambas paletas y el logo usa una respiración continua basada sólo en
  `transform`, desactivada con reduced motion.

## Cuestionario y media administrativa

El cuestionario de Home permite votar y cambiar el voto mientras esté abierto.
Los resultados agregados aparecen después de votar; Realtime acelera los
cambios y un polling de 10 segundos actúa como respaldo. Las imágenes de sus
opciones usan `image_storage_path`, con `image_url` como fallback legacy, y la
regla todo-o-nada evita mezclar opciones con y sin imagen. El guardado y el
reinicio aplican rollback y cleanup conjuntos mediante el lifecycle compartido.

Los formularios de juego usan el mismo uploader para header y logo. Conservan
internamente URLs legacy y `games.image_url`, además de `download_url`, colores
de acento y metadatos múltiples, pero no muestran inputs URL para las imágenes
administradas.

## Calendario y automatización

Las vistas derivan el estado actual de semanas y temporadas a partir de sus
fechas, por lo que una UI no necesita esperar al cron para mostrar apertura,
tramo final, cierre o temporada activa. `POST /api/cron/process-schedule`,
protegido por `CRON_SECRET`, sigue siendo necesario para persistir estados y
efectos laterales:

- sincroniza `draft`, `active`, `frozen` y `closed`;
- recalcula `is_hidden` de submissions válidas y las revela al cierre;
- sincroniza temporadas fechadas como `draft`, `active` o `completed`.

No genera `weekly_results`: la publicación oficial continúa siendo una acción
admin explícita y el cron omite semanas ya `published`. La edición admin sí usa
la reconciliación compartida para retirar `weekly_results` cuando un cambio de
fechas reabre una semana. La configuración de Vercel Cron o de un programador
equivalente no está versionada en el repositorio.

## Migraciones e infraestructura

Secuencia relevante del repositorio, en orden:

1. `0022_home_poll_option_images.sql`: añade la URL legacy de imágenes de poll.
2. `0023_profile_bio_max_length.sql`: añade el límite de 150 caracteres sin
   truncar datos incompatibles. **Aplicada remotamente**.
3. `0024_media_uploads.sql`: añade paths, constraints, bucket y policies de
   media pública. **Aplicada remotamente**.
4. `0025_play_time.sql`: define el ledger, agregados, RLS y RPC de Playtime y
   formaliza `play_time_public`. Está en el repositorio y el código web lo usa.
5. `0026_submission_detected_at_window.sql`: endurece la ventana temporal y la
   idempotencia de submissions. **Existente y aplicada remotamente**; no debe
   modificarse ni reaplicarse.
6. `0027_profile_anonymization.sql`: añade tombstones irreversibles, reserva de
   usernames, guardas de perfil activo, RLS y RPC de anonimización. **Aplicada
   correctamente en Supabase remoto**.
7. `0028_player_presence.sql`: añade el estado efímero de Presence.
8. `0029_profile_privacy_defaults.sql`: cambia solo los defaults de perfiles
   nuevos para Presence y Playtime.
9. `0030_week_benchmark_images.sql`: añade el path de imagen de benchmark,
   constraint y policies Storage exactas. **Creada localmente y pendiente de
   aplicación remota**.
10. `0031_launcher_packs.sql`: catálogo privado e inmutable de distribución de
    packs. **Aplicada remotamente**.
11. `0032_profile_bootstrap_rls.sql`: excepción estrecha para el
    `INSERT ... RETURNING` del perfil inicial. Estado remoto no afirmado aquí.

En un entorno nuevo se aplican todas las migraciones ausentes, en orden, antes
de desplegar código que consulte sus columnas. En el entorno remoto actual no
se deben volver a ejecutar `0023`, `0024`, `0026` ni `0027`: ya están aplicadas.
El preflight de 0027 se conserva como verificación de solo lectura para otros
entornos y `supabase/preflight/0030_week_benchmark_images.sql` valida el nuevo
cambio sin escribir. No crear migraciones posteriores a `0032` salvo que
aparezca un nuevo conflicto real. La aplicación de una migración y el despliegue
de una revisión web son estados distintos.

## Estado de despliegue

El repositorio contiene el comportamiento descrito y `0023`/`0024`/`0026`/`0027`
están confirmadas en la infraestructura remota. Esta revisión web no se ha
desplegado. Esta auditoría no dispone de una
fuente fiable para identificar qué SHA web está actualmente en producción, ni
afirma que HEAD esté desplegado. `docs/deploy-checklist.md` es un procedimiento
reutilizable para cada release, no una prueba de que haya un deploy pendiente o
completado.

## Documentación por dominio

- Estado, datos y despliegue: [README](../README.md),
  [modelo de datos](database.md), [carga de datos](data-loading.md),
  [Supabase setup](supabase-setup.md) y
  [checklist de despliegue](deploy-checklist.md).
- Auth y perfiles: [Auth](auth-setup.md), [perfiles](profile-revamp.md) e
  [imágenes administradas](media-uploads.md), más la
  [frontera Recovery](auth-recovery-authorization-boundary.md).
- Archivo y competición: [Archivo](archive.md),
  [resultados semanales](weekly-results.md),
  [clasificación de temporada](season-standings.md) y
  [benchmarks](week-benchmarks.md).
- Submissions e integración: [arquitectura](submission-architecture.md),
  [ingest](ingest-api.md), [contrato para clientes](launcher-api.md),
  [pruebas SQL](test-submissions.md) y
  [Storage privado futuro](supabase-storage.md).
- Administración: [visión general](admin.md), [juegos](admin-games.md),
  [temporadas](admin-seasons.md), [semanas](admin-weeks.md) y
  [cuestionario](home-polls.md).
- Servicios transversales: [chat](chat.md) y
  [automatización](automation.md).

La documentación del cliente local se mantiene fuera de este estado web.

## Roadmap web

### 1. PROFILE-PRESENCE-1

El schema, servicio, endpoint y UX de `PROFILE-ANONYMIZATION-1` están operativos.
La baja
preserva UUID, submissions, `weekly_results`, memberships, puntos, posiciones,
votos y chat; crea un tombstone no interactivo, elimina Playtime y avatar,
retira metadata personal de Auth y hace soft-delete del usuario. No modifica
texto libre histórico y no promete purga inmediata de caché CDN.

`0027` ya está aplicada remotamente. El QA destructivo exhaustivo con cuenta
desechable se ha diferido deliberadamente por decisión del usuario y no bloquea
el roadmap.

`PROFILE-PRESENCE-1` está implementado en código y schema mediante `0028`:
heartbeats web/launcher de 30 s, TTL de 90 s, `JUGANDO > CONECTADO >
DESCONECTADO` y `PRIVADO` prioritario. `0029` cambia a público el default de
Presence y Playtime para perfiles nuevos, sin backfill de valores históricos;
la UI formula ambas preferencias como acciones de ocultación. No hay última
conexión, historial ni outbox. Playtime no se usa para inferir Presence y las
submissions conservan toda la autoridad competitiva. Falta aplicar `0028` y
`0029`, en ese orden, en el entorno remoto antes de considerar operativa esta
función.

`WEB-WEEK-BENCHMARK-PROFILE-POLISH-2` está implementada en el repositorio. Su
migración `0030` debe verificarse, aplicarse y comprobarse antes de desplegar la
web compatible; después corresponde QA admin con datos desechables. Resultados
oficiales, perfil, sesión, grid admin y geometría/Presence de hover cards no
requieren migraciones adicionales.

### Otros pendientes reales

- panel completo de usuarios y gestión avanzada de memberships;
- medallas, logros y bonus;
- moderación UI del chat e historial de ediciones;
- Storage privado de capturas y evidencias;
- comentarios, historial y múltiples cuestionarios de Home;
- `SUBMISSIONS-SERVER-PAGINATION-1` cuando cargar el conjunto completo deje de
  ser viable;
- consolidación documentada para instalaciones limpias sin reescribir la
  historia de migraciones aplicada;
- configuración operativa de un programador para el endpoint cron.

`MEDIA-UPLOADS-1`, la aplicación remota de `0023`/`0024` y el pulido de Archivo,
filtros, paginación y marca están cerrados y no forman parte del roadmap
pendiente.
