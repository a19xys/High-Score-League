# Convergencia de Playtime al cerrar MAME

## Autoridad local

Playtime es offline-first. Una sesión empieza únicamente cuando el proceso real
de MAME emite `spawn`. Al cerrar MAME, el lifecycle termina de escribir el evento
pendiente durable y reconcilia `summary.json` antes de que la operación de juego
termine. El resumen conserva el total local aunque el evento reciba después un
ACK remoto; la red nunca es requisito para actualizar la interfaz.

`Tiempo jugado` significa el acumulado histórico local de la cuenta activa para
el `gameId` seleccionado. No se agrega por `packId`, semana, sesión ni modo. Dos
packs con el mismo `gameId` muestran por tanto el mismo valor.

## Publicación post-MAME

Los handlers IPC siguen reservando `launcherStateRevision` al comenzar. Este
orden causal impide que una solicitud antigua gane solo porque acaba más tarde y
no debe cambiarse.

Una ejecución larga puede convivir con snapshots de fondo posteriores. Cuando
MAME hizo `spawn`, llegó a `mame-closed` y el estado final es válido, el proceso
principal reutiliza ese estado y publica una convergencia post-MAME con una
revisión recién reservada. La publicación pasa por el mismo enriquecimiento
seguro de un snapshot completo, sin refrescos remotos adicionales. Un preflight
rechazado no publica convergencia.

El renderer mantiene su gate estricto: rechaza toda revisión menor o igual que
la mayor aplicada. No existe un patch directo de `game.playTime`. Primero se
acepta el snapshot post-MAME fresco; si después llega la respuesta IPC original
con su revisión antigua, se descarta. Si un cambio de cuenta o contexto más
nuevo toma autoridad mientras se prepara la convergencia, esa convergencia
también se descarta.

## Sincronización remota

El cierre de MAME solicita sync con intención explícita de follow-up. Si ya hay
una sync sana en vuelo, no se aborta ni se crea otra en paralelo: se marca una
única pasada posterior coalescida. Esa pasada vuelve a enumerar `pending`, por lo
que alcanza eventos creados después del snapshot de la pasada anterior. Varias
intenciones concurrentes se colapsan; una mutación nueva durante el follow-up
puede volver a solicitar una sola pasada posterior.

Offline, bajo `Retry-After`, ante fallos de transporte o con autenticación
diferida, el evento permanece durablemente pendiente. El follow-up respeta el
backoff existente y no añade polling, intervalos ni esperas artificiales.

Los diagnostics persistidos incluyen el estado de la sync, contadores de
pending/ACK/preservados/fallos, follow-up, backoff y los últimos totales remotos
confirmados. Esos totales son solo observabilidad: nunca sustituyen al resumen
local. Tokens, credenciales, email y rutas de sesión no forman parte del payload.

## Contrato visual

La ficha conserva únicamente estos cuatro metadatos:

- Desarrollador
- Año
- Géneros
- Tiempo jugado

El formato compacto de `Tiempo jugado` es:

- `No jugado` para cero segundos;
- `X s` entre 1 y 59 segundos;
- `X min` entre 60 y 7199 segundos, con minutos enteros;
- `X,X h` desde 7200 segundos, con locale español y un decimal.

No se muestran aquí última partida, duración reciente, modo, sesiones,
desgloses ni analítica. La separación de producto que debe sobrevivir a futuros
refactors es: ficha para el acumulado del juego; Actividad local para la sesión
reciente; una futura experiencia web para histórico y analytics.
