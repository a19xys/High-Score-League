# LOCAL-ACCOUNT-PACK-SCOPED-QUEUE-1

Separacion minima de la cola local por cuenta y pack en la GUI.

## Por que existe

La cola del pack o dev bridge puede mezclar puntuaciones de varias cuentas si
el mismo ordenador se comparte. Tambien puede mezclar puntuaciones de packs o
semanas distintas.

La GUI ahora usa una cola separada por:

```text
cuenta activa + pack activo
```

## Estructura

La cola scoped vive en `userData`:

```text
userData/
  players/
    <playerKey>/
      packs/
        <packKey>/
          meta.json
          events/
            pending/
            failed/
            sent/
```

`pending`, `failed` y `sent` del scope activo son los que ve, sube y restaura
la GUI.

## playerKey

`playerKey` se deriva asi:

1. `user.id` de Supabase, sanitizado para filesystem.
2. Si no hay `user.id`, hash de email.
3. Sin cuenta conectada no hay scope competitivo.

No se usa email crudo como carpeta cuando solo esta el email.

## packKey

`packKey` se deriva asi:

1. `packId` de `pack.json`, si existe.
2. `gameId + rom + weekId`, si no hay `packId`.
3. Hash de la identidad efectiva si faltan datos.

Esto separa juegos, ROMs, semanas y packs distintos sin depender de rutas
absolutas como clave principal.

## meta.json

Cada scope tiene `meta.json` con datos minimos de cuenta y pack:

- `player.userId`
- `player.email`
- `pack.packId`
- `pack.gameId`
- `pack.rom`
- `pack.weekId`
- `pack.packDir`

No guarda `access_token`, `refresh_token`, contrasena ni claves de Supabase.

## Staging del plugin

El plugin de MAME no cambia en esta tarea. Puede seguir escribiendo en:

```text
<pack>/plugins/hsl-score/events/pending
```

Para la GUI esa carpeta pasa a ser staging: una bandeja de captura temporal.
La cola final del jugador vive en el scope de `userData`.

## Adopcion de capturas nuevas

Al pulsar `Jugar competicion` con cuenta conectada:

1. La GUI toma un snapshot de JSON existentes en staging.
2. Lanza MAME.
3. Al cerrar MAME, revisa staging de nuevo.
4. Mueve solo JSON nuevos o modificados durante esa sesion al scope activo.
5. Si ya existe el mismo nombre en `pending`, usa sufijo seguro como `__2`.

Los JSON que ya estaban en staging antes de jugar no se importan
automaticamente para no atribuir capturas antiguas a la cuenta actual.

## Sin cuenta conectada

La GUI bloquea `Jugar competicion` y `Subir pendientes` si no hay cuenta
conectada. `Practicar`, `Abrir pack` y `Diagnosticar` siguen disponibles.

## CLI

La CLI se mantiene con la cola configurada tradicional por compatibilidad:

```text
scan
show
submit
submit-all
restore
play
practice
```

La separacion scoped se aplica en la GUI. Adaptar la CLI al scope activo queda
para una tarea explicita posterior si hace falta.

## Limites

- No hay selector de cuentas.
- No hay multi-pack completo.
- No hay migracion masiva de historico.
- No se importan capturas antiguas automaticamente.
- No se comprueba pertenencia a temporada.
- No se cambia el plugin, el payload, `duplicateKey` ni el endpoint web.
