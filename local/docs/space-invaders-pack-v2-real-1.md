# SPACE-INVADERS-PACK-V2-REAL-1

Space Invaders es el pack `packVersion: 2` de referencia real de High Score
League. Su identidad se conserva en:

```text
packId = space-invaders-s1-w1-r1
runtime = MAME 0.287 exacto
```

La ruta usada para QA fue `D:/High Score League/Space Invaders/`. ROM, artwork,
samples, manual y assets pueden contener material no redistribuible y no deben
copiarse a git sin licencia/autorización.

## Contrato actual

El pack declara rutas relativas `roms`, `artwork`, `samples`, `cfg` y el adapter
`scripts/invaders.lua`. El filtro visual es común a Práctica y Competición:

```json
{
  "mame": {
    "launchArgs": [
      "-video",
      "bgfx",
      "-bgfx_screen_chains",
      "crt-geom"
    ],
    "profiles": {
      "practice": { "launchArgs": [] },
      "competition": {
        "launchArgs": [],
        "integrity": {
          "version": 1,
          "mameVersion": "0.287",
          "dips": [
            { "portTag": ":IN2", "mask": 3, "value": 0, "label": "Lives", "settingLabel": "3" },
            { "portTag": ":IN2", "mask": 8, "value": 0, "label": "Bonus Life", "settingLabel": "1500" }
          ]
        }
      }
    }
  },
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

Los argv efectivos de ambos modos incluyen exactamente:

```text
-video bgfx -bgfx_screen_chains crt-geom
```

La igualdad es visual; Práctica no hereda controller, guard, plugin,
candidates, sandbox ni provenance competitivos.

## Estrategia automática específica

La investigación con MAME 0.287 real observó una secuencia completa de attract,
coin/start, gameplay, pérdida de vidas, última vida y regreso a attract. Las
señales usadas son:

| Dirección | Señal | Observación relevante |
| --- | --- | --- |
| `0x20F8/0x20F9` | score P1 BCD | score visible; el tracker conserva rollovers y mejor score del intento |
| `0x20EF` | game mode | `0 -> 1` al entrar en gameplay y `1 -> 0` al terminar |
| `0x20E7` | player alive | se observó `1` durante un intento real y `0` al final |
| `0x21FF` | ships remaining | se observaron vidas activas y `0` en el final real |

`invaders-game-mode-final-v1` abre un intento sólo en la transición
`lastMode != 1 -> mode == 1`, exige haber observado `alive == 1`, y sólo genera
candidate en `lastMode == 1 -> mode == 0` cuando `alive == 0`, `ships == 0` y el
mejor score del intento es mayor que cero. Después reinicia su estado para que
otra partida dentro del mismo proceso pueda producir otro candidate.

No se trata de un detector universal. Es una conjunción de señales demostrada
para la ROM `invaders`; otros juegos necesitan su propio `observe_capture`.

La QA automática real insertó coin, inició y completó intentos mediante input
Lua sin abrir TAB. El candidate apareció mientras MAME seguía vivo, pero
pending permaneció vacío. Sólo el cierre normal y limpio lo promovió.

## Adapter y captura manual legacy

El adapter lee score BCD y devuelve a core únicamente:

```lua
candidate = {
  score = score,
  metadata = {
    gameOverDetected = true,
    finalGameMode = 0,
    playerAlive = 0,
    shipsRemaining = 0,
    displayScore = ...,
    trackedScore = ...,
    rollovers = ...
  }
}
```

Core 0.3.0 posee identidad, ROM, source, timestamp y versiones, y sanitiza
recursivamente metadata. `build_event` se conserva sólo como compatibilidad
legacy; una Competición protegida rechaza `writer.write_event()` y no depende
del menú HSL ni de TAB.

## Run y snapshot

Para Competición se construye:

```text
userData/runtime/runs/<runId>/
  pack/                       snapshot verificada
  plugins/hsl-score/          plugin productivo copiado
  events/candidates/          candidatos privados
  integrity/                  ledger y final seal
  cfg/ ctrlr/ nvram/ inp/ sta/ snap/ diff/ ini/ ...
```

MAME recibe ROM y artwork desde `runRoot/pack`; el adapter preparado procede de
`runRoot/pack/scripts/invaders.lua`. La prueba TOCTOU confirmó que una mutación
de Biblioteca después de copiar no altera la run, y que una mutación durante
copy provoca hash mismatch y no deja snapshot utilizable.

`cfg/` del pack queda vacío. Práctica puede usarlo como estado persistente; la
Competición empieza con un `runRoot/cfg` independiente y fuerza antes del ARM:

```text
Lives       : portTag=:IN2 mask=3 value=0 -> 3
Bonus Life  : portTag=:IN2 mask=8 value=0 -> 1500
```

## Lifecycle real de integridad

El QA 0.287 confirmó:

- soft reset: reset notifier, sin final seal;
- hard reset: stop intermedio con `exit_pending=false`, teardown/reinit y
  violación `machine_reset` recuperada desde markers;
- Escape normal: stop notifier con `exit_pending=true` y `final.marker`;
- kill/crash: falta final seal y la app falla cerrado.

Después de un candidate se probaron pause, cambio real de DIP, save+load, hard
reset/reinit y terminación forzada. Todos dejaron pending vacío y terminaron en
rejected/fail-closed. Una run limpia produjo evento final con provenance
`developer_override` porque el QA usó `C:/MAME/mame.exe`; producto exige runtime
bundled y receipt remoto verificado.

## Práctica real

Con el mismo `crt-geom`, la QA confirmó TAB, pausa/reanudación, save/load y DIP
libres. No hubo controller, plugin HSL, integrity, candidates ni requisito de
provenance. El `cfg/` del pack terminó vacío tras la prueba.

## Manifest competitivo final

El manifest v1 cubre:

```text
artwork/invaders.zip
pack.json
roms/invaders.zip
scripts/invaders.lua
```

Artwork se incluye porque su layout puede contener input interactivo. Samples
se copian al snapshot como audio suplementario, pero no se manifiestan porque
el ZIP auditado contiene sólo WAV de salida. Metadata, assets y manual sólo los
consume el launcher.

SHA-256 de los bytes canónicos del manifest después del hardening:

```text
64c19ea110acc2510ffbb3f8c358eb1cd97974cae7cbf9911542a414b9969619
```

La ROM permaneció intacta:

```text
43c75c2248af44189380d3bc3da42d4a486735399678663e411267000397e80a
```

## Distribución y límites

Una importación remota verificada liga artifact y manifest mediante receipt.
Import folder/ZIP manual sigue siendo válido para Biblioteca y Práctica, pero
no obtiene provenance productiva. Regenerar un manifest tras tampering no
mantiene la autoridad del receipt anterior.

Queda para `WEB-COMPETITION-INTEGRITY-1` publicar la identidad canónica,
validarla en ingest y cerrar bypass mediante RLS. No se publica ni modifica R2,
Supabase o Cloudflare desde esta tarea local.
