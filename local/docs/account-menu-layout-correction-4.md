# LOCAL-LAUNCHER-ACCOUNT-MENU-LAYOUT-CORRECTION-4

Correccion final del layout compacto del menu de cuenta.

## Aplicado

- El header con sesion queda como boton de avatar/siglas, sin correo visible ni
  ovalo ancho.
- El header sin sesion mantiene `Sin sesión`.
- La cabecera interna del menu muestra avatar, label corto e email visible.
- La lista de cuentas vuelve a mostrar email por fila, con avatar a la
  izquierda, check de activa y `Olvidar cuenta` integrado a la derecha.
- Se compactan los gaps entre `Cuentas` y la primera fila, y entre filas.
- `LOCAL-LAUNCHER-ACCOUNT-LIST-EMAILS-SPACING-FIX-5` fuerza el email como texto
  principal visible de cada fila y anula el margen global `.account-row` dentro
  del menu.
- `LOCAL-LAUNCHER-ACCOUNT-LIST-EMAILS-ROOT-CAUSE-6` identifica que
  `.known-accounts--menu li` heredaba el grid de `.known-accounts li`; al tener
  un unico hijo `.account-row__surface`, la fila caia en una columna de `32px`.
  La fila del menu resetea ese grid con `display: block` y
  `grid-template-columns: none`.
- `LOCAL-LAUNCHER-ACCOUNT-MENU-FINAL-SPACING-7` sube ligeramente la altura de
  filas, aumenta el email a `13px`, da mas aire controlado entre cuentas y
  conserva `min-width: 0` + ellipsis en email y contenedores.
- La X de olvidar se centra con `display: grid`, `place-items: center`,
  `line-height: 1` y `padding: 0`.

Se mantienen intactos apertura limpia, cancelar, Escape, click exterior,
seleccion de texto dentro del menu, login, cambio de cuenta y olvidar cuenta.
No se toca MAME, runtime, plugin, colas, puntuaciones, packs ni biblioteca.
