# LOCAL-PACK-DISTRIBUTION-MVP-1

Guia de distribucion minima para usar el launcher local con packs en una
primera competicion real sin catalogo remoto ni instalador final.

## Vision

El flujo MVP para un jugador normal es:

```text
1. Instalar o abrir el launcher.
2. Iniciar sesion.
3. Elegir la carpeta que contiene los packs.
4. Abrir Space Invaders desde la biblioteca.
5. Leer el manual si el pack lo trae.
6. Practicar.
7. Jugar la competicion.
8. Abrir el ranking en la web.
```

Principio del producto:

```text
El jugador juega.
La app registra.
La web compite.
```

## Que instala o recibe el usuario

Para la primera semana, el usuario necesita:

- launcher local de High Score League;
- runtime MAME compartido configurado desde el launcher;
- una carpeta de packs descomprimidos;
- cuenta web para competir y subir puntuaciones.

El launcher no descarga packs todavia y no instala MAME automaticamente en esta
tarea.

## Carpeta de packs

Flujo principal:

```text
D:/High Score League/
  Space Invaders/
    pack.json
    metadata.json
    assets/
    roms/
    artwork/
    samples/
    cfg/
    scripts/
    manual/
```

La carpeta elegida en el launcher debe ser la carpeta que contiene todos los
packs, no la carpeta de un pack concreto.

El launcher puede:

- elegir o cambiar carpeta de packs;
- recordar esa carpeta en `userData/libraries/pack-directory.json`;
- reescanear;
- abrir la carpeta en el explorador;
- detectar packs validos;
- mostrar packs rotos sin romper toda la biblioteca;
- agrupar duplicados de `packId` como un solo conflicto seleccionable.

El launcher no borra, mueve ni modifica packs al cambiar carpeta o reescanear.

Tras `LOCAL-LAUNCHER-SHELL-DETAIL-HOTFIX-3`, reescanear tambien reconcilia el
detalle activo: si un duplicado se resuelve a una sola carpeta se abre el pack
real, si sigue duplicado se actualizan las rutas, si desaparece se limpia el
conflicto y si un pack roto pasa a valido se activa.

## Importacion local

Desde `LOCAL-PACK-IMPORT-MVP-1`, el launcher puede importar packs desde ZIP o
carpeta al directorio de packs configurado.

Regla de producto:

```text
Distribuir comprimido.
Instalar descomprimido.
Jugar descomprimido.
```

El launcher no ejecuta packs directamente desde ZIP. Inspecciona, valida,
extrae o copia a `.hsl-import-*`, valida el pack v2 instalado y finaliza con un
rename dentro del directorio de packs.

Soporta:

- ZIP con una carpeta raiz que contiene `pack.json`;
- ZIP con `pack.json` en raiz;
- carpeta que ya es pack root;
- carpeta contenedora con un unico pack.

Rechaza multiples packs, rutas inseguras, `pack.json` demasiado profundo,
duplicados de `packId`, colisiones de carpeta, `packVersion` distinto de 2,
falta de ROM requerida o falta de `capture.adapter`.

Mas detalle: `local/docs/pack-import-mvp-1.md`.

## Contenido de un pack

Un pack v2 contiene:

- `pack.json`: contrato tecnico y competitivo;
- `metadata.json`: presentacion local;
- `assets/`: portada, hero, icono y logo;
- `roms/`: ROM consumida por MAME;
- `artwork/`: artwork consumido por MAME;
- `samples/`: samples especificos del juego;
- `cfg/`: configuracion MAME opcional y entendida;
- `scripts/`: adapter Lua de captura;
- `manual/`: manual local opcional.

Un pack v2 no contiene:

- MAME;
- sesion del usuario;
- tokens;
- eventos reales;
- runs temporales;
- cola `pending/sent/failed` del jugador.

ROMs, samples, artwork y assets propietarios no deben versionarse en este repo
sin licencia y autorizacion explicitas.

## Manual

MVP:

- si existe `metadata.manualPath` o `metadata.manual.path`, se abre si es
  HTML/PDF relativo dentro del pack;
- si no, se buscan `manual/manual.pdf`, `manual/manual.html` y
  `manual/index.html`;
- si no existe ninguno de esos nombres, se acepta exactamente un PDF dentro de
  `manual/`, por ejemplo `manual/invaders.pdf`;
- si no hay PDF unico, se acepta exactamente un HTML/HTM dentro de `manual/`;
- si hay varios PDF/HTML sin declaracion explicita, el launcher pide declarar
  `metadata.manualPath`;
- si existe `metadata.manualUrl`, se abre en navegador solo si es `http(s)`;
- rutas absolutas, traversal y `file://` se rechazan;
- si falta manual, el launcher muestra un mensaje claro.

No hay visor PDF interno todavia. El manual local se abre con la aplicacion
predeterminada del sistema.

## Ranking

MVP:

- `metadata.rankingUrl` tiene prioridad si es `http(s)`;
- si hay `weekId`, abre `/weeks/<weekId>`;
- si no hay semana pero hay `seasonSlug` o `seasonId`, abre
  `/seasons/<season>`;
- si solo hay `webBaseUrl`, abre la web;
- no se embebe ranking en Electron;
- no se consulta Supabase para rankings locales.

## Practicar y jugar

Practicar:

```text
MAME compartido
+ recursos del pack
+ mame.launchArgs comun si existe
+ perfil practice si existe
sin hsl-score
sin captura competitiva
```

Jugar:

```text
MAME compartido
+ recursos del pack
+ mame.launchArgs comun si existe
+ perfil competition si existe
+ hsl-score preparado por run
+ adapter del pack copiado al run
+ staging por run
+ adopcion al pending scoped de cuenta + pack
```

