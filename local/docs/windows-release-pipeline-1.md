# Pipeline de Releases Windows 1

## Resultado y límites

La distribución estable del launcher se divide en tres autoridades y dos ejecuciones manuales:

```text
windows-release-stage.yml / build (contents: read)
  npm ci → test → dist:win una vez → smoke → bundle → Actions Artifact
                         │
                         └─ mode=stage: job mínimo (contents: write)
                            preflight → draft → upload → verificación remota

QA humano con el installer exacto del draft, incluida ubicación custom y upgrade sin Directory

windows-release-publish.yml / publish (contents: write, actions: read)
  Environment → provenance → artifact exacto → revalidación → publish → post-verificación
```

Los dos workflows solo tienen `workflow_dispatch`, comparten el grupo `hsl-windows-stable-release` y usan `cancel-in-progress: false`. No hay trigger por push, tag o Release. Stage nunca publica; Publish nunca construye, ejecuta `npm ci` ni sustituye assets.

Esta implementación no crea Releases durante su instalación en el repositorio. Las operaciones de escritura solo ocurren al ejecutar explícitamente `mode=stage` o Publish en GitHub Actions.

## Fuente, versión y forward-only

Stage acepta exclusivamente el repositorio `a19xys/High-Score-League`, rama por defecto `master`, `github.ref=refs/heads/master` y un `github.sha` igual al HEAD remoto de `master` al hacer el preflight. El input debe ser SemVer estable estricto `MAJOR.MINOR.PATCH`, sin `v`, prerelease ni ceros iniciales ambiguos, y coincidir exactamente con `local/hsl-local-app/package.json.version`.

La API recibe `target_commitish` como el SHA completo construido, nunca `master`. El tag se deriva una sola vez como `v<version>` y no se crea o empuja por separado. Publish permite que `master` haya avanzado durante el QA, pero comprueba que el commit original continúa en su historia, lee `package.json.version` en ese source commit exacto y verifica que el Actions Artifact procede del Stage run y SHA registrados.

La política es forward-only: la candidata debe ser estrictamente superior a la mayor Release estable válida previa. No se reutilizan versiones, no se mueven tags, no se reemplazan bytes publicados y no hay downgrade. Si `0.3.0` resulta defectuosa, se corrige como `0.3.1`; nunca se reconstruye `0.3.0`.

## Preflight remoto y conflictos

Cada fase consulta repositorio, branch, Releases publicadas, prereleases, drafts, tag candidato y `/releases/latest`. La latest estable debe incluir `latest.yml`, el installer referenciado por esa metadata y `<installer>.blockmap`; además debe coincidir con la mayor versión estable publicada. Un estado histórico ambiguo aborta sin intentar repararlo.

También abortan una Release/prerelease del mismo tag, un draft del mismo tag con otro commit, un tag incompatible, una versión no superior, un artifact expirado, provenance incoherente y cualquier asset ausente o con bytes diferentes. La pipeline no hace `DELETE` ni sobreescribe. Un draft conflictivo debe auditarse y resolverse manualmente en GitHub; si una versión ya se publicó, la única recuperación soportada es una versión superior.

## Bundle canónico

`npm run prepare:release-bundle` parte de `dist` ya validado y reutiliza `validateUpdateArtifacts()`. No reconstruye. Genera exactamente:

```text
release-bundle/
  latest.yml
  <safeArtifactName obtenido de latest.yml>
  <safeArtifactName>.blockmap
  release-manifest.json
```

El nombre bonito local de electron-builder puede contener espacios y no es autoridad remota. El installer se copia con el `url` exacto declarado por `latest.yml`, y el blockmap hereda ese nombre exacto. Los nombres admitidos son basenames ASCII seguros; no se reescribe metadata.

`release-manifest.json`, schema 1, registra versión/tag, `sourceCommit`, `sourceRef`, nombres remotos, tamaños, SHA-256 de metadata/installer/blockmap y el SHA-512 del installer que declara `latest.yml`. No contiene rutas del runner, usuario, tokens ni secretos. También se publica como cuarto asset de auditoría: electron-updater lo ignora y no forma parte de su protocolo.

`npm run validate:release-bundle` funciona solo con módulos built-in de Node en los jobs privilegiados. Exige esos cuatro ficheros y ninguno más; vuelve a calcular tamaños, SHA-256, SHA-512 y coherencia de metadata.

## Actions Artifact y provenance

