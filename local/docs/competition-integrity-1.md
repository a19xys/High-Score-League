# LOCAL-COMPETITION-INTEGRITY-1

Primera capa local de integridad para Competición en packs v2. La frontera se
ejecuta después de la autorización competitiva existente y antes de preparar o
arrancar MAME. No añade HTTP, polling, timers, caché remota ni una nueva
autoridad de Week, Membership o Connectivity.

## Alcance y threat model

Con el launcher, plugin y MAME normales, esta fase detecta o impide:

- cambios no acompañados en `pack.json`, ROM, adapter, scripts, artwork
  interactivo o seed competitivo;
- reutilización de cfg, NVRAM, input, estados o snapshots de Práctica;
- MAME distinto de la versión exacta declarada;
- DIP incorrectos al inicio o modificados durante la run;
- menú, pausa, save/load, reset, rewind, frame advance, fast-forward, cheats y
  cambios de speed/throttle;
- argumentos, scripts/autoboot o plugins adicionales controlados por el pack;
- eventos sin evidencia, con evidencia falsa o con violaciones.

No es una firma ni una autoridad independiente. No protege de un launcher,
plugin central o `mame.exe` parcheado, inyección en el proceso, manipulación del
SO, sustitución simultánea de código local confiable, pack y manifest, ni
requests web fabricadas. `WEB-COMPETITION-INTEGRITY-1` deberá comparar el
`manifestSha256` contra el pack publicado y validar la evidencia server-side.

## Contrato de pack compatible

`mame.profiles.competition.integrity` es compatible-opcional: su ausencia no
corrompe un pack ni impide discovery o Práctica, pero deja no disponible la
Competición protegida.

```json
{
  "version": 1,
  "mameVersion": "0.287",
  "dips": [
    {
      "portTag": ":IN2",
      "mask": 3,
      "value": 0,
      "label": "Lives",
      "settingLabel": "3"
    },
    {
      "portTag": ":IN2",
      "mask": 8,
      "value": 0,
      "label": "Bonus Life",
      "settingLabel": "1500"
    }
  ]
}
```

La versión debe ser exactamente 1. `mameVersion` usa un formato numérico
exacto, los strings están acotados y sin controles, hay entre 1 y 32 DIP, mask
y value son enteros de 32 bits, value no puede usar bits fuera de mask y
`portTag + mask` es único. Los DIP se normalizan por `portTag` y después mask.
`label` y `settingLabel` son diagnóstico; la autoridad técnica es
`portTag + mask + value`.

Práctica no acepta `integrity`. Un runtime compatible por `minVersion` pero
distinto del exacto puede seguir sirviendo para Práctica y queda bloqueado para
esta Competición.

## MAME 0.287 observado

La investigación y el QA usaron `C:/MAME/mame.exe`; `-version` devolvió
`0.287 (mame0287)`. No se trasladaron tokens desde otra versión.

- controller config aceptado: `<mameconfig version="10">`;
- selección: `-ctrlrpath <run>/ctrlr -ctrlr hsl-competition`;
- secuencia sin asignación: `<newseq type="standard">NONE</newseq>`;
- `UI_CANCEL` conserva `KEYCODE_ESC`.

Tipos efectivos observados por `manager.machine.ioport:type_seq`:

| Tipo 0.287 | Función | Competition |
| --- | --- | --- |
| `UI_MENU` | Show/Hide Menu | bloqueado por controller |
| `UI_PAUSE` | Pause | bloqueado por controller |
| `UI_PAUSE_SINGLE` | Pause - Single Step / frame advance | bloqueado por controller |
| `UI_REWIND_SINGLE` | Rewind - Single Step | bloqueado por controller |
| `UI_SAVE_STATE` | Save State | bloqueado por controller |
| `UI_SAVE_STATE_QUICK` | Quick Save State | bloqueado por controller |
| `UI_LOAD_STATE` | Load State | bloqueado por controller |
| `UI_LOAD_STATE_QUICK` | Quick Load State | bloqueado por controller |
| `UI_RESET_MACHINE` | Reset Machine | bloqueado por controller |
| `UI_SOFT_RESET` | Soft Reset | bloqueado por controller |
| `UI_THROTTLE` | Throttle | bloqueado por controller |
| `UI_FAST_FORWARD` | Fast Forward | bloqueado por controller |
| `UI_TOGGLE_CHEAT` | Toggle Cheat | bloqueado por controller |
| `UI_CANCEL` | UI Cancel | `Escape`, disponible |

