# LOCAL-SHARED-MAME-RUNTIME-BLUEPRINT-1

Blueprint tecnico para el modelo final de MAME compartido y packs ligeros.

## 1. Objetivo

La app local instala y gestiona MAME una sola vez; los packs no incluyen MAME, solo recursos del juego, presentacion, manual y configuracion competitiva.

Este documento define el destino arquitectonico para:

- runtime MAME compartido;
- packs ligeros instalados en un unico directorio de packs;
- lanzamiento de MAME global usando recursos del pack activo;
- plugin comun y adaptadores/configuracion por juego o pack;
- readiness, diagnose, instalador, actualizaciones y catalogo futuro.

Este blueprint define el destino global. `LOCAL-SHARED-MAME-RUNTIME-1` implementa la primera capa: ruta persistida a `mame.exe`, diagnostico y practica v2 basica con recursos del pack. El codigo actual puede seguir usando el bridge de desarrollo y packs `packVersion: 1` con `mame.relativeExecutablePath` mientras se completa la migracion. Desde `LOCAL-PACK-CONTRACT-2`, ese contrato v1 queda legacy/deprecated y `packVersion: 2` es el contrato actual de pack ligero.

## 2. Por que MAME no debe ir en cada pack

Incluir MAME dentro de cada pack no escala:

- duplica cientos de MB por juego o semana;
- obliga a actualizar MAME pack por pack;
- dificulta diagnosticar que version esta usando cada partida;
- hace mas pesado el instalador o la descarga de packs;
- mezcla runtime, ROMs, assets, manuales y datos competitivos;
- complica el futuro catalogo remoto e instalacion con un click.

El modelo final separa responsabilidades:

```text
app local instalada una vez
+ runtime MAME global
+ packs ligeros
+ userData persistente
```

MAME pasa a ser parte controlada de la app local, no de cada pack.

## 3. Estructura final de app instalada

Estructura orientativa para una instalacion Electron/Node:

```text
High Score League App/
  app/
    launcher/
    resources/
  runtime/
    mame/
      mame.exe
      hash/
      plugins/
        hsl-score/
      cfg/
      ini/
  resources/
    brand/
    icons/
```

La carpeta de instalacion contiene binarios y recursos versionados por el proyecto. No debe contener sesiones, colas de puntuaciones ni packs descargados por el jugador.

`userData` conserva estado persistente del dispositivo:

```text
userData/
  session.json
  accounts/
    known-accounts.json
    sessions/
  players/
    <playerKey>/
      packs/
        <packKey>/
          events/
            pending/
            sent/
            failed/
  logs/
  packs/
    recent.json
  libraries/
    pack-directory.json
  preferences.json
```

El directorio unico de packs puede vivir en `userData/packs/library` por defecto o en una carpeta elegida por el jugador. Debe tratarse como contenido local del usuario, no como parte del binario instalado.

## 4. Directorio unico de packs

Decision de producto final:

```text
La app tendra un unico directorio de packs.
```

Ejemplo:

```text
D:/High Score League Packs/
  space-invaders/
  galaga/
  pac-man/
```

La app deberia ofrecer:

- elegir directorio;
- cambiar directorio;
- abrir directorio;
- reescanear.

La UI final debe sustituir conceptualmente `Anadir pack` por:

- `Elegir directorio`, si no hay directorio configurado;
- `Cambiar directorio`, si ya existe uno;
- `Abrir directorio` para inspeccion local;
- `Reescanear` para detectar cambios.

`LOCAL-PACK-DIRECTORY-MODEL-1` implementa este modelo en
`userData/libraries/pack-directory.json`. El antiguo
`userData/libraries/locations.json` queda como compatibilidad temporal: si hay
una sola ubicacion se migra de forma no destructiva, y si hay varias se usa una
con warning hasta que el jugador elija el directorio definitivo.

## 5. Estructura final de pack ligero

Pack final sin MAME:

```text
pack/
  pack.json
  metadata.json
  manifest.json
  assets/
    cover.png | cover.jpg | cover.webp
    icon.png | icon.svg
    logo.png | logo.svg
    hero.png | hero.jpg | hero.webp
  manual/
    manual.html | manual.pdf
    assets/
  roms/
  artwork/
  samples/
  cfg/
  plugins/
  scripts/
```

Funcion de cada bloque:

- `pack.json`: contrato tecnico, jugable y competitivo.
- `metadata.json`: presentacion local del launcher.
- `manifest.json`: integridad, version y checksums del pack.
- `assets/`: portada, icono, logo y hero.
- `manual/`: manual local del pack.
- `roms/`, `artwork/`, `samples/`: recursos que MAME consume para el juego.
- `cfg/`: configuracion especifica del pack si hace falta.
- `plugins/`: plugin o extension por pack si se valida esa opcion.
- `scripts/`: adaptadores de captura/configuracion por juego o pack.