El build sube `hsl-windows-release-<version>-<run-id>` mediante `actions/upload-artifact`, con error si faltan ficheros, compresión 0 y retención de 30 días. Se registran artifact ID, nombre, digest, Stage run ID, commit y versión.

El body del draft contiene un comentario HTML JSON parseable con schema 1, versión/tag, source commit/ref y los identificadores exactos del Artifact. Publish no busca «el último run», «el último artifact» ni «el último draft»: primero lee ese bloque, consulta el artifact por ID, exige que el run sea una ejecución manual exitosa de `.github/workflows/windows-release-stage.yml` sobre master/source commit y después `actions/download-artifact` lo recupera por `run-id` más `artifact-id`.

## Stage e idempotencia

`mode=dry-run` construye, prueba, conserva el Artifact y ejecuta la ruta de código `stageWindowsRelease({mode: "dry-run"})`. Esa ruta termina tras consultas GET y no puede hacer POST/PATCH/DELETE/upload de Release. El job con `contents: write` ni siquiera existe en esa ejecución.

`mode=stage` repite el mismo build protegido y, en un job separado sin `npm ci`, crea una Release con:

```text
tag_name       = v<version>
target_commitish = <SHA completo>
draft          = true
prerelease     = false
make_latest    = "false"
```

Después sube exclusivamente el bundle. Los ficheros grandes se envían como stream con `Content-Length` y `duplex: half`. Si un nombre ya existe, compara size y SHA-256: bytes idénticos se conservan; bytes diferentes abortan. Tras la subida relee el draft y verifica todos los assets. Usa el digest `sha256:` de GitHub cuando está disponible; si no, descarga el asset de forma autenticada y calcula SHA-256. El resultado debe seguir siendo draft.

No se reintentan automáticamente POST/PATCH/uploads: una respuesta perdida tras una mutación sería ambigua. El workflow falla y el operador lo relanza; la reconciliación por tag/commit/nombre/hash hace ese reintento seguro. Las lecturas también fallan de forma visible para evitar decidir sobre un estado parcial.

## Publish y verificación posterior

Publish exige exactamente `PUBLICAR v<version>` antes de hacer consultas publicables y otra vez antes del PATCH final. El job declara `environment: windows-release`; además es una segunda ejecución `workflow_dispatch`, de modo que un error de configuración del Environment no convierte un Stage en publicación automática.

La autoridad de publicación tiene tres barreras independientes: el job exige en YAML `github.ref == 'refs/heads/master'`; los comandos Node `locate` y `publish` validan directamente `GITHUB_REPOSITORY=a19xys/High-Score-League` y `GITHUB_REF=refs/heads/master` antes de cualquier operación publicable; y el Environment restringe qué ramas pueden desplegar. Así, el código privilegiado procede del `github.sha` de una ejecución lanzada sobre `master`, mientras que la provenance del draft conserva por separado su `sourceCommit` histórico. No se exige que ese `sourceCommit` coincida con el HEAD actual de `master` ni con el `github.sha` de Publish: `master` puede haber avanzado desde Stage.

Antes de publicar vuelve a comprobar draft, release ID, tag, target, provenance, artifact no expirado, Stage run/master/SHA, pertenencia histórica del commit, package version, latest estable y todos los hashes locales/remotos. Solo entonces envía:

```text
draft       = false
prerelease  = false
make_latest = "true"
```

La API actual modela `make_latest` como string (`"false"`/`"true"`), no boolean. Después relee la Release, exige que `/releases/latest` sea su mismo ID, revalida assets y resuelve tanto tags lightweight como annotated hasta el source commit exacto.

El cliente REST usa `fetch`, `fs`, streams, `crypto` y `path`, con `GITHUB_TOKEN` efímero y `X-GitHub-Api-Version: 2026-03-10`. No usa PAT, GitHub CLI, una Action de Releases ni dependencias npm en jobs con escritura. Los errores solo muestran método, path, status, mensaje saneado y request ID; nunca headers Authorization, token o URLs firmadas.

## Permisos y Actions fijadas

Permisos por job:

- Build: `contents: read`.
- Stage del draft: `contents: write`.
- Publish: `contents: write` y `actions: read`.

El único job que ejecuta código de dependencias (`npm ci`, tests y electron-builder) es Build y no puede escribir Releases. Stage/Publish hacen checkout sin persistir credenciales y no instalan paquetes.

Todas las Actions son oficiales y están fijadas a commits completos verificados:

