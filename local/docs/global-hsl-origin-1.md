# GLOBAL HSL ORIGIN 2

El launcher resuelve un unico `hslOrigin` propio de la aplicacion. El orden es:

1. `HSL_ORIGIN`, como override explicito de desarrollo.
2. `hslOrigin` en la configuracion empaquetada del launcher.
3. El origen oficial compilado `https://high-score-league.vercel.app`.

Durante la migracion se acepta `config.webBaseUrl` como alias deprecado. Su
fuente se registra como `legacy-webBaseUrl`; el archivo del usuario no se
reescribe. El valor debe ser una URL absoluta HTTP(S), sin credenciales, query
ni hash, y se reduce a su origen normalizado.

`pack.webBaseUrl` es solo metadata auditada. Same-origin es compatible;
foreign-origin o un valor invalido generan warning. Packs, seleccion,
biblioteca, metadata y `state.bridge` nunca cambian `hslOrigin` ni los endpoints
de health y Ranking.

El estado `remoteConfiguration.status` distingue `configured`, `missing` e
`invalid`. Los dos ultimos no significan offline, no lanzan probes y se
muestran como un problema de configuracion. `offline` queda reservado para un
origen valido que no ha podido alcanzarse.

Las herramientas administrativas dependen solo de `developerToolsEnabled`:
esta activo en Electron no empaquetado, desactivado en produccion empaquetada y
puede habilitarse con `HSL_DEVELOPER_TOOLS=1`. `devBridge` conserva unicamente
las operaciones del puente legacy. Los IPC administrativos aplican la misma
guarda en el proceso principal aunque el renderer no muestre sus botones.
