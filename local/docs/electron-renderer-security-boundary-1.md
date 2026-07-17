# ELECTRON RENDERER SECURITY BOUNDARY 1

## Renderer

El renderer puede cargar modulos, CSS, fuentes e imagenes locales; leer y
guardar la preferencia de tema; renderizar estado recibido; y solicitar
operaciones concretas mediante `window.hslLauncher`.

No dispone de Node, filesystem, shell, procesos, `ipcRenderer` completo ni un
canal invoke generico. CSP bloquea conexiones directas, frames, workers,
objetos, media, manifests, formularios, scripts inline y eval. El renderer no
realiza health, login, membership, submissions ni consultas de Ranking.

## Preload y main

Preload usa unicamente `contextBridge` e `ipcRenderer`. Expone metodos con
canales fijos y listeners que eliminan el objeto de evento antes de llamar al
renderer. No expone tokens, `require`, `process`, shell ni APIs de archivos.

Main mantiene health, Ranking, membership, autenticacion, autoenvio, apertura
externa validada y MAME. `contextIsolation=true`, `sandbox=true`,
`nodeIntegration=false`, `webSecurity=true` y el resto de preferencias
relevantes se declaran expresamente. DevTools depende solo de
`developerToolsEnabled`.

## Navegacion y capacidades web

- `window.open` y cualquier nueva ventana se deniegan.
- `will-navigate` y `will-redirect` impiden abandonar el documento inicial.
- `will-attach-webview` se cancela y `webviewTag=false`.
- todas las comprobaciones y solicitudes de permisos web devuelven false;
- una navegacion bloqueada solo registra su protocolo en desarrollo;
- los mensajes CSP o security warning se clasifican sin copiar su contenido;
- las URLs externas se abren exclusivamente desde main tras su validacion.

El resumen `securityPolicy` del diagnostico declara estas propiedades sin
rutas de usuario, URLs completas, credenciales ni tokens.
