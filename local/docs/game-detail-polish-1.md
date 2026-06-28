# LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1

Pulido de la ficha del juego seleccionado en la primera capa del launcher.

## Alcance

- Solo cambia la presentacion del panel derecho del renderer.
- No cambia MAME, runtime, plugin, captura, payload, duplicateKey, endpoints,
  RLS, membership, scoped queue, auto-sync, contratos de pack ni `config.json`.
- No cambia los handlers de `Jugar`, `Practicar`, `Manual`, `Ranking` ni
  `Ver detalles`.

## Ficha del juego

La ficha queda organizada como:

```text
banner horizontal
chips humanos
logo + titulo + semana
metadata con icono, etiqueta y valor
descripcion local si existe
botonera 2x2
actividad local integrada
```

El banner usa `hero` y cae a `cover`. Si no hay asset, muestra un placeholder
HSL contenido. El banner tiene altura maxima y deja de actuar como fondo gigante
de toda la ficha.

La metadata visible se limita a campos de presentacion local:

- desarrollador o publisher;
- ano;
- genero;
- tiempo de juego.

No se muestran `packId`, `gameId`, `weekId`, rutas locales, scope, `session.json`
ni datos tecnicos en la ficha.

## Estados Humanos

Los chips visibles se limitan a cuatro entradas como maximo. Los estados de
cuenta sin sesion no ocupan chip en esta capa; el estado de cuenta vive en el
header. Legacy usable degrada el chip principal a `Listo con avisos` y conserva
`Legacy` como chip secundario.

## Actividad

La subtarjeta de actividad muestra solo:

- `Sincronizado`;
- `Pendiente de sincronizar`;
- `Requiere atencion`;
- `Ver detalles >`.

Los contadores, pendientes, enviadas, failed recuperable y detalles tecnicos
siguen en el drawer de actividad.

## Layout

La biblioteca izquierda se reduce ligeramente de anchura maxima para dar mas
aire al detalle derecho. El panel derecho mantiene scroll interno y la botonera
2x2 conserva las acciones existentes.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CARDS-1

El panel derecho no cambia funcionalmente. La biblioteca pasa a tener anchura
ajustable entre 360px y 600px; el detalle usa el espacio restante sin volver al
scroll global.

## Validacion

Los tests protegen:

- estructura `game-detail-card`, `game-hero-stage` y `game-detail-body`;
- metadata `meta-label`/`meta-value`;
- chips acotados;
- ausencia de `getReadyLabel` como descripcion tecnica de fallback;
- actividad local integrada sin contadores en primera capa;
- CSS del banner contenido y de la nueva grilla.

## Continuidad LOCAL-LAUNCHER-ICON-SYSTEM-1

La ficha usa el sistema local de iconos para `Jugar`, `Practicar`, `Manual`,
`Ranking`, semana, desarrollador, ano, genero, tiempo jugado y actividad local.
Los SVG esperados viven en `gui/renderer/assets/icons/` y tienen fallback si
aun no existen: `play.svg`, `practice.svg`, `manual.svg`, `ranking.svg`,
`developer.svg`, `year.svg`, `calendar.svg`, `genre.svg` y `playtime.svg`.