0.287 no expone tipos independientes llamados `UI_REWIND` o
`UI_HARD_RESET`; las funciones reales son las de la tabla. La introspección
efectiva devolvió secuencia vacía para los 13 tipos restringidos y
`KEYCODE_ESC` para `UI_CANCEL`.

En `invaders -listxml` y Lua real:

| DIP | portTag | mask | value | setting |
| --- | --- | ---: | ---: | --- |
| Lives | `:IN2` | 3 | 0 | 3 |
| Bonus Life | `:IN2` | 8 | 0 | 1500 |

Los fields tienen `type_class = dipswitch`; `field.user_value`,
`field.settings` y `port:field(mask)` funcionan en 0.287.

## Manifest competitivo v1

`competition-manifest.json` tiene forma cerrada:

```json
{
  "version": 1,
  "packId": "...",
  "files": [
    { "path": "pack.json", "sizeBytes": 1234, "sha256": "..." }
  ]
}
```

El generador `local/hsl-local-app/scripts/build-competition-manifest.js`
deriva la cobertura; el autor no proporciona una lista manual. Incluye:

- `pack.json`;
- `capture.adapter`;
- todo archivo regular bajo `mame.romPath`;
- todo archivo regular bajo `scripts/`;
- todo archivo regular bajo `mame.artworkPath`, si existe;
- todo archivo regular bajo el `cfgPath` seed de Competition, si existe.

Artwork se cubre porque el pack real contiene un `default.lay` interpretado
con `inputtag/inputmask`, capaz de accionar inputs/DIP. Samples se excluyen tras
comprobar que el pack contiene sólo WAV: MAME los reproduce como salida y no
retroalimentan el estado emulado. También se excluyen metadata, cover, hero,
icon, logo y manual, que sólo consume la presentación local.

Paths usan `/`, son relativos y ordenados; se rechazan absolutos, traversal,
symlinks y entradas especiales. Size y SHA-256 lowercase se calculan sobre los
bytes reales. El JSON usa dos espacios, ninguna fecha y un newline final. El
manifest no se incluye a sí mismo. `manifestSha256` es SHA-256 de sus bytes
exactos.

Antes de crear el run se valida schema, `packId`, cobertura derivada, tamaños y
hashes, y se ejecuta el `mame.exe` seleccionado con `-version`. Manifest o MAME
incorrectos bloquean Competition antes de crear el workspace; Práctica sigue
disponible.

## Sandbox y cfg

Cada run protegida crea:

```text
runRoot/
  cfg/ ctrlr/ nvram/ inp/ sta/ snap/ diff/ comments/ share/
  home/ ini/ plugins/ events/
```

MAME recibe todos los directorios mutables desde ese root. Ninguno puede estar
dentro del runtime instalado, del pack o del estado persistente de Práctica.

`mame.cfgPath` y `profiles.practice.cfgPath` siguen siendo cfg vivo y libre de
Práctica. `profiles.competition.cfgPath`, si existe, es sólo un seed cubierto
por el manifest que se copia a `runRoot/cfg`; nunca es el cfg vivo. Se rechaza
un seed ambiguo que sea la misma carpeta mutable usada por Práctica. Space
Invaders no necesita seed y comienza con `runRoot/cfg` vacío.

## Autoridad de argumentos

El pack no puede controlar en Competition las familias `ctrlr`, rewind,
state/autosave/playback, cheat, throttle/speed/refreshspeed/syncrefresh,
debug/debugger, autoboot, console, HTTP, plugin/pluginspath ni bench. Se
normalizan prefijos `-`, `--` y `/`, separadores `=` y `:`, guiones y
underscores. La prohibición es sólo competitiva; Práctica conserva esas
opciones cuando no invaden directorios o recursos que ya pertenecen al
launcher.

El launcher añade al final, bajo su autoridad:

```text
-ctrlrpath <run>/ctrlr -ctrlr hsl-competition
-norewind -noautosave -nocheat -noconsole -nohttp
-throttle -speed 1 -norefreshspeed -nosyncrefresh
-pluginspath <run>/plugins -plugins -plugin hsl-score
```

El `pluginspath` contiene sólo `boot.lua` del runtime seleccionado y el plugin
HSL preparado. No hereda plugins ni `plugin.ini` del runtime global.