Esta tarea no cambia endpoint, payload competitivo, RLS ni membership.

Para packs v2 con BGFX, el launcher combina recursos del pack y recursos del
runtime MAME compartido:

```text
-artpath <pack>/artwork;<mame>/artwork
-bgfx_path <mame>/bgfx
```

El pack no debe copiar recursos BGFX ni artwork base de MAME. El runtime
compartido aporta esos recursos desde su propia instalacion.

## Errores visibles para jugador

La biblioteca y el detalle del pack deben usar lenguaje de jugador:

- `Listo`;
- `Listo con avisos`;
- `Requiere atencion`;
- `Legacy`;
- `Falta la ROM`;
- `Falta el manual`;
- `MAME no esta configurado`;
- `Inicia sesion`;
- `No participas en esta temporada`;
- `La competicion no esta disponible`.

Rutas largas, JSON, `ENOENT`, traversal, stack traces y detalles del adapter
quedan en configuracion avanzada/diagnostico.

## Configuracion MVP

La configuracion del launcher expone:

- carpeta actual de packs;
- cambiar carpeta;
- reescanear;
- abrir carpeta;
- ruta actual de `mame.exe`;
- cambiar runtime MAME;
- abrir carpeta MAME;
- diagnostico y readiness tecnicos en avanzado.

La biblioteca tambien muestra acciones directas para elegir/cambiar carpeta,
reescanear y abrir carpeta. En la superficie principal, abrir carpeta y
reescanear viven como iconos en la cabecera de `Biblioteca`: carpeta antes del
titulo y recarga despues del titulo. El icono de recarga gira mientras el
reescaneo manual esta en curso. Ese spinner queda limitado a operaciones de
biblioteca/packs como reescanear, validar o una futura importacion; no se usa
como spinner global de login, ranking, sync o lanzamiento de MAME.

No hay watcher automatico de la carpeta de packs en este MVP. Queda pospuesto
hasta implementar un canal IPC con debounce probado para evitar multiples
reescaneos al descomprimir/copiar packs, flicker visual y perdida de seleccion.
El watcher futuro solo podra disparar reescaneo; nunca borrar, mover ni
modificar packs.

## Readiness local de packs

Un pack v2 requiere la ROM concreta declarada por `rom` dentro de
`mame.romPath`. Si falta, por ejemplo `roms/invaders.zip`, la biblioteca marca
el pack como `Requiere atencion`, `Practicar` y `Jugar` quedan deshabilitados y
el servicio no lanza MAME aunque la UI fallase.

Los `packId` duplicados se tratan como conflicto agrupado. Si varias carpetas
declaran el mismo `packId`, la biblioteca muestra una sola entrada de problema,
seleccionable, con estado `Requiere atencion`. El detalle lista las rutas
implicadas y prioriza el error sobre cualquier asset disponible. `Practicar`,
`Jugar` y favorito quedan bloqueados porque el launcher no puede decidir que
instancia representa la identidad competitiva.

El mensaje principal es:

```text
Hay otro pack con el mismo packId. Cambia el packId o elimina el duplicado.
```

La card de conflicto usa una clave interna sintetica para seleccion y
renderizado, pero `packId` sigue siendo identidad competitiva. En conflicto, el
favorito queda deshabilitado para evitar estados compartidos confusos y no se
abre ningun pack fisico automaticamente.

Los packs rotos que no son duplicados tambien son seleccionables cuando hay
informacion util que mostrar. El detalle enseña `Este pack tiene errores`,
lista mensajes de jugador y mantiene las acciones bloqueadas si falta una ROM,
runtime, adapter o cualquier requisito critico.

Los favoritos usan actualizacion optimista: la estrella cambia al instante, el
toggle queda pendiente para evitar carreras de clics, se confirma con el
backend y se revierte con feedback no invasivo si el guardado falla. Sin sesion
o en conflictos de identidad, el favorito no se puede activar.

## MAME

El launcher anade `-skip_gameinfo` tanto en practica como en competicion para
evitar la pantalla inicial automatica de informacion de MAME sin depender del
`mame.ini` global del usuario.

Los argumentos finales de lanzamiento se imprimen en el resumen local. Esto
permite comprobar que `Jugar` recibe los argumentos del perfil competitivo, por
ejemplo `-video bgfx -bgfx_screen_chains crt-geom`, y que `Practicar` recibe el
perfil `practice` sin activar `hsl-score`.

## Pospuesto

No entra en este MVP:

- catalogo remoto;
- descarga automatica de packs;
- actualizador de packs;
- instalador final con MAME empaquetado;
- importacion ZIP segura;
- visor PDF interno;
- ranking embebido;
- ajustes por juego desde UI;
- selector de filtros/artwork/DIPs;
- autofire;
- bloqueo TAB/DIPs/save states/rewind/pause;
- hardening anti-cheat.

## Instrucciones para primera competicion

Mensaje operativo para un amigo:

```text
1. Abre el launcher.
2. Inicia sesion con tu cuenta de High Score League.
3. Pulsa Configuracion si necesitas elegir mame.exe.
4. Elige la carpeta donde has descomprimido los packs.
5. Pulsa Reescanear si acabas de copiar un pack nuevo.
6. Abre Space Invaders desde la biblioteca.
7. Pulsa Manual si quieres leer las reglas.
8. Pulsa Practicar para entrenar.
9. Pulsa Jugar para competir.
10. Pulsa Ranking para ver la clasificacion en la web.
```

Si algo falla, el usuario no debe borrar nada: cambia la carpeta, reescanea,
configura MAME o envia el diagnostico.
