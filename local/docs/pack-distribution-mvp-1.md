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
- mostrar packs rotos sin romper toda la biblioteca.

El launcher no borra, mueve ni modifica packs al cambiar carpeta o reescanear.

## Importacion manual

Para este MVP no se implementa importacion ZIP. La opcion segura para primera
competicion es distribuir un ZIP fuera del launcher y pedir al usuario que lo
descomprima dentro de su carpeta de packs.

La importacion ZIP queda como siguiente tarea porque debe cubrir traversal,
colisiones, sobrescritura, validacion previa y errores claros.

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

- si existe `metadata.manualPath`, se abre si es HTML/PDF relativo dentro del
  pack;
- si no, se buscan `manual/manual.html`, `manual/manual.pdf` y
  `manual/index.html`;
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
+ perfil practice si existe
sin hsl-score
sin captura competitiva
```

Jugar:

```text
MAME compartido
+ recursos del pack
+ perfil competition si existe
+ hsl-score preparado por run
+ adapter del pack copiado al run
+ staging por run
+ adopcion al pending scoped de cuenta + pack
```

Esta tarea no cambia endpoint, payload competitivo, RLS ni membership.

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
reescanear y abrir carpeta.

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
