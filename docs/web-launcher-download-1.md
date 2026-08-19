# WEB-LAUNCHER-DOWNLOAD-1 + WEB-LAUNCHER-DOWNLOAD-2

## Resultado

El Home autenticado ofrece una descarga activa para Windows x64 y presenta
GNU/Linux como plataforma futura sin enlace, botón ni comportamiento JavaScript.
No se inspecciona el user agent: ambas opciones se muestran igual a todas las
personas y en cualquier navegador.

La descarga de Windows entra por el endpoint público y dinámico:

```text
GET /download/launcher/windows
```

El endpoint no requiere sesión y no sirve ni transmite el binario. Lee por HTTPS
el asset público
`https://github.com/a19xys/High-Score-League/releases/latest/download/release-manifest.json`
y, si el manifest es válido, responde `302` al instalador exacto de su tag:

```text
https://github.com/a19xys/High-Score-League/releases/download/<tag>/<installer>
```

Así, la resolución de «latest» y el instalador pertenecen a una misma lectura del
manifest. El redirect final nunca contiene `/latest/`, por lo que una publicación
concurrente no puede mezclar el manifest de una versión con el instalador de otra.

## Autoridades y contrato

El pipeline local sigue siendo la autoridad de build y versión del launcher:
`local/hsl-local-app/package.json` declara la versión que Stage valida y publica.
La web no importa ese package ni fija una versión de descarga. En tiempo de
petición, la única autoridad remota es `release-manifest.json` de la última Release
estable pública.

El parser admite exclusivamente:

- `schemaVersion: 1`;
- SemVer estable estricto `MAJOR.MINOR.PATCH`, sin prerelease, metadata ni ceros
  iniciales ambiguos;
- `tag` exactamente igual a `v<version>`;
- provenance con SHA Git completo y `refs/heads/master`;
- los assets completos `latest.yml`, installer y blockmap, con tamaños y hashes
  del formato publicado por el pipeline;
- installer con basename ASCII seguro, de longitud limitada y terminado en `.exe`.

Se rechazan rutas, barras, `..`, protocolos, query strings, fragments, escapes,
extensiones distintas de `.exe` y caracteres fuera del contrato seguro. La URL
final se construye solo con host, owner y repositorio definidos en código, y
codifica por separado el tag y el basename ya validados. El manifest no puede
seleccionar otro host ni proporcionar una URL completa.

La corrección `WEB-LAUNCHER-DOWNLOAD-2` separa explícitamente las autoridades:

```text
manifest.version             = autoridad de versión
manifest.tag                 = autoridad del tag
manifest.assets.installer.name = autoridad del nombre remoto
```

La web no infiere la versión desde `installer.name` ni exige que el nombre incluya
producto, `Setup` o SemVer. Nombres como `hsl-local-app-setup-0.3.0.exe` y
`High-Score-League-Windows-x64.exe` son válidos si el resto del manifest es
coherente. El bundle y la web conservan literalmente el basename publicado por
`latest.yml`.

## Iconos de plataforma

Los controles reservan un slot decorativo a la izquierda del bloque completo de
texto. Las rutas públicas fijadas son:

```text
public/icons/platform-windows.png   → /icons/platform-windows.png
public/icons/platform-gnu-linux.png → /icons/platform-gnu-linux.png
```

Los PNG no forman parte de esta implementación: el usuario los añadirá antes del
QA visual y del despliegue definitivo. Su ausencia temporal no afecta a tests,
TypeScript ni build, aunque el navegador mostrará un recurso roto hasta que estén
presentes. Los iconos usan texto alternativo vacío porque los títulos contiguos ya
comunican cada plataforma.

## Errores y caché

Un error de red, status no exitoso, payload sobredimensionado, JSON inválido,
schema no soportado o contrato incompleto produce el mismo `503` genérico. No se
exponen cuerpos, URLs, excepciones ni detalles del upstream y no existe fallback a
un nombre o versión conocidos.

Tanto el `302` como el `503` incluyen:

```text
Cache-Control: no-store, max-age=0
```

El fetch servidor también usa `cache: "no-store"`, no llama a la API de GitHub y
no envía token ni cabecera de autorización.

## Cobertura y QA manual

`tests/web-launcher-download.test.mts` cubre la release `0.2.0`, una futura `0.3.0`
con tres nombres remotos seguros distintos, nombres maliciosos, inconsistencias
versión/tag, schema incompleto, JSON inválido,
404/500/red, redirect exacto y cabeceras no-store en éxito y error. También fija la
regresión del Home: desaparecen las dos acciones antiguas de su hero, Windows usa
un `<a>` real a la ruta pública y GNU/Linux permanece fuera del foco y sin `href`.

Antes de publicar la web conviene comprobar manualmente el clic contra la Release
estable real, los temas claro/oscuro, los anchos móvil/escritorio y el estado 503
durante una indisponibilidad controlada del manifest.

## Límites

Esta tarea no distribuye GNU/Linux, no cambia `latest.yml`, manifests, assets,
versiones, tags, Releases ni workflows y no añade deep links. GitHub continúa
siendo el host del binario; la disponibilidad de la descarga depende de que la
última Release estable publique un manifest schema 1 íntegro y coherente.