- `actions/checkout` v6.0.2: `de0fac2e4500dabe0009e67214ff5f5447ce83dd`.
- `actions/setup-node` v7.0.0: `820762786026740c76f36085b0efc47a31fe5020`.
- `actions/upload-artifact` v7.0.1: `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.
- `actions/download-artifact` v8.0.1: `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`.

Build usa `windows-2025`, Node 22 y el flujo existente `prepare:package`; el manifest de MAME sigue siendo la única autoridad de versión/hash/staging. `dist:win` conserva `--publish never`: electron-builder no tiene autoridad para publicar.

## Configuración de GitHub requerida antes de la primera Release

1. En `Settings → Environments`, crear `windows-release` y añadir un required reviewer. Restringir el despliegue mediante `Deployment branches and tags → Selected branches and tags → Branch → master`. Esta es la tercera barrera independiente, además del `if` del job y la validación Node. Si la misma persona debe disparar y aprobar, no activar `Prevent self-review`, pues impediría ese flujo; si existe un segundo revisor, activarlo aporta separación adicional.
2. En `Settings → Releases`, activar `Enable release immutability` **antes** de publicar `0.2.0`. La política solo protege Releases futuras. Con ella, assets y tag quedan bloqueados tras publicar; por eso todo se completa y verifica en draft.
3. En `Settings → Actions`, confirmar que Actions está habilitado y que el `GITHUB_TOKEN` puede usar los permisos declarados por workflow. No configurar un PAT ni secretos de cliente.

## Primera ejecución de 0.2.0

Después de revisar y commitear esta pipeline:

1. Ejecutar `Windows release - build and stage` desde `master` con `version=0.2.0`, `mode=dry-run`. Deben pasar tests/build/smoke/bundle y quedar solo el Actions Artifact.
2. Revisar logs, resumen, SHA, artifact ID/digest y manifest.
3. Ejecutar de nuevo Stage con `version=0.2.0`, `mode=stage`. Debe quedar un draft, nunca una Release publicada.
4. Abrir el draft, descargar su installer exacto y probar manualmente `0.1.0 → 0.2.0`, conservando sesión, cuentas, Biblioteca, rutas, tema, Favoritos, Playtime, colas, packs, MAME y userData.
5. Solo tras el QA, ejecutar `Windows release - publish validated draft` con `version=0.2.0` y `confirmation=PUBLICAR v0.2.0`; aprobar `windows-release` si está protegido.
6. Verificar la Release, `/releases/latest`, tag y assets. Abrir un cliente `0.2.0`: no debe ofrecerse a sí mismo.

Publicar `0.2.0` no actualiza un cliente que ya tiene `0.2.0`. La primera auto-update real será una Release estable posterior, como `0.2.1` o `0.3.0`; no se crea una versión ficticia.

Tras preparar el source tree del launcher en `0.3.0`, esa versión es la candidata real para la primera auto-update `0.2.0 → 0.3.0`. Esta preparación local no afirma que el E2E del updater ya se haya ejecutado.

## Recuperación y limitaciones

- Si Build y la subida del Actions Artifact terminaron correctamente y falla solo el job Stage, abrir esa misma ejecución en GitHub Actions y elegir `Re-run jobs → Re-run failed jobs`. Se reutilizan el `github.sha`, el `github.ref`, el build y el artifact originales; si había un draft parcial, Stage completa únicamente assets ausentes y conserva los idénticos.
- Iniciar una ejecución completa nueva solo si Build falló o el artifact es inválido o ha expirado. En esos casos se repiten Build y las validaciones antes de intentar Stage.
- No automatizar reintentos REST de POST, PATCH o uploads después de una respuesta ambigua. Reejecutar el job desde GitHub Actions permite que la reconciliación por tag, commit, nombre y hash determine el estado remoto antes de mutarlo.
- Si aparece un hash distinto o estado remoto ambiguo, no borrar automáticamente. Auditar el draft/tag/asset en GitHub y resolverlo manualmente; nunca ocultar un conflicto.
- Si el Artifact expira a los 30 días, Publish falla. Debe repetirse Stage y el QA humano, no reconstruir silenciosamente durante Publish.
- Las pruebas locales usan un GitHub fake. No demuestran todavía ejecución real en GitHub-hosted `windows-2025`, permisos efectivos del repositorio, creación real del draft, upload de ~200 MB, protección del Environment, immutability ni una actualización N→N+1. Esos puntos se validan en la primera operación posterior al commit.
