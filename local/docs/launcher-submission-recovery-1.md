# LOCAL-SUBMISSION-RECOVERY-GUI-1

Recuperacion minima de puntuaciones con error desde la GUI local.

## Que significa failed

La carpeta `failed` no es una papelera. En la GUI se presenta como:

```text
Puntuaciones con error
Requieren atencion
```

Una puntuacion en `failed` sigue guardada localmente. Normalmente llego ahi por
un error controlado: cuenta no unida a la temporada, sesion no valida, evento
rechazado por el endpoint o JSON local invalido.

Desde `LOCAL-ACCOUNT-PACK-SCOPED-QUEUE-1`, la GUI interpreta `failed` dentro
del scope activo:

```text
userData/players/<playerKey>/packs/<packKey>/events/failed
```

Restaurar una puntuacion fallida la devuelve al `pending` del mismo scope. No se
restauran puntuaciones de otra cuenta ni de otro pack.

## Como se ve en la GUI

Cuando hay archivos en `failed`, el panel de cola muestra una seccion visible
debajo de `Puntuaciones pendientes`.

La primera capa muestra:

- juego o ROM;
- puntuacion;
- fecha;
- motivo amable;
- accion `Restaurar a pendientes`.

El nombre del JSON y el motivo tecnico quedan en `Ver detalles`.

## Motivo del error

La GUI intenta leer la nota asociada:

```text
<archivo>.json.failed.txt
```

Si existe `reason=...`, se usa como motivo tecnico y se traduce a un texto de
jugador cuando el patron es claro. Por ejemplo, errores de temporada/cuenta se
presentan como:

```text
Tu cuenta no esta unida a esta temporada. Unete desde la web y vuelve a intentarlo.
```

Si no hay nota ni razon clara, se muestra:

```text
No se pudo enviar esta puntuacion.
```

## Restaurar a pendientes

`Restaurar a pendientes` mueve el JSON desde `failed` a `pending` usando el
movimiento seguro de la cola local. Si ya existe un archivo con el mismo nombre
en `pending`, se usa un sufijo como `__2` para no sobrescribir nada.

La nota `.failed.txt` no se borra automaticamente en esta tarea.

Despues de restaurar, el jugador puede corregir el problema y pulsar
`Subir pendientes`.

## Lo que no cambia

- No se borran eventos.
- No se reenvian archivos `sent` como flujo principal.
- La CLI puede seguir usando la cola configurada tradicional.
- No se cambia el plugin MAME.
- No se cambia el contrato JSON ni `duplicateKey`.

## Diseno futuro

La cola final deberia vivir en `userData` y poder separarse por cuenta y pack.
Esta tarea solo hace visible y recuperable la cola efectiva actual del
pack/dev bridge, sin introducir esa migracion todavia.
