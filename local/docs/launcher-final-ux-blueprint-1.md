# LOCAL-LAUNCHER-FINAL-UX-BLUEPRINT-1

High Score League App es una biblioteca local de packs y launcher de competición, no una segunda web ni una herramienta de debug.

Este documento consolida la dirección final de la app local a partir del MVP existente. No reemplaza la CLI ni los documentos previos: ordena la experiencia hacia una app de jugador normal, bonita, simple y coherente con la marca de High Score League.

## Visión de producto

La web organiza la liga: rankings, temporadas, reglas, manuales, comunidad, cuentas y administración. La app local no debe duplicar esa web. Su trabajo es servir de puente entre el jugador, los packs descargados, MAME, la sesión local, la captura de puntuaciones, la cola local y la subida segura al endpoint web.

La experiencia final debe sentirse así:

1. El jugador instala el launcher una vez.
2. Elige el directorio unico donde guarda packs descomprimidos.
3. La app detecta los packs disponibles.
4. El jugador elige un juego desde una biblioteca visual.
5. La app muestra portada, hero, logo, estado, manual, ranking y acciones claras.
6. El jugador pulsa `Jugar` o `Practicar`.
7. Las puntuaciones de competición se guardan localmente y se sincronizan cuando sea posible.
8. Los problemas se explican con mensajes de jugador, dejando rutas, JSON y detalles técnicos en una capa avanzada.

El jugador no debería gestionar `pack.json`, rutas absolutas, carpetas `pending`, staging del plugin ni comandos CLI. La CLI sigue siendo la base funcional estable para desarrollo, diagnóstico y compatibilidad, pero la GUI final debe esconder esa complejidad por defecto.

## Decisiones ya tomadas que esta visión respeta

- La web sigue siendo el centro de liga, temporadas, rankings, manuales, comunidad, cuentas y administración.
- La app local no es una segunda web.
- El launcher se instala una vez.
- MAME debe instalarse y actualizarse una sola vez con la app local.
- Los packs finales son externos, ligeros, descomprimidos y desechables.
- Los packs finales no incluyen MAME; solo recursos del juego, presentacion,
  manual y configuracion competitiva.
- La sesión no vive dentro del pack.
- `userData` conserva sesión, preferencias, logs y estado persistente.
- La cola final de la GUI vive por cuenta y pack en `userData`.
- El plugin puede seguir escribiendo primero en staging dentro del pack.
- `failed` no significa pérdida: significa `Puntuaciones con error` o `Requiere atención`.
- La GUI debe ocultar rutas, JSON y debug salvo en detalles técnicos.
- La CLI sigue siendo la base funcional estable.
- La GUI final debe ser para jugadores normales, no para desarrolladores.

## Cabecera final

La cabecera debe ser estable, compacta y reconocible:

- logo o icono HSL;
- nombre `High Score League`;
- switch claro/oscuro;
- estado de conexión;
- menú de cuenta.

Con cuenta conectada, la zona de cuenta muestra:

- avatar o foto de perfil si existe;
- siglas si no hay avatar;
- username o display name;
- email secundario si hace falta;
- punto verde para `En línea`;
- punto rojo para `Sin Internet`;
- menú desplegable.

El menú de cuenta final debe comportarse como selector compacto de perfiles:

```text
Cuenta actual
Cuentas
Fila de cuenta recordada
Anadir cuenta
Cerrar sesion
```

La cuenta activa se marca con un check visual. Las cuentas no activas cambian
al pulsar la fila completa. `Olvidar cuenta` queda como accion secundaria de
icono por fila. `Cerrar sesion` cierra la sesion activa y olvida esa cuenta en
este launcher, sin borrar puntuaciones ni colas scoped.

`Cerrar sesion` usa el sistema local de iconos de la app Electron. El archivo
esperado para esa accion es `logout.svg` dentro de
`local/hsl-local-app/gui/renderer/assets/icons/`.

## Estado sin cuenta

