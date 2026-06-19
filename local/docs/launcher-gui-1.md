# LOCAL-LAUNCHER-GUI-1

Primer prototipo visual minimo del launcher local.

## Alcance implementado

- GUI Electron provisional, sin empaquetado.
- Entrada: `npm run gui` dentro de `local/hsl-local-app`.
- UI separada en main/preload, servicio local, renderer, componentes y estilos.
- Acciones conectadas a la logica existente: diagnostico, play, practice, submit-all, sync-plugin y logout local.
- Estado visible de sesión local, modo dev bridge/pack, juego configurado, week, cola pending/sent/failed y salida de acciones.
- Login completo queda en CLI para no introducir manejo de password en el prototipo GUI.

## Polish 1

- La pantalla prioriza el juego activo, el estado para competir y el botón
  `Jugar competición`.
- La cola `pending` se presenta como cola de seguridad de puntuaciones, no como
  listado técnico de JSON.
- Las rutas, `dev bridge`, `sync-plugin` y logs crudos quedan en herramientas
  de desarrollo o detalles plegables.
- Los mensajes muestran primero un resumen amigable y dejan los detalles
  técnicos en `Ver detalles técnicos`.
- El tema oscuro y claro usan los tokens visuales de la web: superficies,
  bordes, badges y botón turquesa.

## Pack open 1

- La GUI añade `Abrir pack` como acción secundaria del panel del juego.
- Electron abre un diálogo de carpeta y el proceso principal carga `pack.json`
  desde la carpeta elegida.
- El pack activo se guarda solo en memoria durante la sesión de la GUI.
- Si el pack es válido, la GUI usa su ROM, week, web URL, rutas MAME y cola
  `plugins/<pluginName>/events/{pending,sent,failed}`.
- Si el usuario cancela, falta `pack.json` o el pack es inválido, se muestra un
  mensaje amigable y no se cambia el pack activo.
- `config.json` no se modifica.

Documento específico: [`launcher-pack-open-1.md`](launcher-pack-open-1.md).

## Dev pack manifest 1

- Se añade `local/examples/pack.hsl-invaders-flat.example.json` para el pack
  de desarrollo actual con `mame.exe`, `roms/` y `plugins/` en la raíz.
- Para probar `Abrir pack` con `C:/Users/u/Downloads/hsl-invaders/`, copia ese
  ejemplo como `pack.json` en la raíz del pack y rellena `weekId`.
- Este ejemplo plano no sustituye el layout final distribuible con MAME dentro
  de `mame/`.

## Pack remember 1

- Al abrir un pack válido, la GUI recuerda su carpeta en
  `userData/packs/recent.json`.
- Al iniciar, intenta recargar automáticamente el último pack si sigue
  existiendo y su `pack.json` sigue siendo válido.
- Si falla, muestra un aviso amable y mantiene el fallback de desarrollo puente.
- No copia packs, no borra eventos y no implementa lista multi-pack.

## Auth GUI 1

- La seccion `Cuenta` permite iniciar sesion con email y contrasena desde la
  GUI.
- El login usa Supabase Auth con la anon key configurada y guarda la sesion en
  el mismo `userData/session.json` que usa la CLI.
- El renderer no recibe `access_token`, `refresh_token` ni contrasena.
- `Cerrar sesion` elimina solo la sesion local; no borra packs ni puntuaciones
  pendientes.
- `Subir pendientes` queda bloqueado visualmente si no hay cuenta conectada.

Documento especifico: [`launcher-auth-gui-1.md`](launcher-auth-gui-1.md).

## Submission recovery 1

- La GUI muestra `failed` como `Puntuaciones con error`, no como papelera.
- Cada puntuacion fallida intenta mostrar un motivo amable y deja los detalles
  tecnicos plegados.
- `Restaurar a pendientes` mueve el JSON desde `failed` a `pending` con nombre
  seguro si ya existe otro archivo igual.
- Si `pending` queda vacio pero `failed` tiene archivos, el jugador sigue
  viendo una accion clara para recuperar la puntuacion.
- No se implementan colas por cuenta ni se mueve la cola a `userData` todavia.

Documento especifico:
[`launcher-submission-recovery-1.md`](launcher-submission-recovery-1.md).

## Account pack scoped queue 1

- La GUI usa una cola separada por cuenta activa y pack activo en `userData`.
- La estructura es `players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}`.
- La carpeta `events/pending` del plugin queda como staging de capturas.
- Al cerrar MAME en competicion, solo se adoptan capturas nuevas de esa sesion.
- Capturas antiguas en staging no se importan automaticamente para evitar
  mezclar cuentas.
