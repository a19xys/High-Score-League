# High Score League Launcher GUI 0

Diseno de la primera GUI minima del launcher local, sin implementar codigo
visual. Este documento define como envolver el flujo CLI ya validado para un
jugador normal.

## Objetivo

La GUI minima debe hacer sencillo el flujo que hoy funciona por consola:

1. Ver estado del entorno.
2. Ver si hay sesion.
3. Usar un pack configurado.
4. Jugar en modo competicion.
5. Practicar sin generar submissions.
6. Ver puntuaciones capturadas.
7. Subir puntuaciones pendientes cuando haga falta.
8. Entender errores sin perder scores.

La filosofia de producto es:

```text
El jugador juega.
La app registra.
La web compite.
```

La web organiza la liga, rankings, reglas, manuales y actividad. El launcher
solo conecta al jugador con el pack, MAME, la sesion local, la cola y las
subidas.

## Principios

- La GUI envuelve el flujo CLI validado; no lo reinventa.
- La CLI sigue siendo la base funcional y debe seguir funcionando.
- La GUI esta orientada al jugador, no al administrador.
- La GUI no debe ser una segunda web.
- La web sigue siendo el centro de la liga.
- La app local solo resuelve login local, pack/juego, MAME, puntuaciones,
  subida y diagnostico.
- La GUI no guarda sesion dentro del pack.
- La GUI no asume que el pack esta en Downloads.
- La GUI no borra pending al borrar o cambiar de pack.
- La GUI respeta userData para sesion, cola, logs y preferencias.
- `sync-plugin` es temporal de desarrollo, no una funcion de usuario final.

Principio de puntuaciones:

- La GUI no debe disenar una bandeja donde el jugador escoge solo la mejor
  puntuacion.
- La direccion final es registrar y subir intentos de competicion
  automaticamente cuando la deteccion sea fiable.
- La web usa la mejor puntuacion para ranking y conserva todas las submissions
  como actividad/historial.
- Pending es una cola de seguridad, no un selector competitivo.
- Mientras no haya deteccion fiable de fin de run, la GUI puede pedir
  confirmacion manual o permitir subir pendientes, pero eso es provisional.

La GUI debe ser pequena. No debe duplicar leaderboard completo, chat, normas
completas ni administracion.

## Usuario objetivo

Usuario principal:

- jugador normal de la liga;
- no tecnico;
- quiere jugar, practicar y subir puntuaciones sin usar consola.

Fuera de alcance en esta primera GUI:

- organizador/admin;
- gestion de temporadas;
- configuracion avanzada de MAME;
- edicion de ROMs;
- anti-cheat fuerte;
- review de INP;
- gestion avanzada multi-pack.

## Experiencia ideal del jugador

1. El jugador entra en la web.
2. Ve el juego de la semana, ranking, fechas, manual y boton de descarga.
3. Si no tiene Launcher, descarga el instalador desde la web.
4. Instala el Launcher una vez.
5. Inicia sesion o vincula cuenta.
6. Descarga el pack del juego/semana.
7. Abre el pack con el Launcher.
8. Lee el manual o practica.
9. Pulsa Jugar competicion.
10. La app registra intentos validos.
11. La app sube automaticamente cuando sea fiable y posible.
12. Si no puede subir, guarda pending.
13. Al cerrar MAME, muestra resumen.
14. La web muestra mejor score para ranking y submissions para
    actividad/historial.

El jugador no gestiona JSON, no elige normalmente que score subir, no configura
MAME manualmente, no pierde sesion al borrar un pack y no pierde pending por
fallos de red.

## Alcance minimo

Areas de la ventana principal:

- Estado / diagnostico.
- Cuenta.
- Pack activo.
- Juego.
- Cola de puntuaciones.
- Acciones principales.
- Mensajes y errores.

Debe ser una sola ventana principal con secciones simples. No hay navegacion
compleja ni paneles administrativos.

## Pantalla principal propuesta

Layout textual:

