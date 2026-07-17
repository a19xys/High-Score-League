# ELECTRON CUSTOM PROTOCOL BACKLOG 1

Electron recomienda evitar `file://` porque su modelo de origen y acceso a
archivos es mas amplio y menos expresivo que un esquema privilegiado diseñado
para la aplicacion. Esta tarea mantiene `loadFile()` deliberadamente: mezclar
CSP, protocolo, MIME, resolucion de assets y paths de packs aumentaria el riesgo
de una regresion funcional dificil de aislar.

## Alcance actual de file

- documento, modulos ES, CSS, fuentes e imagenes empaquetadas del renderer;
- imagenes externas de packs convertidas a URL `file://` despues de validar
  ruta relativa, pertenencia al pack, extension y existencia;
- `localStorage` del tema asociado al documento;
- imports relativos entre modulos.

La CSP meta reduce la superficie, pero `img-src file:` sigue siendo un riesgo
residual que debe revisar una auditoria externa.

## Requisitos de un posible hsl-app

Un handler futuro debe usar paths canonicos y allowlists de recursos, prevenir
traversal y escapes mediante symlinks, asignar MIME types exactos, rechazar
archivos y extensiones no autorizados, separar assets empaquetados de assets de
packs cuando proceda, y entregar CSP mediante cabecera. Debe preservar imports
relativos, fuentes, tema, preload e IPC sin conceder red al renderer.

Las pruebas deben cubrir encoding y doble encoding, paths absolutos, `..`,
separadores Windows, UNC, symlinks, archivos inexistentes, MIME incorrecto,
rangos, cache, CSP, navegación y todos los formatos reales de imagen.

## Decisión pendiente de auditoria

El auditor externo debe elegir entre:

1. mantener `file://` con CSP meta y aceptar el residual;
2. migrar solo el documento del renderer;
3. separar protocolo del renderer y protocolo de assets;
4. usar un unico protocolo con rutas estrictamente allowlisted.

No se elige una opcion en esta tarea. Tampoco se introducen `hsl-app://`,
handlers, nuevos esquemas de assets ni cambios de carga de imagenes.