Si no hay ninguna cuenta conectada, la primera pantalla debe priorizar vincular la cuenta sin convertir la app en un formulario técnico:

```text
Logo High Score League
Bienvenida breve
[Vincular cuenta con la web]
[Continuar sin cuenta / practicar sin conexión]
```

`Continuar sin cuenta` solo debe existir si se decide permitir práctica offline sin sesión. El modo competición requiere una cuenta conectada en la dirección actual de la GUI scoped queue.

La vinculación web final debería tender a este flujo:

1. El launcher abre el navegador.
2. La web pide login o registro.
3. La web muestra una confirmación: `¿Vincular cuenta de High Score League con la app?`.
4. El launcher recibe la sesión o un token de vinculación.
5. La app local guarda la sesión en `userData`, nunca dentro del pack.

Opciones técnicas a evaluar en tareas futuras:

- deep link;
- localhost callback;
- device code flow.

El login email/contraseña actual sigue siendo válido para el MVP. La versión final debería tender a vinculación desde la web porque concentra registro, recuperación de cuenta, políticas de sesión y experiencia de usuario en el sitio principal.

## Directorio unico de packs

La app final debe preferir un unico directorio de packs:

```text
D:/High Score League Packs/
  space-invaders/
  galaga/
  pac-man/
```

Ese directorio contiene packs descomprimidos. La experiencia final deberia
ofrecer:

```text
Elegir directorio
Cambiar directorio
Abrir directorio
Reescanear
```

El jugador no deberia abrir un `pack.json` concreto cada vez: elige la carpeta
raiz de packs y deja que el launcher detecte subcarpetas con `pack.json`.

Persistencia futura sugerida:

```text
userData/libraries/pack-directory.json
```

El soporte actual de varias ubicaciones con `locations.json` queda como paso
intermedio y herramienta de desarrollo. El modelo de producto preferido es un
solo directorio para simplificar soporte, instalacion con un click y estados de
pack.

Primer soporte implementado en `LOCAL-PACK-LIBRARY-LOCATIONS-1`: la GUI puede guardar ubicaciones en `userData/libraries/locations.json`, escanear subcarpetas directas con `pack.json`, listar packs detectados y activar uno reutilizando el flujo de `Abrir pack`. El grid visual final, filtros y busqueda siguen pendientes.

Primer soporte visual implementado en `LOCAL-PACK-LIBRARY-GRID-1`: la biblioteca
muestra packs detectados como cards con assets locales, placeholder HSL,
estados simples, pack activo destacado y empty states. Sigue sin implementar
filtros, busqueda, descarga de packs, estados remotos para todos los packs ni
el revamp completo.

`LOCAL-SHARED-MAME-RUNTIME-BLUEPRINT-1` ajusta la direccion final: la biblioteca
debe listar packs ligeros sin MAME en un unico directorio, mientras la app
instalada gestiona un runtime MAME compartido.

Primer soporte implementado en `LOCAL-PACK-DIRECTORY-MODEL-1`: la GUI guarda un
solo directorio en `userData/libraries/pack-directory.json`, permite elegirlo,
cambiarlo, abrirlo y reescanearlo, y conserva `locations.json` solo como
compatibilidad temporal no destructiva.

## Biblioteca de packs

La vista principal final debe ser una biblioteca visual de packs reconocidos:

- grid de packs;
- vista de iconos;
- vista de portadas;
- filtros por `activo`, `cerrado`, `próximo`;
- búsqueda simple futura.

Cada pack puede mostrar:

- `cover`;
- `icon`;
- `logo`;
- título del juego;
- temporada o semana;
- estado remoto: `activa`, `cerrada`, `próxima`, `no disponible`;
- estado local: `listo`, `requiere atención`, `sin cuenta`, `no participa`.

Las rutas técnicas no son primera capa. Deben quedar en detalles avanzados o diagnóstico. La biblioteca debe motivar a jugar y admirar los juegos, no a navegar carpetas.