`metadata.json` no sustituye al contrato competitivo ni a los datos oficiales de la web. `manifest.json` no debe contener secretos.

## 6. pack.json v2

Contrato inicial definido por `LOCAL-PACK-CONTRACT-2`:

```json
{
  "packVersion": 2,
  "packId": "space-invaders-season-1-week-1",
  "gameId": "space-invaders",
  "rom": "invaders",
  "seasonId": "...",
  "seasonSlug": "season-1",
  "seasonName": "Temporada 1",
  "weekId": "...",
  "weekNumber": 1,
  "webBaseUrl": "https://high-score-league.vercel.app",
  "runtime": {
    "type": "mame",
    "minVersion": "0.287",
    "recommendedVersion": "0.287"
  },
  "mame": {
    "romPath": "roms",
    "artworkPath": "artwork",
    "samplePath": "samples",
    "cfgPath": "cfg",
    "launchArgs": []
  },
  "capture": {
    "mode": "plugin",
    "pluginName": "hsl-score",
    "adapter": "scripts/space-invaders.lua"
  }
}
```

Regla de destino:

```text
pack.json ya no debe declarar mame.exe dentro del pack como ruta principal final.
```

Compatibilidad temporal:

- `packVersion: 1` puede seguir declarando `mame.relativeExecutablePath` y `mame.workingDir`, pero queda deprecated.
- El pack plano de desarrollo puede seguir usando `relativeExecutablePath: "mame.exe"`.
- El launcher actual puede seguir resolviendo rutas de MAME desde el pack hasta `LOCAL-SHARED-MAME-RUNTIME-1`.

La migracion real a ejecucion v2 queda pendiente de `LOCAL-SHARED-MAME-RUNTIME-1`.

## 7. Lanzamiento futuro con MAME global

La app deberia resolver:

```text
runtime MAME global
+ pack activo
+ recursos del pack
+ cola scoped en userData
+ plugin/adaptador de captura
```

Comando conceptual:

```text
mame.exe <rom>
  -rompath <pack>/roms
  -artpath <pack>/artwork
  -samplepath <pack>/samples
  -cfg_directory <pack>/cfg o userData runtime cfg
  -plugins
  -plugin hsl-score
```

Flags a validar con MAME real:

- nombres exactos y soporte de `-rompath`, `-artpath`, `-samplepath`;
- uso de `-cfg_directory` frente a `-cfg`;
- forma limpia de declarar `pluginpath` o adaptadores por pack;
- interaccion con `plugin.ini` global;
- como aislar practica para que no capture puntuaciones.

El launcher futuro no deberia depender de `cwd` dentro del pack MAME. Debe construir argumentos desde el runtime global y rutas del pack activo.

Futura tarea:

```text
LOCAL-MAME-PACK-PLUGIN-LOADING-1
```

## 8. Opciones para plugin/captura

### Opcion A - Plugin global + adaptadores por pack/juego

La app instala `hsl-score` una vez junto al runtime. Cada pack aporta un adaptador o configuracion de juego.

Ventajas:

- no duplica logica comun;
- actualiza el plugin una sola vez;
- mantiene packs mas ligeros;
- centraliza diagnostico de version.

Riesgos:

- hay que disenar como el plugin global localiza el adaptador del pack activo;
- hay que validar si MAME permite cargar adaptadores externos de forma limpia;
- hay que evitar que un adaptador de un pack afecte a otro.

### Opcion B - MAME global + pluginpath/plugin del pack

MAME vive global. El pack aporta plugin, script o adaptador y la app lanza MAME apuntando al plugin del pack.

Ventajas:

- el pack queda autocontenido respecto a captura;
- facilita adaptar juegos con logica especifica;
- reduce acoplamiento inicial entre app global y pack.

Riesgos:

- puede duplicar plugin comun;
- complica actualizaciones de seguridad/captura;
- hay que validar flags reales de MAME para plugin paths;
- puede generar diferencias de comportamiento entre packs.

### Opcion C - Preparacion temporal por ejecucion

Antes de lanzar, la app copia o prepara config/adaptador del pack en una zona temporal o global controlada.

Ventajas:

- puede ser robusta si MAME limita rutas de plugin;
- permite auditar exactamente lo que se va a ejecutar;
- puede limpiar o versionar el estado preparado por ejecucion.

Riesgos:

- introduce estado temporal;
- exige limpieza y diagnostico mas cuidadosos;
- puede ser mas dificil de explicar si falla.

Recomendacion preliminar:

```text
Plugin global comun + adaptadores/config por pack o por juego, si MAME lo permite de forma limpia.
```

Debe validarse con MAME real antes de cerrar el contrato.

## 9. Impacto en readiness

Readiness final debe comprobar:

