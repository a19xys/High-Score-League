# LOCAL-PACK-CONTRACT-2

> La extensión cerrada de Competition automática (`intervalFrames`, evidence
> v2 y Space Invaders r2) está en
> [`local-competition-integrity-closure-1.md`](local-competition-integrity-closure-1.md).

`packVersion: 2` es el contrato actual para packs ligeros. El pack no contiene
MAME: declara recursos relativos y la app usa un runtime compartido. V1 sigue
visible y practicable como legacy/deprecated, pero no recibe la autoridad de
Competición protegida descrita aquí.

## Campos

Requeridos:

- `packVersion`, `packId`, `gameId`, `rom`, `weekId`, `webBaseUrl`;
- `runtime.type` (`mame`);
- `mame.romPath`;
- `capture.mode`.

Recomendados: identidad de temporada, `weekNumber`, versiones mínima y
recomendada, rutas de artwork/samples/cfg, `capture.pluginName` y
`capture.adapter`. Para Competición protegida también se declaran
`mame.profiles.competition.integrity` y `capture.automatic`.

```json
{
  "capture": {
    "mode": "plugin",
    "pluginName": "hsl-score",
    "adapter": "scripts/invaders.lua",
    "automatic": {
      "version": 1,
      "strategy": "invaders-game-mode-final-v1"
    }
  }
}
```

`capture.automatic` tiene schema cerrado. Sólo declara versión y un identificador
seguro de estrategia; no convierte la estrategia de un juego en algoritmo
universal.

## Separación de responsabilidades

- `pack.json`: identidad y contrato técnico del pack;
- `metadata.json`: presentación, manual, créditos y assets;
- `competition-manifest.json`: cobertura determinista de bytes competitivos;
- receipt local: provenance de una importación remota verificada;
- adapter: observación específica del juego y propuesta limitada de candidate;
- launcher/plugin HSL: identidad, sandbox, guard, evidencia y finalización.

Manifest y receipt no son firmas ni sustituyen la futura autoridad web.

## Rutas seguras

ROM, artwork, samples, cfg y adapter son rutas relativas al pack. Se rechazan
absolutas, URLs y traversal. El loader normaliza las rutas y mantiene separados
el cfg persistente de Práctica y un `profiles.competition.cfgPath` opcional que
sólo actúa como seed manifestado.

## Perfiles MAME y visual común

Los filtros visuales pertenecen a `mame.launchArgs` para que sean idénticos en
ambos modos:

```json
{
  "mame": {
    "romPath": "roms",
    "artworkPath": "artwork",
    "samplePath": "samples",
    "cfgPath": "cfg",
    "launchArgs": ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
    "profiles": {
      "practice": {
        "launchArgs": []
      },
      "competition": {
        "launchArgs": [],
        "integrity": {
          "version": 1,
          "mameVersion": "0.287",
          "dips": []
        }
      }
    }
  }
}
```

`profiles.practice.launchArgs` puede expresar libertades de Práctica. Para
Competición, `mame.launchArgs` y `profiles.competition.launchArgs` pasan una
allowlist estricta. Actualmente sólo se auditan `-video bgfx` y
`-bgfx_screen_chains <chain-segura>`; cualquier opción o alias no reconocido,
valor ausente, duplicado o token posicional bloquea.

## Integrity v1

```json
{
  "version": 1,
  "mameVersion": "0.287",
  "dips": [
    {
      "portTag": ":IN2",
      "mask": 3,
      "value": 0,
      "label": "Lives",
      "settingLabel": "3"
    }
  ]
}
```

La versión y MAME son exactos. `dips` admite 0-32 entradas canónicas por
`portTag + mask`; `value` debe caber dentro de mask. Labels son diagnóstico.
Práctica no acepta `integrity`.

La ausencia de `integrity`, manifest, estrategia automática o provenance no
corrompe el pack: readiness separa explícitamente Biblioteca/Práctica de
`protectedCompetitionReady`.

## Manifest y snapshot

La cobertura deriva de `pack.json`, adapter, ROMs, scripts, artwork y cfg seed.
Samples pueden permanecer fuera si son únicamente audio de salida; metadata,
assets y manual no forman parte de la ejecución MAME.

Al preparar Competición, la app relee el pack, compara su identidad y copia cada
archivo manifestado al snapshot mientras calcula size/hash. Después vuelve a
parsear y verificar el snapshot. MAME usa sus rutas desde ese snapshot; el
adapter aislado también se copia desde allí.

## Contrato del adapter 0.3

El módulo conserva `read_memory(helpers)` y puede implementar:

```lua
observe_capture(tracker_state, result)
-- nil, o bien:
-- { score = <entero positivo>, metadata = <JSON limitado> }
```

El adapter decide cuándo un intento es legítimo según su juego. El core rechaza
metatables y metadata no JSON o fuera de límites. Core controla ROM real,
`runId`, `candidateId`, timestamp, source, versiones y strategy.

Los candidates se escriben sólo en `runRoot/events/candidates`. No entran en
pending ni disparan submit mientras MAME está abierto. Al cierre,
`finalizeCompetitionRun` valida el ledger final completo: CLEAN promueve todos;
una violación invalida todos; crash, falta de seal o candidate corrupto falla
cerrado.

`build_event`/captura manual queda como compatibilidad legacy. No es una ruta
válida para Competición protegida.

## Provenance y runtime

Un remote import realmente verificado crea un receipt ligado a artifact,
`packId` y `competitionManifestSha256`. Importación manual y already-installed
no lo hacen. Developer Tools puede habilitar un override sólo en app no
empaquetada; producto exige receipt y runtime bundled.

El runtime bundled y el plugin staging contienen manifests launcher-owned de
bytes críticos que se revalidan antes de Competición. El runtime externo se
reserva para QA dev con MAME exacto.

## Pack de referencia

Space Invaders conserva `space-invaders-s1-w1-r1`, MAME 0.287, Lives=3, Bonus
Life=1500 y `cfg/` vacío. Usa `invaders-game-mode-final-v1`; su investigación y
QA real se documentan en `local/docs/space-invaders-pack-v2-real-1.md`.

## Compatibilidad legacy

V1 continúa soportado para discovery, dev bridge, apertura y Práctica. No se
migra automáticamente ni se copia MAME o ROM al repositorio. Su retirada queda
fuera de este hardening.