- La CLI sigue usando la cola configurada tradicional por compatibilidad.

Documento especifico:
[`account-pack-scoped-queue-1.md`](account-pack-scoped-queue-1.md).

## Pack metadata assets 1

- El pack activo puede incluir `metadata.json` junto a `pack.json`.
- La GUI usa `title`, `subtitle`, `shortDescription`, creditos basicos y assets
  locales si existen.
- `pack.json` sigue siendo el contrato tecnico jugable; `metadata.json` solo
  mejora la presentacion local.
- Los assets se resuelven como rutas relativas dentro del pack y los warnings
  quedan en detalles tecnicos.
- Si falta metadata o una imagen, el pack sigue abriendo y el launcher mantiene
  el fallback visual actual.

Documento especifico:
[`pack-metadata-assets-1.md`](pack-metadata-assets-1.md).

## Pack library locations 1

- La GUI anade una seccion basica `Biblioteca de packs`.
- `+ Añadir ubicación` guarda carpetas raiz en
  `userData/libraries/locations.json`.
- El escaneo mira solo subcarpetas directas con `pack.json`.
- Los packs detectados muestran titulo, subtitulo, estado simple y accion
  `Usar este pack`.
- Activar un pack desde biblioteca reutiliza el flujo de `Abrir pack` y lo
  recuerda como ultimo pack.
- `Quitar` elimina la ubicación de la biblioteca sin borrar carpetas reales.
- No hay grid final, filtros, busqueda ni estados remotos.

Documento especifico:
[`pack-library-locations-1.md`](pack-library-locations-1.md).

## Season membership check 1

- La GUI comprueba la participacion de la cuenta activa en la temporada del
  `weekId` del pack antes de jugar competicion o subir pendientes.
- `Participas` permite jugar competicion y subir.
- `No participas`, `Sin cuenta`, `Semana no valida` o pack sin `weekId`
  bloquean competicion y subida, pero no practica.
- Errores de red o comprobacion desconocida permiten jugar competicion con
  aviso y dejan la puntuacion local; la subida queda bloqueada hasta verificar.
- La accion `Unirse desde la web` o `Abrir temporada en la web` abre el enlace
  desde Electron main. El renderer no recibe tokens.

Documento especifico:
[`season-membership-check-1.md`](season-membership-check-1.md).

## Season membership check 2

- La GUI distingue `member`, `not_member`, `no_session`,
  `unauthenticated`, `missing_week`, `invalid_week`, `error` y `unknown`.
- `unauthenticated` se muestra como `Sesion no valida` y no cae en el mensaje
  generico `No se pudo comprobar`.
- `Herramientas de desarrollo > Detalles tecnicos` muestra URL consultada,
  HTTP status, body status, body ok, mensaje, motivo tecnico, `weekId` y
  `seasonId`.
- Las respuestas no JSON se resumen como `non_json_response`; no se guarda HTML
  completo.
- `Comprobar de nuevo` recalcula la comprobacion del pack activo sin polling y
  sin escanear todos los packs.
- El renderer no recibe access token, refresh token ni cabecera
  `Authorization`.

Documento especifico:
[`season-membership-check-2.md`](season-membership-check-2.md).

## Final UX blueprint 1

- La dirección final de la GUI queda documentada en
  [`launcher-final-ux-blueprint-1.md`](launcher-final-ux-blueprint-1.md).
- La app local debe evolucionar hacia biblioteca local de packs y launcher de
  competición, no hacia una segunda web ni una herramienta de debug.
- El prototipo actual se mantiene como MVP funcional: CLI estable, GUI
  provisional, pack externo recordado, cuenta visual, cola scoped en `userData`
  y recuperación de `failed`.
- Las futuras tareas deberían priorizar metadata/assets de packs, ubicaciones,
  biblioteca visual, participación de temporada, selector de cuentas y
  sincronización automática.

## Limites

- El juego fijo sigue siendo `invaders`, igual que el MVP local actual.
- No hay selector de packs, multi-juego, auto-submit, capturas manuales ni reglas nuevas de partida.
- `sync-plugin` solo se habilita cuando la configuración parece modo desarrollo puente.
- No se cambia `config.json`; la GUI solo lee la configuración efectiva.
- No hay lista de packs recientes ni multi-pack completo.

## Estructura

- `gui/main.js`: proceso principal Electron e IPC.
- `gui/preload.js`: API segura para renderer.
- `gui/launcher-service.js`: puente fino hacia modulos CLI existentes.
- `gui/renderer/`: HTML, estado, componentes y estilos.
