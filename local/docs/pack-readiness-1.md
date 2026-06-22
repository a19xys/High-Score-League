# LOCAL-PACK-READINESS-1

Estado de preparacion del pack activo antes de jugar.

## Objetivo

La GUI resume si el pack activo esta listo para practicar, competir, capturar
puntuaciones y sincronizarlas. El jugador ve una tarjeta corta con una decision
clara; los detalles tecnicos quedan en `Herramientas de desarrollo`.

Esta capa no cambia el contrato del pack, no modifica `config.json`, no ejecuta
MAME, no sube puntuaciones y no toca el endpoint web.

## Resultado visible

El panel principal muestra `Estado del pack` con uno de estos estados:

- `ready`: el pack esta listo para practicar, competir y sincronizar.
- `warning`: se puede usar el pack, pero hay avisos que conviene revisar.
- `blocked`: falta algo necesario para jugar o competir.
- `unknown`: no hay suficiente informacion para decidir.

La tarjeta usa mensajes de jugador, por ejemplo:

```text
Listo para jugar
Puedes practicar, competir y sincronizar puntuaciones.
```

o:

```text
Requiere atencion
No encuentro mame.exe. Revisa la carpeta del pack.
```

## Checks evaluados

La evaluacion revisa, sin efectos secundarios:

- `pack.json` cargado y errores de pack.
- Carpeta raiz del pack y archivo `pack.json`.
- Identidad basica del pack, ROM y `weekId`.
- Metadata opcional y assets como avisos no bloqueantes.
- Ejecutable de MAME y working directory.
- Nombre y carpeta del plugin.
- ROM inferida en `roms/<rom>.zip` como aviso si no se puede confirmar.
- Carpetas staging `pending`, `sent` y `failed`.
- Sesion local.
- Cola scoped de cuenta y pack.
- Membership de temporada.
- `webBaseUrl` para sincronizar.
- Cola `failed`.
- Estado de auto-sync.

Los detalles muestran rutas y motivos tecnicos, pero no tokens, passwords,
cabeceras `Authorization`, access tokens ni refresh tokens.

## Reglas de disponibilidad

`canPractice` requiere MAME y ROM configurados.

`canCapture` requiere plugin configurado y sin error de carpeta cuando la ruta
puede comprobarse.

`canPlayCompetition` requiere practica disponible, captura disponible, sesion,
cola scoped, `weekId` y membership compatible. `member` permite competir.
`unknown` y `error` permiten competir con aviso para no bloquear por un fallo
temporal de red o servidor. `not_member`, `no_session`, `invalid_week` y
estados equivalentes bloquean competicion.

`canSubmit` requiere sesion, cola scoped, `weekId`, `webBaseUrl` y
`membership.canSubmit === true`.

## Relacion con membership

La comprobacion de readiness no sustituye la membership. La consume como una de
sus entradas.

Si el usuario no pertenece a la temporada del pack, el resumen bloquea
competicion y subida, pero mantiene practica si MAME/ROM estan disponibles.

Si la membership falla por red o servidor, la competicion puede quedar
disponible con aviso y la subida queda bloqueada hasta poder verificar.

## Relacion con auto-sync

Readiness no dispara auto-sync ni cambia sus reglas. Solo muestra si el estado
actual de auto-sync esta limpio o requiere atencion.

La sincronizacion sigue dependiendo de la cola scoped, la sesion y la membership
verificada.

## Relacion con scoped queue

La cola scoped sigue siendo la fuente local segura para la cuenta y pack
activos:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

Readiness solo comprueba que exista un scope activo para poder competir y subir.
No mueve archivos ni adopta staging.

## Lo que no implementa

- No ejecuta MAME.
- No prueba el plugin en runtime.
- No crea carpetas automaticamente.
- No modifica `config.json`.
- No cambia payloads ni `duplicateKey`.
- No cambia `/api/submissions/ingest`.
- No toca migraciones ni RLS.
- No implementa selector de cuentas.
- No implementa grid final de biblioteca.
- No implementa installer ni empaquetado.