## Detalle del pack seleccionado

Al seleccionar un pack, el panel principal o lateral debe mostrar:

- hero;
- logo del juego;
- título;
- desarrolladora o publicadora si la metadata lo incluye;
- género o etiquetas si la metadata lo incluye;
- ROM;
- semana;
- fechas;
- estado de temporada;
- estado de participación;
- mejor puntuación local o web si está disponible;
- tiempo jugado local si existe;
- puntuaciones pendientes o con error si existen.

Acciones principales:

```text
Jugar
Practicar
Ver manual
Ver ranking
```

`Jugar` debe ser el botón primario y más visible. `Practicar` es secundario. `Diagnóstico`, rutas, staging, `sync-plugin`, JSON y detalles técnicos deben vivir en una sección avanzada, no en la experiencia principal.

## Assets del pack

Estructura propuesta:

```text
pack/
  pack.json
  metadata.json
  assets/
    hero.png | hero.jpg | hero.webp
    logo.png | logo.svg
    icon.png | icon.svg
    cover.jpg | cover.png | cover.webp
```

Función de cada archivo:

- `hero`: imagen panorámica del detalle del pack.
- `logo`: logo del juego para el detalle.
- `icon`: icono pequeño para lista, estado o accesos compactos.
- `cover`: portada o card de la biblioteca.
- `metadata.json`: textos y presentación local.
- `pack.json`: contrato técnico jugable.

`metadata.json` no sustituye los datos oficiales de la web. Es una capa de presentación local para que el launcher pueda funcionar como biblioteca aunque esté offline o sin consultar todos los datos remotos.

Mínimo sugerido:

```json
{
  "title": "Space Invaders",
  "subtitle": "Semana 1",
  "developer": "Taito",
  "publisher": "Taito",
  "year": 1978,
  "genre": ["Fixed shooter"],
  "shortDescription": "Defiende la Tierra oleada tras oleada.",
  "manualUrl": "...",
  "rankingUrl": "...",
  "assets": {
    "hero": "assets/hero.png",
    "logo": "assets/logo.png",
    "icon": "assets/icon.png",
    "cover": "assets/cover.jpg"
  }
}
```

`pack.json` mantiene identidad, ROM, week, season y datos de runtime/captura.
Desde `LOCAL-PACK-CONTRACT-2`, `packVersion: 2` es el contrato actual de pack
ligero: no declara `mame.exe` dentro del pack, usa rutas relativas de recursos y
queda listo para catalogo e instalacion futura. Los ejemplos v1
`local/pack.example.json` y `local/examples/pack.hsl-invaders-flat.example.json`
siguen funcionando como contrato legacy/deprecated para el dev bridge hasta que
exista runtime MAME compartido estable.

Primer soporte implementado en `LOCAL-PACK-METADATA-ASSETS-1`: el pack activo puede cargar `metadata.json`, resolver assets locales dentro del pack y usarlos en la GUI con fallbacks seguros. La biblioteca de ubicaciones y el grid de packs siguen pendientes.

`LOCAL-PACK-LIBRARY-GRID-1` reutiliza esos mismos assets en cards de biblioteca:
`cover`, `icon` o `logo` si existen, y placeholder local si faltan. La metadata
sigue siendo presentacion local y no cambia el contrato jugable.

## Sincronización automática de puntuaciones

La experiencia final no debería tener `Subir pendientes` como botón principal permanente.

La app debería:

- subir automáticamente cuando haya Internet;
- subir automáticamente cuando la cuenta sea válida;
- subir cuando el jugador pertenezca a la temporada;
- guardar localmente si no puede subir;
- mostrar aviso si requiere atención;
- reintentar en segundo plano cuando el problema se solucione.

Estados de sincronización:

```text
Sin Internet
Pendiente de sincronizar
Sincronizado
Requiere atención
No participas en esta temporada
```

