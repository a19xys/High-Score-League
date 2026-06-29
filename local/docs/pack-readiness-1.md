# LOCAL-PACK-READINESS-1

Estado de preparacion del pack activo antes de jugar.

## Objetivo

La GUI resume si el pack activo esta listo para practicar, competir, capturar
puntuaciones y sincronizarlas. El jugador ve una tarjeta corta con una decision
clara; los detalles tecnicos quedan en `Herramientas de desarrollo`.

Esta capa no cambia el contrato del pack, no modifica `config.json`, no ejecuta
MAME, no sube puntuaciones y no toca el endpoint web.

## Resultado visible

El panel principal muestra `Estado del pack` con uno de estos estados:

- `ready`: el pack esta listo para practicar, competir y sincronizar.
- `warning`: se puede usar el pack, pero hay avisos que conviene revisar.
- `blocked`: falta algo necesario para jugar o competir.
- `unknown`: no hay suficiente informacion para decidir.

La tarjeta usa mensajes de jugador, por ejemplo:

```text
Listo para jugar
Puedes practicar, competir y sincronizar puntuaciones.
```

o:

```text
Requiere atencion
No encuentro mame.exe. Revisa la carpeta del pack.
```

## Checks evaluados

La evaluacion revisa, sin efectos secundarios:

- `pack.json` cargado y errores de pack.
- Carpeta raiz del pack y archivo `pack.json`.
- Identidad basica del pack, ROM y `weekId`.
- Metadata opcional y assets como avisos no bloqueantes.
- Ejecutable de MAME y working directory.
- Nombre y carpeta del plugin.
- ROM inferida en `roms/<rom>.zip` como aviso si no se puede confirmar.
- Carpetas staging `pending`, `sent` y `failed` solo cuando aplican al flujo
  v1/dev bridge o plugin staging real.
- Sesion local.
- Cola scoped de cuenta y pack.
- Membership de temporada.
- `webBaseUrl` para sincronizar.
- Cola `failed`.
- Estado de auto-sync.

Los detalles muestran rutas y motivos tecnicos, pero no tokens, passwords,
cabeceras `Authorization`, access tokens ni refresh tokens.

## Modelo futuro con MAME compartido

`LOCAL-SHARED-MAME-RUNTIME-BLUEPRINT-1` define el destino final: la app local
instala y gestiona MAME una sola vez, y los packs no incluyen `mame.exe`.

Desde `LOCAL-PACK-CONTRACT-2`, readiness entiende `packVersion: 2` como contrato
actual de pack ligero. Un pack v2 puede estar cargado y visible en la
biblioteca. Desde `LOCAL-SHARED-MAME-RUNTIME-1`, practica v2 puede quedar lista
si el runtime MAME compartido esta configurado, `mame.exe` existe y `romPath`
apunta a un directorio del pack. Competicion v2 queda bloqueada hasta que
`LOCAL-MAME-PACK-PLUGIN-LOADING-1` implemente plugin/adaptadores de captura.

`packVersion: 1` sigue funcionando para el dev bridge y packs antiguos, pero se
muestra como legacy/deprecated en detalles tecnicos.

Desde `LOCAL-SCOPED-EVENT-STAGING-READINESS-14`, readiness no trata el fallback
`userData/events` como staging principal de packs v2. Ese fallback queda
clasificado como file queue global legacy/CLI. La fuente de verdad de la GUI es
la cola scoped de la cuenta y pack activos.

Cuando se implemente `LOCAL-SHARED-MAME-RUNTIME-1`, readiness debera separar:

- runtime global: MAME instalado, `mame.exe` existe y version compatible;
- directorio unico de packs: configurado, accesible y escaneable;
- pack activo: instalado, `pack.json` valido, `metadata.json`/assets opcionales
  y `manifest.json` valido si existe;
- recursos MAME del pack: `roms`, `artwork`, `samples` y `cfg` esperados;
- captura: plugin global o adaptador/config del pack disponible;
- experiencia: manual local si existe boton `Ver manual`;
- competicion/sync: `weekId`, `seasonId`, `webBaseUrl`, cuenta + pack scoped,
  membership y auto-sync.

Clasificacion futura:

