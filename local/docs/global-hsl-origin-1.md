# LOCAL CANONICAL HSL ORIGIN 1

El codigo fuente del launcher esta preparado para que la proxima build use un
unico origen oficial de red:

```text
https://highscoreleague.com
```

La release publica `0.3.0` sigue usando
`https://high-score-league.vercel.app`. La web mantiene ese host sirviendo
Production directamente, sin redirect, para que la release instalada siga
funcionando. Preparar el codigo no equivale a haber publicado una release
nueva.

## Resolucion y upgrade

En una build empaquetada, `packageMetadata.hslProduct` se valida como
configuracion publica y su `hslOrigin` gana sobre un `config.json` persistido.
Tambien ignora un `HSL_ORIGIN` accidental. No se reescribe el archivo del
usuario ni se borra `userData`.

En desarrollo se conserva `HSL_ORIGIN` como override explicito, seguido de
`config.hslOrigin`, el alias deprecado `config.webBaseUrl` y el origen oficial
compilado. La fuente del alias se registra como `legacy-webBaseUrl`. Todos los
valores deben ser origins HTTP(S) absolutos, sin credenciales, query ni hash, y
se normalizan mediante `URL.origin`.

No existe fallback, redirect cliente ni equivalencia de red entre el apex y el
host Vercel. Un fallo del apex sigue el estado offline/deferred ya existente.

## Remote Authority y caches

Remote Authority combina el origin exacto con la version soportada de Launcher
API. Por ello el namespace legacy y el namespace apex son distintos. Week,
Membership y Ranking empiezan frios bajo el apex; las entradas legacy no se
copian, renombran ni usan para satisfacerlo y pueden permanecer intactas en el
cache del usuario.

Health, Ranking, Week, Membership, Submission, Playtime, Presence y los
descriptores de packs derivan sus endpoints del mismo `hslOrigin`. Ranking
mantiene validacion same-origin: una respuesta legacy es foreign-origin para
una request apex, mientras una release `0.3.0` que consulta el host legacy puede
seguir usando URLs Ranking legacy.

## Metadata de packs historicos

`pack.webBaseUrl` es metadata auditada y nunca autoridad global. Los templates
de packs nuevos usan el apex. Para el pack historico publicado con metadata
legacy, el launcher reconoce exclusivamente la combinacion metadata declarada
`https://high-score-league.vercel.app` + autoridad oficial
`https://highscoreleague.com` y evita un warning falso. Esta excepcion vive en
la evaluacion de metadata del pack: no participa en networking, endpoint
building, Ranking, conectividad, Remote Authority ni caches.

Los bytes, hashes, manifests, provenance y registros publicados de
`space-invaders-s1-w1-r1` permanecen inmutables.

## Smoke y QA de release

El smoke empaquetado es offline y lee la configuracion efectiva mediante
`loadConfig()`. Exige `effectiveHslOrigin=https://highscoreleague.com`, fuente
remota `launcher-config` y fuente publica `product-metadata`.

Tras publicar la futura release, el operador debe validar ambos health hosts
sin redirects, un upgrade real desde `0.3.0` conservando `userData`, el primer
fetch frio bajo el apex y las operaciones remotas del pack historico. Este QA
no se considera realizado por preparar el codigo.