El botón manual `Subir pendientes` puede existir como herramienta avanzada durante desarrollo o recuperación, pero no debe ser el centro de la experiencia final. La app debe comunicar siempre que una puntuación guardada localmente no se ha perdido.

Primer soporte implementado en `LOCAL-AUTO-SYNC-QUEUE-1`: la GUI intenta
subir pendientes de forma oportunista cuando hay sesion, scope de cuenta/pack,
membership `member`, `canSubmit === true` y cola scoped con `pending > 0`.
No hay polling permanente ni servicio de fondo; estados `error` y `unknown`
pueden permitir competir con aviso, pero no suben automaticamente.

Primer soporte implementado en `LOCAL-PACK-READINESS-1`: la GUI resume si el
pack activo esta listo para practicar, competir, capturar y sincronizar. Esta
capa ordena checks de pack, MAME, plugin, staging, sesion, cola scoped,
membership y auto-sync sin cambiar payloads, endpoint, cola ni configuracion.
Con `LOCAL-PACK-CONTRACT-2`, los packs v2 cargan en biblioteca y readiness, pero
`LOCAL-SHARED-MAME-RUNTIME-1` permite resolver practica v2 con MAME compartido.
La competicion v2 queda bloqueada con aviso claro hasta
`LOCAL-MAME-PACK-PLUGIN-LOADING-1`.

## Temporada y participación

Objetivo futuro para competición:

```text
Jugar competición requiere:
- cuenta conectada;
- Internet o permiso de juego offline controlado;
- pertenecer a la temporada;
- pack activo válido.
```

Si el jugador no pertenece:

```text
No participas en esta temporada.
[Unirse desde la web]
```

En una fase posterior podría existir:

```text
[Unirse a la temporada]
```

Primer soporte implementado en `LOCAL-SEASON-MEMBERSHIP-CHECK-1`: la GUI
consulta la membership de la temporada para el `weekId` activo, bloquea
competicion y subida en estados conocidos no validos, mantiene practica
disponible y abre la temporada en la web para unirse o revisar la cuenta. Los
errores desconocidos permiten jugar con aviso, pero no subir hasta verificar.

## Cuentas múltiples

El selector final debe permitir:

- avatar o siglas;
- username;
- estado;
- desplegable con cuentas recordadas;
- `+ Añadir cuenta`;
- `Cerrar sesión`.

Gracias a la cola por cuenta y pack en `userData`, cambiar de cuenta no debe mezclar puntuaciones locales. Cada cuenta debe ver, subir y restaurar solo su scope activo:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

Primer soporte implementado en `LOCAL-ACCOUNT-SWITCHER-GUI-1`: la GUI recuerda
cuentas conocidas con datos seguros de presentacion, mantiene una sola sesion
activa real, permite cambiar cuenta iniciando sesion de nuevo y deja claro que
cerrar sesion o quitar una cuenta recordada no borra puntuaciones locales.

Segundo soporte implementado en `LOCAL-ACCOUNT-SWITCHER-GUI-2`: la GUI guarda
sesiones recordadas por cuenta bajo `userData/accounts/sessions/` para cambiar
sin volver a introducir contrasena cuando la sesion local sigue siendo valida o
refrescable. `session.json` sigue siendo la sesion activa compatible con el
resto del launcher.

## Iconos y marca

La web puede reutilizar recursos existentes:

```text
public/brand/
public/icons/
```

La app Electron usa iconos locales propios:

```text
local/hsl-local-app/gui/renderer/assets/icons/
```

La app local no depende de URLs remotas ni de iconos de la web en runtime.

La app final debería tener iconos para:

- icono principal HSL;
- logo HSL;
- cuenta;
- salida o cerrar sesión;
- conexión;
- sin Internet;
- jugar;
- practicar;
- manual;
- ranking;
- carpeta o ubicación.

Si faltan iconos finales de la app, deben anadirse a
`local/hsl-local-app/gui/renderer/assets/icons/` con los nombres definidos en
`local/docs/icon-system-1.md`.