```text
------------------------------------------------
High Score League Launcher
Space Invaders - Semana actual

Cuenta: conectada como usuario@example.com
Pack: HSL Space Invaders - OK
Estado: listo para jugar
Pendientes: 1

[ Jugar competicion ] [ Practicar ]
[ Subir 1 pendiente ] [ Ver pendientes ]
[ Diagnosticar ]

Solo desarrollo:
[ Sincronizar plugin ]

Mensajes:
- Ultima subida correcta: 890 puntos.
------------------------------------------------
```

Datos visibles minimos:

- entorno OK / revisar;
- sesion conectada / no conectada;
- pack activo o no seleccionado;
- juego: Space Invaders / invaders;
- numero de eventos pending.

Acciones principales:

- Jugar competicion.
- Practicar.
- Subir pendientes.
- Ver pendientes.
- Diagnosticar.
- Sincronizar plugin solo en desarrollo.

## Estados de pantalla

### A. Primer arranque sin Launcher instalado, desde la web

- Ve: mensaje web para descargar instalador.
- Boton principal: Descargar Launcher.
- Mensaje: instala una vez y vuelve al juego de la semana.
- Accion segura: descargar instalador.
- Bloquear/desaconsejar: configurar MAME manualmente.
- Piensa: quiero entrar a jugar sin preparar herramientas.

### B. Primer arranque del Launcher sin sesion

- Ve: Launcher abierto, sin cuenta conectada.
- Boton principal: Iniciar sesion.
- Mensaje: conecta tu cuenta para subir puntuaciones.
- Accion segura: login.
- Bloquear/desaconsejar: subir pending sin sesion.
- Piensa: necesito vincular mi cuenta.

### C. Sesion iniciada pero sin pack activo

- Ve: cuenta OK, pack no seleccionado.
- Boton principal: Abrir pack.
- Mensaje: descarga o abre el pack de la semana.
- Accion segura: abrir/importar pack.
- Bloquear/desaconsejar: jugar sin pack.
- Piensa: ya estoy conectado; falta el juego.

### D. Pack activo y entorno OK

- Ve: cuenta OK, pack OK, juego OK, botones disponibles.
- Boton principal: Jugar competicion.
- Mensaje: listo para competir.
- Accion segura: jugar, practicar, diagnosticar, subir pending.
- Bloquear/desaconsejar: nada critico.
- Piensa: puedo jugar.

### E. Hay puntuaciones pending

- Ve: contador pending y resumen.
- Boton principal: Subir pendientes.
- Mensaje: tus puntuaciones estan guardadas localmente.
- Accion segura: subir o revisar pendientes.
- Bloquear/desaconsejar: borrar pack sin advertir si cola vive alli en dev.
- Piensa: tengo scores por enviar.

### F. Subida correcta

- Ve: score enviado, movido a sent.
- Boton principal: Ver en web o seguir jugando.
- Mensaje: puntuacion enviada correctamente.
- Accion segura: abrir web, jugar otra vez.
- Bloquear/desaconsejar: reenviar manualmente sin necesidad.
- Piensa: ya cuenta.

### G. Error de red/auth

- Ve: error claro, evento sigue pending.
- Boton principal: Reintentar / Iniciar sesion.
- Mensaje: tu puntuacion sigue guardada localmente.
- Accion segura: reintentar, login, diagnosticar.
- Bloquear/desaconsejar: mover a failed por error de red.
- Piensa: no quiero perder el score.

### H. Plugin/MAME mal configurado

- Ve: entorno no listo, detalle de MAME/plugin.
- Boton principal: Diagnosticar.
- Mensaje: no se puede jugar hasta corregir el pack.
- Accion segura: diagnosticar, abrir carpeta pack.
- Bloquear/desaconsejar: jugar competicion.
- Piensa: algo del pack esta mal.

### I. Practice seguro

- Ve: practica disponible.
- Boton principal: Practicar.
- Mensaje: el plugin no se activa explicitamente.
- Accion segura: practicar.
- Bloquear/desaconsejar: subir scores de practica como competicion.
- Piensa: puedo entrenar sin competir.

### J. Riesgo: plugin activo globalmente en plugin.ini

- Ve: warning visible antes de practica.
- Boton principal: Diagnosticar / Practicar con advertencia.
- Mensaje: MAME podria cargar el plugin aunque practice no lo active.
- Accion segura: desactivar plugin global o usar play para competicion.
- Bloquear/desaconsejar: presentar practica como totalmente limpia.
- Piensa: debo revisar la configuracion.