- bloquea practica: falta runtime MAME, ROM o recursos minimos para ejecutar;
- bloquea competicion: falta cuenta, scope, week, membership segura o captura;
- bloquea captura: falta plugin/adaptador o configuracion de salida;
- bloquea sync: falta sesion, membership `member`, `webBaseUrl` o cola scoped;
- warning no bloqueante: metadata/assets/manual incompletos o manifest ausente
  en modo desarrollo.

## Reglas de disponibilidad

`canPractice` requiere MAME y ROM configurados.

`canCapture` requiere plugin configurado y sin error de carpeta cuando la ruta
puede comprobarse.

`canPlayCompetition` requiere practica disponible, captura disponible, sesion,
cola scoped, `weekId` y membership compatible. `member` permite competir.
`unknown` y `error` permiten competir con aviso para no bloquear por un fallo
temporal de red o servidor. `not_member`, `no_session`, `invalid_week` y
estados equivalentes bloquean competicion.

`canSubmit` requiere sesion, cola scoped, `weekId`, `webBaseUrl` y
`membership.canSubmit === true`.

## Relacion con membership

La comprobacion de readiness no sustituye la membership. La consume como una de
sus entradas.

Si el usuario no pertenece a la temporada del pack, el resumen bloquea
competicion y subida, pero mantiene practica si MAME/ROM estan disponibles.

Si la membership falla por red o servidor, la competicion puede quedar
disponible con aviso y la subida queda bloqueada hasta poder verificar.

## Relacion con auto-sync

Readiness no dispara auto-sync ni cambia sus reglas. Solo muestra si el estado
actual de auto-sync esta limpio o requiere atencion.

La sincronizacion sigue dependiendo de la cola scoped, la sesion y la membership
verificada.

## Relacion con scoped queue

La cola scoped sigue siendo la fuente local segura para la cuenta y pack
activos:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

Readiness solo comprueba que exista un scope activo para poder competir y subir.
No mueve archivos ni adopta staging.

Sin sesion, readiness no inventa un scope. Con sesion y pack activo, la GUI
prepara el scope bajo `userData/players/<playerKey>/packs/<packKey>/events`.
Para pack v2, los warnings de staging global se omiten porque la competicion v2
sigue bloqueada hasta la carga segura del plugin/adaptador.

## Relacion con la biblioteca visual

`LOCAL-PACK-LIBRARY-GRID-1` muestra estados simples para todos los packs
detectados: `Listo`, `Con avisos`, `Requiere atencion` y `No disponible`.
Esos estados salen del escaneo local de `pack.json`, metadata y assets.

La readiness completa sigue siendo solo del pack activo. La card activa puede
mostrar un resumen de `state.readiness` si ya esta disponible, pero la
biblioteca no ejecuta MAME, no evalua ROM/plugin/staging para todos los packs y
no consulta membership remota para cada card.

Desde `LOCAL-PACK-DIRECTORY-MODEL-1`, la biblioteca depende de
`userData/libraries/pack-directory.json`. Si no hay directorio configurado, la
biblioteca muestra empty state, pero un pack abierto manualmente puede seguir
teniendo readiness propia. Cambiar directorio no borra colas scoped ni invalida
el pack activo por fuerza.

## Relacion con el selector de cuenta

`LOCAL-ACCOUNT-SWITCHER-GUI-2` permite recordar sesiones locales por cuenta,
pero `session.json` sigue siendo la sesion activa. Readiness usa siempre esa
sesion activa y el scope derivado de esa cuenta + pack. Al cerrar sesion,
readiness puede dejar practica disponible si MAME y ROM estan listos, pero
bloquea competicion y subida hasta activar o iniciar sesion con una cuenta.

## Lo que no implementa

- No ejecuta MAME.
- No prueba el plugin en runtime.
- No crea carpetas automaticamente.
- No modifica `config.json`.
- No cambia payloads ni `duplicateKey`.
- No cambia `/api/submissions/ingest`.
- No toca migraciones ni RLS.
- No implementa multi-sesion compleja ni vinculacion web.
- No implementa grid final de biblioteca.
- No implementa installer ni empaquetado.

## Checks v2 añadidos

Readiness separa `capture.mode`, `capture.pluginName`, existencia de
`capture.adapter` y disponibilidad del cargador competitivo. Aunque los tres
primeros sean válidos, competición permanece bloqueada mientras el cargador v2
no exista. Práctica v2 puede seguir disponible.
