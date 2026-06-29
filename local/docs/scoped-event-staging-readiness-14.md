# LOCAL-SCOPED-EVENT-STAGING-READINESS-14

Auditoria y correccion de readiness para que la GUI no trate la cola global
legacy como verdad principal cuando el flujo activo es scoped por cuenta y pack.

## Problema corregido

Sin `eventsPendingDir`, `eventsSentDir` y `eventsFailedDir` explicitos,
`runtime-paths` resuelve el fallback historico:

```text
userData/events/{pending,sent,failed}
```

Ese fallback sigue siendo util para CLI, pruebas y bridge legacy, pero la GUI
moderna ya no debe presentarlo como staging principal de un pack activo v2. El
efecto visible era un warning enganoso:

```text
Staging pending no esta preparado.
userData/events/pending
```

## Tres conceptos separados

### File queue global legacy

Ruta historica:

```text
userData/events/{pending,sent,failed}
```

Se mantiene como fallback de CLI/dev bridge y compatibilidad. No es la fuente
de verdad de la GUI moderna cuando hay cuenta y pack activos.

### Scoped queue moderna

Ruta de la GUI:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

La GUI prepara esta cola automaticamente cuando hay sesion activa y pack activo.
Es la fuente local para actividad, subida, restauracion y auto-sync.

Sin sesion no se inventa `playerKey`: no hay scope competitivo. Practica puede
seguir disponible si el pack/runtime lo permiten, pero competicion y subida se
bloquean.

### Plugin staging temporal

En v1/dev bridge, el plugin puede escribir en:

```text
<mame workingDir>/plugins/hsl-score/events/pending
```

Para la GUI esto es staging: despues de una partida competitiva v1 se adoptan
solo capturas nuevas al scope actual.

En `packVersion: 2`, staging competitivo queda pendiente de
`LOCAL-MAME-PACK-PLUGIN-LOADING-2`. Hasta entonces la competicion v2 permanece
bloqueada y readiness no evalua `userData/events` como si fuera staging del
pack.

## Fuente de verdad de la GUI

La fuente de verdad de la GUI es:

```text
sesion activa
+ pack activo
+ userData/players/<playerKey>/packs/<packKey>/events
```

La cola global puede aparecer en diagnose como legacy/CLI, no como problema
principal del pack v2.

## Readiness

Readiness mantiene estas reglas:

- v1/dev bridge: comprueba staging si las rutas configuradas representan el
  plugin staging o bridge de desarrollo.
- v2: comprueba runtime compartido, recursos del pack, cuenta, scope,
  membership y auto-sync; no muestra warnings de `userData/events` como
  staging.
- v2: conserva el bloqueo de competicion hasta que exista carga segura del
  plugin/adaptador.
- scoped queue: se informa como requisito competitivo cuando hay sesion; no se
  crean scopes falsos sin sesion.

## Diagnose

Diagnose diferencia:

- `file queue global legacy/CLI`;
- `plugin staging temporal`;
- `scoped queue actual`, derivada de la sesion y pack activos cuando existe;
- `plugin staging v2 pendiente`, para recordar que no esta implementado.

Diagnose no imprime tokens y no crea carpetas scoped. Si el fallback
`userData/events` falta para un pack v2, lo informa como legacy, no como error
principal de readiness.

## Fuera de alcance

No se habilita competicion v2. No se cambia payload, endpoint ingest, RLS,
membership, auto-sync ni el plugin MAME. No se elimina compatibilidad v1.