## Monitor y ARM

`hsl-score` 0.2.0 crea el monitor al cargar el plugin y conserva las
suscripciones a notifiers. La secuencia es:

1. validar policy y versión en `startplugin`, estado `waiting`;
2. en `emu.register_prestart`, resolver cada field, escribir todos los DIP y
   releerlos; estado `prepared`;
3. en el primer frame, releer de nuevo y sólo entonces pasar a `armed`;
4. durante todos los frames, releer DIP, pausa, menú, speed y throttle;
5. recibir notifiers de pause, pre-save, post-load, reset y stop.

Una discrepancia DIP genera violación y el monitor intenta restaurar el valor,
pero restaurarlo no limpia la run. El cierre normal se distingue mediante
`exit_pending`/stop para no marcar una pausa falsa. La primera violación muestra
un único aviso; el jugador puede continuar y Playtime mantiene su ciclo normal.

Códigos, en orden canónico y sticky:

```text
dip_changed
pause
state_save
state_load
machine_reset
menu_opened
speed_changed
throttle_changed
integrity_unavailable
```

El controller implementa PREVENT y el monitor OBSERVE. La vía Lua de QA real
confirmó DIP, pause, save, load, reset, speed y throttle incluso eludiendo el
teclado. Si una API o field requerido no existe, se falla cerrado con
`integrity_unavailable`.

## Evidencia y rechazo local

El core copia el evento devuelto por el adapter a una tabla normal, descarta
cualquier `competitionIntegrity` aportado por él y escribe este schema cerrado:

```json
{
  "version": 1,
  "guardVersion": 1,
  "runId": "...",
  "packId": "...",
  "manifestSha256": "...",
  "mameVersion": "0.287",
  "dips": [
    { "portTag": ":IN2", "mask": 3, "value": 0 }
  ],
  "violations": []
}
```

No incluye `trusted`, rutas personales ni ubicación del pack. Al adoptar desde
staging, la app exige presencia, schema exacto y binding a run, pack, manifest,
MAME y DIP esperados. Evidencia ausente, malformed, falsa o con violaciones se
mueve directamente al `events/rejected` scoped con nota
`LOCAL_COMPETITION_INTEGRITY`; no entra en pending ni dispara auto-submit. El
JSON se conserva para trazabilidad local. El protocolo y backend actuales no
se modifican.

Eventos históricos y runs no protegidas conservan su validación anterior.

## Práctica

Práctica usa su estado persistente, añade `-noplugins`, no prepara el monitor y
no genera evidencia competitiva. La introspección real confirmó las
asignaciones habituales de Tab, F5, F6, F7, F3, F10, Insert y F8. Se pudo
cambiar Lives a 4 y persistirlo; una Competition posterior usó otro cfg, forzó
Lives a 3 antes del ARM y terminó limpia.

## Límites de esta fase

El manifest detecta cambios no acompañados. Si alguien modifica adapter y
regenera coherentemente el manifest, la verificación local vuelve a aceptar el
pack y produce otro `manifestSha256`. LOCAL no puede distinguir esa revisión de
una autorizada. También existe una ventana local entre verificación y consumo
de archivos, y un proceso/OS hostil puede falsear observaciones. La siguiente
fase web debe aportar la autoridad independiente; no se añaden DRM, drivers,
TPM ni hooks globales.

## Biblioteca local validada

La autoridad del launcher resolvió `D:/High Score League` y mantuvo cinco
entradas antes y después: Dig Dug, Donkey Kong, Galaga, Pac Man y Space
Invaders. Las cuatro primeras conservan su identidad y estado legacy v1; no se
modificaron ni se intentó migrarlas. Space Invaders permanece v2/current y es
el único pack con Competition protegida. La ausencia de `integrity` v1 no
produce errores de discovery ni convierte un pack en corrupto.

Space Invaders queda como referencia reproducible: el launcher/plugin contiene
toda la infraestructura genérica y el pack declara sólo ROM, recursos,
adapter, perfil visual, versión MAME y DIP específicos del juego.

Referencias de la API investigada: [Lua input](https://docs.mamedev.org/luascript/ref-input.html),
[Lua core/notifiers](https://docs.mamedev.org/luascript/ref-core.html),
[controller config](https://docs.mamedev.org/advanced/ctrlr_config.html).
