# Biblioteca: geometría, continuidad y cuenta — 4V.2 + 4V.4

## 1. Objetivo y alcance

Esta entrega restaura la densidad de la biblioteca, separa explícitamente el scroll izquierdo del detalle y compacta la secuencia `Biblioteca → controles → packs`. También integra `Olvidar cuenta` con el lenguaje visual azul del menú sin rebajar su semántica destructiva. No mueve Favorito ni `Pack listo` al hero: 4V.3 queda reservado.

## 2. Base e implementación heredada

La base anunciada era `cea9a05b8b0864abdd99102c091ecf3daa80373b` (`Estabilizar cuenta, participación y conectividad v1`), pero el árbol recibido estaba limpio en `master`, SHA `266ffa347af5ac7f50e60c4f4b294766ed80f327` (`Estabilizar cuenta, participación y conectividad v2`). El delta ya confirmado entre ambas revisiones contiene 4V.1B: precompromiso y refresh manual de conectividad, coordinación inicial de membership, convergencia de participación, `Comprobando participación`, `Pack listo`, gate y copy de `Jugar`, además de sus pruebas y documentación. Se tomó ese commit como baseline heredado y no se reescribió ninguna de esas autoridades.

El baseline ejecutado antes de editar fue: launcher `740/740`, raíz `9/9`, Node `v24.18.0`, npm `12.0.1`; solo apareció el warning conocido `MODULE_TYPELESS_PACKAGE_JSON`.

## 3. Geometría reconstruida

| Propiedad | Contrato documentado | Valor efectivo anterior / regla ganadora | Impacto | Decisión final |
| --- | --- | --- | --- | --- |
| Sidebar | mínimo razonable, `440 px` por defecto, `600 px` máximo | UI `340/440/600`; persistencia acepta desde `320` y la UI vuelve a limitar a `340` | El rango era estable, no era la causa | Mantener `340/440/600` y centralizar el contrato de UI |
| Tile Iconos | aproximadamente `122 px`, 1:1 | `minmax(122px, 1fr)`, gap horizontal `8 px` | Correcto; no debía comprimirse | Mantener mínimo `122 px`, tracks completos y media 1:1 |
| Inset exterior | El mínimo necesario | `.library-scroll` conservaba `16 px`; panel tenía borde y `14 px` por lado | Reducía el ancho útil a unos `503 px` con scrollbar clásico | Quitar el padding duplicado; panel `12 px` por lado |
| Viewport de packs | Espaciado legible | Regla final `8 px` izquierda / `12 px` derecha más gutter estable | Impedía alcanzar los `512 px` que exigen cuatro tiles y tres gaps | `6 px` simétricos, `14 px` inferior, sin overflow X |
| Scrollbar | Estable, sin salto | El propio bloque de packs usa `overflow-y: scroll`; además hereda `scrollbar-gutter: stable` | Hay que presupuestar un scrollbar clásico | Cálculo y pruebas con `17 px`, además de overlay scrollbar |
| Detalle derecho | Utilizable en ventana mínima | La última regla permitía `minmax(0, 1fr)` y `body` exigía `1180 px` dentro de un viewport nativo de `1164 px` | Podía quedar demasiado estrecho y creaba `16 px` de overflow raíz | Track derecho `minmax(540px, 1fr)` y `body min-width: 0` |

La causa de las tres columnas en el máximo no era un máximo insuficiente: los insets duplicados dejaban menos de los `512 px` necesarios para `4 × 122 + 3 × 8`. Se conservó el máximo de `600 px`.

## 4. Contrato final de layout

`gui/renderer/library-geometry.js` concentra las métricas comprobables: sidebar `340/440/600 px`, resizer `8 px`, detalle mínimo `540 px`, tile mínimo `122 px`, gap horizontal `8 px`, inset de panel `26 px` incluido borde y padding, y padding horizontal del viewport `12 px` en total.

Con scrollbar clásico de `17 px`, los saltos calculados son:

- `340–436 px`: dos columnas.
- `437–566 px`: tres columnas.
- `567–600 px`: cuatro columnas.
- Una quinta columna requeriría al menos `697 px`, fuera del máximo.

Con scrollbar overlay cambian los umbrales, pero no los resultados canónicos: mínimo 2, valor por defecto 3 y máximo 4. Portadas y Lista conservan sus propias reglas. La grid de Iconos usa tracks completos, no genera una quinta columna parcial y mantiene los assets dentro de una media cuadrada estable.

La BrowserWindow del fixture midió, a zoom 100 %, `2/3/4` columnas en `340/440/600 px`; en el máximo obtuvo tiles de `130.75 px`, detalle de `556 px` y cero overflow horizontal tanto en el documento como en la biblioteca. A zoom de página `125 %` y `150 %` mantuvo cuatro columnas, detalle de `540 px` y cero overflow. Estos zooms son una aproximación dentro de Electron, no una prueba física de escalado de Windows.

## 5. Anchura, persistencia y recuperación

El resizer conserva ratón, flechas de `20 px`, `Home → 440 px` y persistencia vigente. Se añadieron `aria-valuemin`, `aria-valuemax` y `aria-valuenow`. La preferencia sigue siendo por cuenta cuando hay identidad de jugador y usa el fallback global existente; no se añadió otro store ni se persistió el scroll. Valores no numéricos recuperan `440 px` y valores antiguos fuera del rango UI se limitan a `340–600 px` sin tocar las demás preferencias.

## 6. Política de scroll

### Biblioteca izquierda