### K. Cierre de MAME con intentos registrados

- Ve: resumen de intentos detectados y pending/uploaded.
- Boton principal: Subir pendientes, si no se subieron automaticamente.
- Mensaje: se detectaron puntuaciones.
- Accion segura: subir, revisar, jugar otra vez.
- Bloquear/desaconsejar: elegir solo la mejor como flujo normal.
- Piensa: mis partidas quedaron registradas.

### L. Cierre de MAME sin intentos registrados

- Ve: MAME cerrado, sin nuevos scores.
- Boton principal: Jugar competicion / Practicar.
- Mensaje: no se detectaron puntuaciones nuevas.
- Accion segura: jugar otra vez, diagnosticar si esperaba captura.
- Bloquear/desaconsejar: crear submissions manuales sin evento.
- Piensa: no hubo score o algo no capturo.

## Mapeo GUI a CLI actual

| GUI | CLI actual |
| --- | --- |
| Diagnosticar | `node app.js diagnose` |
| Jugar competicion | `node app.js play invaders` |
| Practicar | `node app.js practice invaders` |
| Subir pendientes | `node app.js submit-all` |
| Lista de pendientes | `node app.js scan pending` |
| Detalle de evento | `node app.js show <archivo.json>` |
| Estado de cuenta | `node app.js auth-status` |
| Login | `node app.js login <email>` |
| Logout | `node app.js logout` |
| Desarrollo: sincronizar plugin | `node app.js sync-plugin` |

La implementacion real no tiene que invocar procesos CLI literalmente si puede
reutilizar modulos internos. El comportamiento debe ser equivalente.

## Modelo conceptual de datos

No guardar tokens ni exponer Supabase keys en estado visible.

```text
AppStatus:
- mode: devBridge | installedLauncher
- userDataDir
- configSource
- warnings[]

AuthStatus:
- isLoggedIn
- email?
- sessionFile
- expiresAt?
- warnings[]

PackStatus:
- hasActivePack
- packName?
- packDir?
- gameId?
- rom?
- weekId?
- warnings[]

GameStatus:
- displayName
- rom
- mode: idle | competition | practice
- mameConfigured
- pluginConfigured
- globalPluginRisk

QueueStatus:
- pendingCount
- sentCount
- failedCount
- recentSkippedCount?
- invalidCount?

DiagnosticStatus:
- level: ok | warning | error
- sections[]
- lastRunAt

LastActionResult:
- action
- ok
- message
- details[]

SessionSummary:
- attemptsDetected
- bestScoreThisSession
- uploadedCount
- pendingCount
- failedCount

SubmissionSummary:
- filename
- score
- rom
- weekId
- status: pending | sent | failed | duplicateAccepted
- message
```

## Login minimo

La primera GUI puede pedir email y password si mantiene el flujo actual de
`login <email>` con Supabase password auth. Si el login evoluciona a magic
link/OTP, la GUI debe reflejar ese flujo sin cambiar aqui Supabase.

Flujo minimo:

1. Usuario pulsa Iniciar sesion.
2. GUI pide email y credenciales segun el backend actual.
3. Al enviar, muestra "Conectando..." sin imprimir tokens.
4. Si va bien, muestra "Conectado como usuario@example.com".
5. Si falla, muestra error y ofrece reintentar.
6. Logout elimina solo la sesion local.

La sesion activa se refleja con email, ruta de sessionFile si es util para
diagnostico, y estado conectado. Nunca se muestra access_token ni refresh_token.

## Web, pack y manual

Pagina del juego/semana en la web:

- descargar Launcher si no esta instalado;
- descargar pack;
- abrir manual;
- ver ranking;
- ver reglas rapidas;
- ver estado de participacion personal.

La web no debe obligar al jugador a configurar MAME. El manual debe ser
accesible antes de jugar. El pack es desechable. La sesion no vive en el pack.
El Launcher puede abrir el pack descargado.

## Flujo de juego

### Jugar competicion

Antes de lanzar MAME, la GUI muestra modo competicion, ROM y que el plugin de
puntuacion se activara. Durante la partida, el jugador solo juega.

Direccion final:

