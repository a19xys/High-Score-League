# ELECTRON CSP POLICY 1

El documento principal del launcher se carga con `BrowserWindow.loadFile()` y
entrega una sola CSP mediante una etiqueta `meta http-equiv` situada antes de
cualquier script, hoja de estilos o recurso.

## Politica literal

```text
default-src 'none'; script-src 'self'; script-src-elem 'self'; script-src-attr 'none'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' file:; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

## Directivas

| Directiva | Motivo |
| --- | --- |
| `default-src 'none'` | Deniega cualquier tipo de recurso no autorizado expresamente. |
| `script-src 'self'` | Permite solo JavaScript local del renderer. No permite eval ni inline. |
| `script-src-elem 'self'` | Restringe elementos script a archivos locales. |
| `script-src-attr 'none'` | Bloquea handlers JavaScript en atributos HTML. |
| `style-src 'self'` | Permite solo hojas CSS locales. |
| `style-src-elem 'self'` | Restringe elementos y links CSS a recursos locales. |
| `style-src-attr 'unsafe-inline'` | Excepcion temporal solo para atributos y propiedades de estilo calculadas. |
| `img-src 'self' file:` | Permite imagenes empaquetadas y assets `file://` validados de packs. |
| `font-src 'self'` | Permite Manrope y Sora empaquetadas. |
| `connect-src 'none'` | Impide fetch, XHR, WebSocket y EventSource desde renderer. |
| `media-src 'none'` | No hay audio ni video HTML. |
| `object-src 'none'` | Impide plugins y objetos embebidos. |
| `frame-src 'none'` | Impide iframes. |
| `child-src 'none'` | Defensa compatible para contextos hijos. |
| `worker-src 'none'` | No hay workers. |
| `manifest-src 'none'` | No hay manifest web. |
| `base-uri 'none'` | Impide cambiar la base de resolucion del documento. |
| `form-action 'none'` | Impide submits HTML fuera del flujo IPC. |

No se incluyen wildcards, dominios remotos, `http:`, `https:`, `ws:`, `wss:`,
`blob:`, `data:`, nonces, hashes, `unsafe-eval` ni `unsafe-inline` para scripts.

## Excepcion de estilos

`style-src-attr 'unsafe-inline'` cubre exclusivamente:

- `colorScheme` del tema inicial y de los cambios de tema;
- `--library-sidebar-width` calculado en el layout;
- `--favorite-mark-left` y `--favorite-mark-top` para la estrella del titulo;
- `--icon-url` de los iconos locales enmascarados.

No autoriza scripts inline, etiquetas `style`, CSS remoto ni conexiones de red.
Eliminar esta excepcion requerira una tarea visual separada que evalúe clases
discretas, CSS Typed OM o una stylesheet controlada.

## Recursos y cambios

`theme-bootstrap.js` se carga de forma sincrona en `head`, despues de la CSP y
antes de las hojas CSS. `app.js` sigue siendo un modulo ES local al final de
`body`. Los handlers inline de carga/error de iconos se sustituyeron por
listeners delegados. Los covers, heroes, iconos y logos de packs conservan las
validaciones existentes y no se admiten imagenes HTTPS ni data URLs.

Toda operacion remota continua en main mediante IPC. Cambiar esta politica
requiere inventariar primero el recurso, justificar la directiva minima,
actualizar los tests estaticos y ejecutar la suite y el smoke Electron.