## Modo desarrollador

La app final debe ocultar por defecto:

- rutas;
- JSON;
- staging;
- `sync-plugin`;
- diagnóstico crudo;
- tokens;
- `config.json`.

Debe existir una sección avanzada para soporte y desarrollo:

```text
Herramientas de desarrollo
Diagnóstico
Ver detalles técnicos
Abrir carpeta userData
Abrir carpeta del pack
```

Esa sección no debe contaminar la pantalla principal. Su función es resolver problemas, no definir la experiencia normal del jugador.

## Roadmap recomendado

1. `LOCAL-LAUNCHER-FINAL-UX-BLUEPRINT-1`.
2. `LOCAL-PACK-METADATA-ASSETS-1`.
3. `LOCAL-PACK-LIBRARY-LOCATIONS-1`.
4. `LOCAL-SEASON-MEMBERSHIP-CHECK-1`.
5. `LOCAL-ACCOUNT-SWITCHER-GUI-1`.
6. `LOCAL-AUTO-SYNC-QUEUE-1`.
7. `LOCAL-PACK-READINESS-1`.
8. `SPACE-INVADERS-RUN-DETECTION-1`.

Orden recomendado:

- Primero se documenta la visión para dejar de añadir piezas sueltas.
- Después se enriquecen packs con `metadata.json` y `assets/`, porque la biblioteca visual necesita presentación.
- Luego se añaden ubicaciones, escaneo y biblioteca de packs.
- Después se comprueba temporada y participación para bloquear competición con mensajes claros.
- El selector de cuentas se apoya en la cola scoped ya existente.
- La sincronización automática llega cuando cuenta, pack y participación ya están claros.
- El readiness de pack ordena diagnóstico y preparación sin exponerlo como flujo principal.
- La detección automática por juego permite subir intentos con menos intervención manual.

## Relación con documentos anteriores

- `launcher-gui-0.md` define la filosofía inicial: el jugador juega, la app registra y la web compite. Este blueprint mantiene esa separación y la expande hacia una biblioteca visual.
- `launcher-gui-1.md` documenta el prototipo Electron actual. Este blueprint no lo contradice: lo trata como MVP técnico que debe evolucionar hacia biblioteca y launcher de jugador.
- `launcher-auth-gui-1.md` introduce login/logout visual con sesión en `userData`. Este blueprint mantiene ese MVP y propone vinculación web como dirección final.
- `launcher-pack-open-1.md` permite abrir un pack externo por carpeta. Este blueprint lo convierte en una futura biblioteca de ubicaciones y packs detectados.
- `launcher-pack-remember-1.md` recuerda el ultimo pack abierto en `userData/packs/recent.json`. Este blueprint lo considera un paso previo a `userData/libraries/pack-directory.json`.
- `launcher-submission-recovery-1.md` redefine `failed` como puntuaciones con error recuperables. Este blueprint conserva esa idea y la integra con sincronización automática y estados comprensibles.
- `account-pack-scoped-queue-1.md` separa la cola por cuenta y pack en `userData`. Este blueprint usa esa decisión como base para cuentas múltiples, cambio de cuenta y seguridad de puntuaciones.
- `season-membership-check-1.md` introduce la comprobacion previa de
  participacion en temporada para que la app local bloquee competicion con
  mensajes de jugador antes de llegar al ingest.

- `auto-sync-queue-1.md` implementa la primera sincronizacion automatica
  conservadora sobre la cola scoped activa, sin cambiar payloads ni endpoint.
- `shared-mame-runtime-blueprint-1.md` define el destino final de runtime MAME
  compartido, packs ligeros, directorio unico de packs y carga futura de
  plugin/adaptadores.
- `pack-directory-model-1.md` sustituye la experiencia de multiples ubicaciones
  por un unico directorio de packs y deja `locations.json` como fallback legacy.

## No se implementa en esta tarea