- registrar intentos automaticamente cuando la deteccion sea fiable;
- al cerrar MAME, refrescar cola/subidas;
- mostrar resumen de intentos, mejor score de sesion, uploaded, pending y
  failed;
- si hay nuevos pending, ofrecer Subir pendientes o subir automaticamente cuando
  sea fiable y seguro.

### Practicar

Practice no activa el plugin explicitamente. Si diagnose detecta plugin global
activo en `plugin.ini`, la GUI debe advertirlo. La GUI no debe ofrecer subir
scores de practica como si fueran competicion.

## Puntuaciones y submissions

Regla de producto:

```text
Intentos de competicion = submissions.
Ranking = mejor score.
Actividad/historial = todas las submissions.
Pending = cola de seguridad.
```

Subir puntuaciones inferiores no es un error: mantiene actividad e historial.
La web decide que cuenta para ranking. La app no debe empujar al jugador a
elegir solo la mejor.

Casos:

- Puntuacion inferior a otra enviada: se sube igualmente si es intento valido.
- Varias runs en una sesion: se registran como submissions separadas.
- Game Over fiable: cierre natural de run y candidato a auto-submit.
- Reset de score: posible senal futura, requiere validacion por juego.
- Cerrar MAME sin deteccion fiable: refrescar pending y explicar estado.
- Captura manual: fallback temporal mientras no exista deteccion completa.

## Flujo de subida

Subir pendientes debe priorizar no perder eventos.

Estados:

- No hay sesion: pedir login; pending queda guardado.
- Hay sesion: ejecutar subida.
- No hay pending: mostrar "No hay puntuaciones pendientes".
- Pending reciente saltado: "Este archivo parece recien creado; espera unos
  segundos".
- Subida aceptada: mover a sent y mostrar score.
- Duplicado aceptado: tratar como exito logico y mover a sent.
- Error red/auth: "Tu puntuacion sigue guardada localmente" y reintentar luego.
- Error controlado: mover a failed con razon visible.
- JSON invalido reciente: dejar en pending y pedir esperar/revisar.
- JSON invalido viejo: mover a failed con razon.

Mensajes recomendados:

```text
Tu puntuacion sigue guardada localmente.
Se reintentara cuando vuelvas a subir.
Este archivo parece recien creado; espera unos segundos.
Se movio a failed porque el evento no es valido.
```

## Tecnologia para GUI-1

No se decide una tecnologia definitiva en esta tarea. Criterios:

- minimo coste;
- reutilizar Node/CommonJS existente;
- no tocar web principal;
- no romper CLI;
- facil de probar en Windows.

Opciones:

- Electron: recomendable provisionalmente para el prototipo por cercania con
  Node y por poder reutilizar modulos locales con poco trabajo. No implica
  decision eterna.
- Tauri: atractivo para app final ligera, pero introduce otra toolchain.
- App web local: simple para prototipos, pero puede confundir launcher con web.
- TUI: barata, pero no resuelve la experiencia no tecnica buscada.

Recomendacion provisional para `LOCAL-LAUNCHER-GUI-1`: Electron solo como
prototipo visual minimo, manteniendo CLI intacta y sin empaquetado final.

## Restricciones para GUI-1

- No romper CLI.
- No mover sesion al pack.
- No mover pending al pack como decision final.
- No copiar ROMs.
- No empaquetar MAME.
- No tocar web principal.
- No cambiar payload.
- No cambiar duplicateKey.
- No exponer tokens.
- No implementar multi-pack completo todavia.
- No implementar F12 todavia.
- No implementar auto-submit todavia, salvo mock pasivo documentado.
- No implementar anti-cheat fuerte todavia.
- No convertir sync-plugin en feature de usuario final.

## Alcance propuesto para GUI-1

Implementar solo un prototipo visual minimo:

- ventana principal;
- leer estado basico;
- mostrar sesion;
- mostrar pack dev bridge/configurado;
- mostrar pending count;
- botones que llamen o reutilicen diagnose, play invaders, practice invaders y
  submit-all;
- seccion de logs/mensajes;
- sin pack selector real todavia, o usando config actual dev bridge.

No implementar en GUI-0. No disenar pantallas detalladas mas alla de este
alcance.