- runtime MAME instalado;
- version de MAME compatible;
- `mame.exe` existe;
- directorio unico de packs configurado;
- pack instalado;
- `pack.json` v2 valido o v1 aceptado en compatibilidad;
- `metadata.json` y assets opcionales;
- `manifest.json` valido si existe;
- `roms`, `artwork`, `samples` esperados;
- plugin global o adaptador del pack disponible;
- manual local si la UI ofrece `Ver manual`;
- `weekId`, `webBaseUrl`, `seasonId`;
- scope de cuenta + pack;
- membership;
- auto-sync.

Debe clasificar impacto:

- bloquea practica: falta runtime MAME, ROM o recursos minimos para ejecutar;
- bloquea competicion: falta cuenta, scope, week, membership segura o captura requerida;
- bloquea captura: falta plugin/adaptador o configuracion de salida;
- bloquea sync: falta sesion, membership `member`, `webBaseUrl` o cola scoped;
- warning no bloqueante: metadata/assets/manual incompletos, manifest ausente en modo dev, auto-sync pendiente.

La readiness completa sigue siendo del pack activo. La biblioteca puede mostrar estados simples sin ejecutar MAME ni consultar membership para todos los packs.

## 10. Impacto en diagnose

`diagnose` debe evolucionar para auditar:

- runtime global MAME;
- version de MAME;
- plugin global y version;
- directorio unico de packs;
- pack activo;
- recursos del pack;
- `manifest.json` y checksums;
- `userData`;
- sesion resumida sin tokens;
- colas scoped;
- red y `webBaseUrl`.

`diagnose` es herramienta de soporte. `readiness` sigue siendo el resumen de jugador para el pack activo.

## 11. Instalador y actualizaciones

El instalador futuro de High Score League instala:

- app Electron;
- runtime MAME global;
- plugin global `hsl-score`, si se usa;
- estructura inicial de `userData`;
- directorio de packs por defecto o selector inicial.

Actualizaciones futuras controladas por el proyecto:

- app local;
- MAME;
- plugin global;
- configuracion runtime.

La actualizacion de MAME no debe depender de cada pack. El proyecto debe poder recomendar, bloquear o migrar versiones de MAME desde la app.

Futura tarea:

```text
LOCAL-MAME-RUNTIME-UPDATE-1
```

## 12. Catalogo e instalacion de packs

El runtime compartido habilita:

- juegos disponibles;
- juegos misteriosos;
- pack no instalado;
- instalar con un click;
- actualizar pack;
- verificar checksum;
- colocar pack en el directorio unico;
- mostrar estados locales y remotos sin duplicar MAME.

El catalogo remoto pertenece a la web/API. La app local solo descarga, verifica, instala en el directorio unico y activa el pack.

Futura tarea:

```text
LOCAL-PACK-CATALOG-INSTALL-BLUEPRINT-1
```

## 13. Compatibilidad temporal con el modelo actual

Compatibilidad que se mantiene:

- el dev bridge puede seguir existiendo;
- packs antiguos pueden seguir usando `relativeExecutablePath`;
- `packVersion: 1` no se rompe en esta tarea;
- `sync-plugin` sigue siendo herramienta temporal de desarrollo;
- el plugin MAME actual sigue sin cambios;
- la cola scoped por cuenta + pack sigue en `userData`;
- el payload, `duplicateKey`, ingest, membership endpoint y RLS no cambian.

Este blueprint define el destino final, no una migracion inmediata.

## 14. Tareas futuras

Roadmap recomendado:

1. `LOCAL-SHARED-MAME-RUNTIME-BLUEPRINT-1`.
2. `LOCAL-PACK-DIRECTORY-MODEL-1`.
3. `LOCAL-PACK-CONTRACT-2`.
4. `LOCAL-SHARED-MAME-RUNTIME-1`.
5. `LOCAL-MAME-PACK-PLUGIN-LOADING-1`.
6. `LOCAL-PACK-CATALOG-INSTALL-BLUEPRINT-1`.
7. `WEB-LOCAL-PACK-CATALOG-API-1`.
8. `LOCAL-PACK-CATALOG-CLIENT-1`.
9. `LOCAL-PACK-INSTALLER-1`.
10. `LOCAL-PACK-LIBRARY-SEASONS-1`.
11. `LOCAL-PACK-LIBRARY-VIEWS-1`.
12. `LOCAL-LAUNCHER-UX-REVAMP-1`.
13. `LOCAL-INSTALLER-PACKAGING-1`.
14. `LOCAL-MAME-RUNTIME-UPDATE-1`.

Orden logico:

- primero fijar el directorio unico y contrato v2;
- despues implementar runtime global y carga plugin/adaptador;
- luego preparar catalogo e instalacion;
- finalmente empaquetar instalador y actualizaciones controladas.