- No se cambia auth.
- No se cambia cola.
- No se cambia scoped queue.
- No se cambia plugin.
- No se toca endpoint ingest.
- No se toca web principal.
- No se tocan migraciones.
- No se toca RLS.
- No se implementa deep link.
- No se implementa device code flow.
- No se implementa biblioteca de ubicaciones.
- No se implementa biblioteca de packs.
- No se implementa polling permanente de auto-sync.
- No se empaqueta Electron.
- No se modifica configuración real.

## Avance LOCAL-LAUNCHER-MEGA-PRODUCT-PASS-1

La primera jerarquía de producto ya está implementada: biblioteca y detalle son
protagonistas, actividad queda resumida y las opciones técnicas están plegadas.
También existen temporadas locales, tres vistas, búsqueda/filtros, manual local,
ranking web por semana e indicador de conexión. Catálogo remoto, instalación de
packs, favoritos y ranking JSON integrado siguen pendientes.
## Avance LOCAL-LAUNCHER-SHELL-LAYOUT-2

La jerarquia anterior queda aplicada como shell de escritorio: header fijo,
biblioteca izquierda con scroll propio, detalle derecho estable, actividad local
en drawer y opciones avanzadas en drawer. La cuenta activa y las cuentas
recordadas pasan al menu compacto del header.

La primera capa solo mantiene lo necesario para jugar: biblioteca, pack activo,
estado resumido, `Jugar`, `Practicar`, `Ver manual`, `Ver ranking`, actividad
resumida y entrada a avanzado. Diagnostico, rutas, readiness tecnico,
membership tecnico, runtime MAME, colas detalladas, staging, `sync-plugin` y
legacy/deprecated quedan encapsulados. Las vistas oficiales de biblioteca son
`Vista de portadas`, `Vista de lista` y `Vista de iconos`; no existe `Vista de
logos`.

## Avance LOCAL-LAUNCHER-SHELL-BUGFIX-3

La capa de shell queda estabilizada: el header y los paneles ocupan todo el
ancho de ventana, los drawers tienen backdrop independiente, header fijo real y
body scrolleable, y el panel derecho permite scroll interno cuando la altura no
alcanza. Las cards sin assets son mas compactas y legacy/deprecated queda como
badge secundario en la primera capa.

## Avance LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

La primera capa queda más cercana al mockup aprobado. El header usa un slot
cuadrado de icono junto al título y deja de mostrar el eyebrow `HSL`; el botón
de refresco sale de la capa principal. La biblioteca muestra `Biblioteca` y un
contador tipo `1 pack`, mantiene temporada y vistas `Portadas`, `Lista` e
`Iconos`, y mueve `Reescanear` a `Gestionar biblioteca`.

El detalle del pack reduce chips técnicos y muestra estados humanos:
`Participas en la temporada`, `No participas en la temporada`, `Pack listo`,
`Pack con errores`, `Listo con avisos`, `Auto-sync activo`, `Pendiente de
sincronizar` y `Legacy`. La botonera principal queda limitada a `Jugar`,
`Practicar`, `Manual` y `Ranking`; `Comprobar de nuevo` pasa a avanzado.

Actividad local vive ahora como subtarjeta compacta del pack, con `Ver detalles
>` para abrir el drawer. Opciones avanzadas desaparece como tarjeta visible y
se abre con `Ctrl+Shift+D`. Los pulidos posteriores de detalle, biblioteca y
menu de cuenta quedan documentados en sus avances propios; siguen pendientes
los PNG finales y pulido de drawers.

## Avance LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1

La ficha seleccionada queda pulida como primera capa de jugador: banner
horizontal contenido, logo/titulo/semana, chips humanos limitados, metadata con
icono/etiqueta/valor, descripcion local solo cuando existe, acciones 2x2 y
actividad local integrada. El detalle ya no usa readiness tecnico como texto de
fallback ni muestra identificadores/rutas en la superficie principal.

## Avance LOCAL-LAUNCHER-LIBRARY-CARDS-1

