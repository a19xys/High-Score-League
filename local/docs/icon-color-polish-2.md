# LOCAL-LAUNCHER-ICON-COLOR-POLISH-2

## Alcance

Este ajuste conserva el sistema general de iconos tintados con `currentColor` y
anade excepciones visuales localizadas para contextos donde el color global no
representa la jerarquia correcta.

## Excepciones

- `app-brand-icon` muestra el asset original con `ui-icon__img` visible y oculta
  el glyph enmascarado. El logo HSL no es un pictograma monocromo y no debe
  convertirse en una silueta azul.
- El icono de `Jugar` usa `var(--text-inverse)` para mantener contraste blanco
  sobre el boton primario.
- Los botones de vista heredan `currentColor`: inactivos con `var(--text-muted)`
  y activos con `var(--circuit)`.
- Metadata y calendario del detalle usan una mezcla gris basada en
  `var(--text-muted)` para no competir con los valores.
- Luna y sol tienen reglas explicitas: luna blanca y sol negro.
- Favoritos de packs en tema claro usan fondo, borde y estrella mas ligeros;
  el tema oscuro queda gobernado por las reglas previas.
- El calendario de subtitulo en Portadas y Lista baja a 12px para alinearse con
  el texto compacto.
- El filtro de favoritos fuerza el icono a `currentColor` tambien en estado
  activo.

## Layout

No se cambian dimensiones externas de `.ui-icon` ni de sus clases de contexto.
Los cambios son de color, visibilidad interna del icono de marca o composicion
del footer. La tarjeta de actividad local elimina solo la etiqueta redundante
del resumen.
