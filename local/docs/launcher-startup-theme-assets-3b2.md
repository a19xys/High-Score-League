# Startup, tema y assets del launcher (3B.2)

## Alcance y flujo real

El flujo anterior esperaba la migración de sesiones antes de crear la ventana, creaba
`BrowserWindow` con fondo oscuro fijo y dejaba que `theme-bootstrap.js` resolviera un
segundo estado desde `localStorage`. `ready-to-show` mostraba una shell ya montada pero
todavía técnica; `refreshState()` retiraba el overlay al terminar un mínimo cosmético de
600 ms, aunque preferencias, selección o imágenes aún pudieran cambiar. La precarga de
hero/logo conservaba cada Promise para siempre, incluidos fallos y timeouts.

El flujo actual es:

1. Electron queda listo y `main` lee el tema del sistema.
2. `main` lee/migra `hsl/preferences/theme.json`, resuelve el tema efectivo y lo persiste.
3. Se inicializan seguridad, IPC y servicios; la migración local de sesiones continúa en
   una Promise que solo bloquea el snapshot local inicial.
4. `BrowserWindow` se crea oculta con un `backgroundColor` del mismo tema efectivo.
5. Preload expone el tema efectivo como dato síncrono, sin archivos ni secretos.
6. El bootstrap externo aplica `data-theme` y `color-scheme` antes de cargar CSS.
7. El renderer monta `#app` una sola vez y muestra una capa de startup opaca del tema.
8. `getInitialState()` espera solo el trabajo local y solicita membership diferido.
9. El snapshot aceptado hidrata preferencias, biblioteca y selección detrás de la capa.
10. Solo los assets del detalle inicial se resuelven con timeout; los assets de cards fuera
    del primer viewport, conectividad, health, Ranking, membership y autoenvío no bloquean.
11. Readiness retira la capa una sola vez como `ready` o `degraded`.

Los hitos sanitizados registran únicamente duraciones relativas y estado: tema, creación
y muestra de ventana, primer documento, shell, snapshot, selección, assets e interfaz
interactiva. No contienen rutas, identidades, tokens ni datos de sesión.

## Contrato canónico de tema

La autoridad vive en `main`, en `userData/hsl/preferences/theme.json`. El namespace
`hsl/` evita colisionar con el archivo nativo `userData/preferences` que Chromium/Electron
puede crear en perfiles de desarrollo:

```json
{
  "schemaVersion": 1,
  "mode": "system | manual",
  "manualTheme": "light | dark | null",
  "lastSystemTheme": "light | dark | null",
  "effectiveTheme": "light | dark",
  "updatedAt": "ISO-8601"
}
```

`mode` es interno. La interfaz solo alterna Claro/Oscuro y nunca ofrece “Sistema”. En el
primer arranque se usa el sistema; si no puede leerse, se deriva Oscuro. Una elección
manual conserva el tema y la última observación legible del sistema. Si en otro arranque
la observación difiere, se abandona la elección manual y se vuelve al modo derivado. No
se escucha `nativeTheme` para cambiar la apariencia durante una sesión abierta.

Los formatos antiguos `light`, `dark`, una cadena JSON o `{ "theme": ... }` migran como
elección manual. Un estado corrupto se clasifica y cae a sistema/Oscuro. Si un estado
manual es válido y el sistema no se puede leer, no se borra ni se cambia. El antiguo
`localStorage` se consulta únicamente en una migración inicial autorizada por `main`; la
resolución síncrona confirma la escritura antes del CSS y luego elimina esa copia. No es
una segunda preferencia.

El layout inicial de 3B.2, `userData/preferences/theme.json`, se migra por copia únicamente
si `preferences` es realmente un directorio. Si esa entrada es un archivo nativo de
Electron, se conserva intacto, se registra `legacy-preferences-file-preserved` y se usa el
namespace HSL nuevo. Si el directorio o archivo canónico está ocupado por un tipo de entrada
incompatible, la persistencia devuelve un error clasificado y nunca elimina la entrada.

Un cambio manual se escribe primero en `main`. Solo tras una respuesta válida se cambia
`documentElement`; si falla la escritura, el tema visible permanece intacto. El cambio
actualiza `data-theme`, `color-scheme`, el fondo nativo y la región del control de tema,
sin remontar `#app`.

## Readiness y degradación

La máquina de startup mantiene fases independientes:

- tema;
- shell;
- estado local;
- biblioteca o presentación definitiva de vacío/error;
- selección reconciliada;
- assets críticos resueltos o sustituidos.

El mínimo visible es 250 ms y el máximo total 4 s. Una biblioteca vacía y un asset sin
URL usan fallback definitivo y pueden quedar `ready`. Biblioteca inaccesible, fallo local
o timeout quedan `degraded`, retiran igualmente la capa y muestran una interfaz útil. Un
snapshot tardío puede completar la UI en segundo plano, pero ningún evento remoto puede
reactivar el startup. El cierre cancela ambos timers.

## Autoridad y ciclo de assets

Cada snapshot aceptado deriva una generación visual del detalle a partir de selección,
hero/cover y logo/icon. Cada `<img>` declara ámbito, selección, URL, tipo y generación.
Los listeners delegados solo aplican `load`/`error` si los cuatro campos siguen
coincidiendo con el estado actual. Por ello A→B, A→B→C y A→B→A no permiten que un
callback antiguo modifique el nodo actual. Un asset nunca cambia selección ni fabrica un
snapshot global.

Hero y logo son nodos independientes sobre un fallback HSL permanente. El fallo de uno
solo oculta ese nodo. Cards de biblioteca mantienen un fallback de iniciales detrás de
la imagen; cargar una card solo cambia ese nodo y no reconstruye lista, header o toolbar.
Los stages reservan `aspect-ratio`, altura y clipping desde el primer render.

El preloader comparte cargas concurrentes y devuelve `loaded`, `error`, `timeout`,
`missing` o `cancelled`. Usa timeout de 1,2 s, LRU máximo de 128 URLs, retención de éxito
de 10 minutos y retry de fallos tras 5 s. Timeout/cancelación limpian timer, `onload`,
`onerror` y la fuente temporal; `dispose()` cancela cargas y vacía caché. Solo hero/logo
del primer detalle bloquean readiness. Las fuentes locales usan `font-display: optional`
para evitar un intercambio tardío excesivo.

Las escrituras de tema usan temporales únicos en el mismo directorio, reemplazo por rename
y limpieza del temporal al fallar. Main serializa los cambios manuales; el renderer también
encadena los clics rápidos para que no compitan ni calculen todos el mismo destino. Un fallo
IPC se devuelve como `ok: false` con un código permitido, sin rutas ni causa interna.

## Cleanup, riesgos y 3B.3

`beforeunload` retira listeners IPC, señales de conectividad, observers, animation frames,
debounces, timers de readiness y cargas de imagen. Main detiene los servicios remotos en
el cierre ya existente.

Riesgos residuales: el smoke visual depende de los temas que el host permita simular; un
asset del DOM puede terminar tarde para la misma selección, aunque nunca para otra; y la
política `font-display: optional` puede usar la fuente del sistema en una máquina con I/O
local excepcionalmente lento. 3B.3 conserva copy completa, densidad final, Ranking,
badges, accesibilidad global y pulido visual general.