La biblioteca izquierda queda mas cercana a un launcher real: Portadas, Lista e
Iconos son vistas diferenciadas; las cards ya no tienen boton `Activo` ni
`Seleccionar`; el pack activo se marca por borde/acento; legacy queda como badge
discreto; la estrella guarda favoritos locales; la vista y la anchura de
sidebar se recuerdan por usuario con fallback global.

## Avance LOCAL-LAUNCHER-FAVORITES-SCOPED-2

Los favoritos de biblioteca dejan de ser un unico mapa global cuando hay sesion:
la cuenta activa usa `userData/players/<playerKey>/preferences/favorites.json`.
Sin sesion se conserva `userData/library/favorites.json` como anonimo. No hay
migracion automatica desde anonimo a cuenta para evitar mezclar jugadores.

## Avance LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2

La biblioteca izquierda compacta su primera capa: cabecera `Biblioteca` con
contador en pildora, fila `Más filtros`/`Cambiar directorio`, selector
`Portadas`/`Lista`/`Iconos` y subtarjeta plegable para busqueda y temporada.
Las acciones `Gestionar biblioteca`, `Abrir directorio`, `Reescanear` y el
filtro `Estado` salen de la superficie principal. La lista de juegos scrollea
por separado y `Iconos` usa tiles estables con punto de estado.

## Avance LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3

La composicion visual de la biblioteca se afina por vista: `Portadas` mantiene
caratulas 2/3 en columnas acotadas, `Lista` funciona como fila horizontal
compacta e `Iconos` usa tiles 1/1 fijos con punto de estado. La subtarjeta
`Más filtros` es mas baja, el buscador dice `Escribe aquí...` y la estrella de
favorito se centra con estado activo/hover en azul circuito.

## Avance LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4

La biblioteca queda anclada arriba y responde al ancho real de la sidebar con
reglas por vista: `Portadas` pasa de dos columnas 2/3 a una columna en estrecho,
`Lista` sigue como fila compacta e `Iconos` escala tiles 1/1. Sin sesion, los
favoritos no son editables ni escriben el fallback global, y Actividad local
muestra un mensaje de inicio de sesion en vez de una cola vacia.

## Avance LOCAL-LAUNCHER-LIBRARY-BREAKPOINT-POLISH-5

El responsive de biblioteca usa un breakpoint comun de 340px: sincroniza
`Portadas` de dos columnas a una con los botones de vista en modo solo icono.
La sidebar puede bajar a 320px, `Iconos` mantiene tile fijo y `Más
filtros` queda neutro cerrado, azul circuito abierto.

## Avance LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7

`Iconos` usa tile fijo de 128px para encajar 2 columnas en sidebar minima y 4
en sidebar maxima. `ORDENAR` elimina labels redundantes y cambia Asc/Desc por
toggle con iconos. En modo oscuro los scrollbars usan azul circuito y abrir
Actividad local conserva el scroll del panel de juego.

## Avance LOCAL-LAUNCHER-ACCOUNT-MENU-POLISH-1

El menu de cuenta queda como selector compacto de perfiles: chip superior,
avatar real o estado vacio, lista `Cuentas`, filas completas para cambiar,
check de cuenta activa, boton de olvidar por icono y login compacto. Se retiran
los textos administrativos de primera capa (`Cambio rapido disponible`,
`Cuenta activa`, `Cambiar`, `Quitar`) y cerrar sesion desde el menu olvida la
cuenta activa en este launcher sin borrar puntuaciones locales ni colas scoped.

## Avance LOCAL-LAUNCHER-ICON-SYSTEM-1

La GUI tiene una base local de iconos: carpeta versionada
`gui/renderer/assets/icons/`, helper `renderIcon()`, clases `ui-icon` y nombres
SVG estables para header, tema, acciones principales, metadata, actividad,
biblioteca, favoritos y cuenta. Si un SVG falta, el renderer muestra fallback
textual discreto sin usar URLs remotas.
