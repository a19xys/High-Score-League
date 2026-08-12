# Invariantes de renderizado de Biblioteca

## Alcance

4V.2 y 4V.4 estabilizaron la geometría, el viewport y el scroll de Biblioteca. `LOCAL-LIBRARY-RENDER-INVARIANTS-1` añade un contrato posterior: una actualización que no cambia los resultados visibles conserva también los nodos de las tarjetas y sus assets.

El defecto se reprodujo con la cadena real del fixture `Comprobar conexión -> Connectivity -> Week Capabilities -> launcher:state`. El nuevo `weekCapability` cambiaba el HTML completo de la tarjeta. La antigua proyección estructural neutralizaba selección, busy y favoritos, pero no ese estado, por lo que `library-packs` terminaba reescribiéndose mediante `innerHTML`.

## Estructura y presentación viva

La decisión de renderizar se toma después de filtrar, ordenar y agrupar el conjunto visible. La topología contiene exclusivamente:

- vista, agrupaciones y orden visible;
- identidad de pack, instancia y favorito;
- título, subtítulo y metadata que la vista presenta;
- identidad y tipo del asset visual.

Son presentación viva y se sincronizan sobre los nodos existentes:

- selección y atributos interactivos;
- busy, pending y disponibilidad temporal;
- favorito y su estado pending/bloqueado;
- `pack.status` y `weekCapability`, incluidos texto, clase, tono, `title` y `aria-label`.

Favoritos y `pack.status` siguen siendo estructurales cuando un filtro activo hace que una tarjeta entre o salga del conjunto visible. Los cambios reales de metadata, media, identidad, grupo, orden o vista continúan generando un render estructural.

## Plan de renderizado

Con la misma clave de topología, el sincronizador comprueba primero que cantidad, orden e `instanceKey` del DOM coincidan exactamente con el modelo. Si coinciden, actualiza la presentación y prima `regionRenderer` con el HTML completo nuevo sin escribir `library-packs`. Si no coinciden, invalida la snapshot y ejecuta el render estructural seguro; nunca aplica un patch parcial.

La semántica de los estados vive en una sola proyección compartida por Portadas, Lista e Iconos. Las dos primeras actualizan el badge y la tercera el beacon, manteniendo la misma autoridad.

## Política de scroll

Una actualización pasiva no escribe `scrollTop`, no persiste posiciones y no usa timers, `requestAnimationFrame`, `scrollIntoView` ni compensación geométrica. Al conservar scroller, tarjetas e imágenes, un asset resuelto no vuelve a `pending`.

Los resets deliberados continúan limitados a acciones que cambian los resultados: búsqueda, temporada, criterio y dirección de orden, y filtro Solo favoritos. El cambio de vista conserva su contrato actual. El scroll del detalle sigue siendo independiente: cambia de pack lo lleva al inicio; una actualización del mismo pack no.

## Cobertura

Los contratos unitarios cubren topología, filtros, metadata/media, los seis estados visibles, accesibilidad, mismatch defensivo y sincronización de snapshots. El fixture BrowserWindow reproduce la actualización manual en Portadas a mitad y cerca del final, Lista e Iconos; repite tres refresh consecutivos y publica además un `launcher:state` pasivo sin clic. La traza comprueba cada frame, eventos de scroll, geometría e identidad de scroller, todas las tarjetas y todas las imágenes.

La regresión específica de cierre crea además cinco packs temporales reales, configura un `HSL_USER_DATA_DIR` aislado y obtiene seis snapshots del catálogo mediante `launcher-service` y `library-snapshot-authority`. El BrowserWindow conserva el renderer y `runAction()` reales; solo simula las fronteras remotas de Connectivity/Membership/profile/ranking. Recorre Portadas 2+2+1 y 1x5 en varias alturas, incluida `maxScrollTop - 1`, y comprueba también que una posición más reciente establecida durante la cascada no se sustituye por la del inicio de la operación.