El nodo `.library-section--packs` es el viewport que realmente hace scroll. Antes llevaba `data-preserve-scroll` solo un descendiente inexistente para este caso: el capturador buscaba dentro de la región, pero no consideraba la propia región. Por eso su contrato explícito no cubría el nodo ganador.

Ahora el viewport de packs tiene identidad regional persistente y `data-preserve-scroll="library-packs"`; la captura incluye la región misma y sus descendientes acotados. Seleccionar otro pack, cambiar el detalle, membership, conectividad, favoritos, actividad o rechazar un snapshot stale preservan el `scrollTop` izquierdo. No hay `scrollIntoView` automático, mapa por pack ni escritura en `userData`. Si un filtro, orden o vista reduce/cambia drásticamente el contenido, se intenta restaurar la posición y el navegador la limita al nuevo máximo; el mismo píxel no se promete entre geometrías distintas.

### Detalle derecho

`.game-scroll` solo vuelve a cero cuando cambia la clave de identidad real de detalle. Membership, conectividad, actividad, badges o snapshots del mismo pack mantienen ambos scrolls. Una respuesta stale se rechaza antes de afectar el layout. En el smoke: biblioteca `720 → 720` al seleccionar, detalle `202 → 0`; después un snapshot del mismo pack conservó biblioteca `640` y detalle `180`.

## 7. Espaciado bajo Biblioteca

La causa exacta era de cascada y estructura: `.panel-heading` aportaba `margin-bottom: 14px`; la regla correctora usaba el selector de hijo directo `.library-panel > .panel-heading`, pero el wrapper regional `.render-region-contents` sigue siendo el padre DOM aunque tenga `display: contents`. La regla no coincidía y, sumada al gap del panel, producía `20 px` efectivos.

La regla final usa `.library-panel .panel-heading { margin-bottom: 0; }`, el panel tiene `gap: 6px` y `padding: 12px`, y no se añadió spacer ni margen negativo. La misma jerarquía se conserva en Portadas, Lista, Iconos y estados vacíos/no disponibles; el subpanel de filtros solo ocupa espacio cuando existe.

## 8. `Olvidar cuenta`

Antes el control era `26 × 26 px`, no declaraba radio propio y el hover/foco ganador era rojo de error. El resultado parecía un cuadrado aislado dentro de la fila.

Ahora mide de forma fija `30 × 30 px`, centra el icono y usa `var(--control-radius)` (`8 px`). Normal permanece discreto; hover y `focus-visible` emplean `var(--circuit)` con mezclas semánticas para borde/fondo, y active aumenta moderadamente la intensidad. El SVG hereda `currentColor`; no hay rojo hardcodeado ni cambio de tamaño, por lo que no desplaza la fila. El fixture observó el mismo tamaño/radio y azul en temas oscuro y claro.

Se conservan `title` y `aria-label="Olvidar cuenta"`, botón nativo y activación por teclado. El árbol recibido no contenía la confirmación que el contrato daba por existente, así que se restauró un diálogo accesible con `role="dialog"`, `aria-modal`, título y descripción explícitos. Cancelar recibe el foco inicial, no llama al borrado y devuelve el foco al botón de origen. Confirmar sigue delegando en el único `removeKnownAccount(userId)` existente: no se tocaron sesiones canónicas, tombstones, cuenta activa, colas ni puntuaciones. El smoke solo canceló sobre una cuenta fixture; el camino destructivo se cubre con tests, no se ejecutó sobre una cuenta real.

## 9. Pruebas y smoke

La cobertura focalizada incluye cálculos de 2/3/4 columnas, ausencia de quinta parcial, breakpoint a un píxel, clamp/Home, presupuesto del detalle, reglas ganadoras de padding/gutter/overflow, tiles 1:1, independencia de Portadas/Lista, jerarquía compacta, identidad regional y scroll, rechazo stale, ausencia de `scrollIntoView`, estilo estable azul/radio y confirmación/foco de cuenta. Las suites de cuenta/sesión cubren la eliminación vigente y la preservación de datos locales.

Resultados finales: batería dirigida `158/158`, launcher completo `751/751` y raíz `9/9`. El comando oficial `npm.cmd --prefix local/hsl-local-app run gui` arrancó Electron y se cerró de forma intencional después del smoke; no quedaron procesos. Solo se mantuvo el warning conocido `MODULE_TYPELESS_PACKAGE_JSON`.

Se ejecutó una BrowserWindow real con 48 packs y cuentas sintéticas, sin red ni datos reales. Se observaron: cuatro columnas completas, cero overflow X, detalle utilizable, 2/3/4 columnas en mínimo/default/máximo, `Home` y flechas, scrolls independientes, snapshots del mismo pack y stale, gap efectivo `6 px`, tiles 1:1, hover/foco azul en claro/oscuro, diálogo, Cancelar y restauración del foco. Los estados de conectividad, membership, Ranking y eliminación confirmada quedaron cubiertos por tests; no se validaron contra servicios, cuenta o biblioteca reales.

## 10. Riesgos residuales

- No se probó físicamente el escalado de Windows a 125 %/150 %; solo zoom de página de Electron.
- El fixture no sustituye QA con biblioteca larga, cuenta miembro, red, Ranking o MAME reales.
- No se ejecutó un instalador empaquetado.
- Permanece el warning preexistente `MODULE_TYPELESS_PACKAGE_JSON` en tests ESM.
- El backend histórico acepta preferencias desde `320 px`; la UI documentada y aplicada sigue recuperándolas dentro de `340–600 px`.

## 11. Trabajo reservado

4V.3 permanece intacta: no se movieron Favorito ni `Pack listo`, no se añadieron heart/check al hero y no se cambió la autoridad de favoritos, membership ni `Jugar`.
