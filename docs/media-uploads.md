# MEDIA-UPLOADS-1: imágenes públicas administrables

La web dispone de un sistema único para avatar, cabecera y logo de juego e
imagen de opción del cuestionario. `MEDIA-UPLOADS-1` está implementada,
`supabase/migrations/0024_media_uploads.sql` ya está aplicada en el Supabase
remoto y el sistema está funcional. Esto confirma la infraestructura, no qué
revisión concreta de la web está desplegada.

## Storage y rutas

El bucket público `hsl-public-media` sirve únicamente imágenes WebP y limita
cada objeto a 2 MiB. Las rutas nunca se sobrescriben (`upsert: false`) y usan un
UUID nuevo:

- `avatars/<USER_ID>/<UUID>.webp`;
- `games/headers/<UUID>.webp`;
- `games/logos/<UUID>.webp`;
- `polls/options/<UUID>.webp`.

La lectura por URL pública no requiere sesión. Las policies de
`storage.objects` permiten a un usuario autenticado insertar, consultar y
borrar únicamente objetos bajo su propia carpeta de avatar. `public.is_admin()`
autoriza esas operaciones en `games/headers`, `games/logos` y `polls/options`.
No hay policy `UPDATE`: todo reemplazo crea un objeto nuevo. Constraints de las
tablas comprueban además que cada columna solo admita su prefijo, un UUID y
extensión `.webp`; en avatar también comprueban el `profiles.id` propietario.

## Columnas y compatibilidad

`0024` añade columnas nullable, sin tocar los datos anteriores:

- `profiles.avatar_storage_path`;
- `games.header_image_storage_path`;
- `games.logo_image_storage_path`;
- `home_poll_options.image_storage_path`.

Se conservan `avatar_url`, `header_image_url`, `logo_image_url`, `image_url` y
`games.image_url`. Cuando hay path, los mapeadores construyen la URL pública del
bucket; si no, usan la URL legacy. Al guardar un archivo administrado se escribe
también su URL pública en el campo antiguo para mantener compatibles los
consumidores que aún solo conocen URLs. No se descargan ni migran imágenes
externas existentes.

## Pipeline del navegador

El componente compartido `MediaUpload` acepta JPEG, PNG y WebP mediante un
`input type=file` real. Rechaza otros MIME —incluidos SVG y GIF—, originales
vacíos, mayores de 12 MiB o imágenes decodificadas de más de 25 megapíxeles.
La decodificación real evita confiar en extensión o MIME declarado.

La imagen se dibuja en canvas sin escalar hacia arriba, conservando proporción
y canal alfa, y se re-encodea siempre como WebP. El encoder nativo de Canvas es
la ruta rápida. Si devuelve PNG, `null` o falla, se marca como no disponible en
una caché de sesión y se carga de forma diferida `@jsquash/webp` 1.5.0. El
fallback recibe el `ImageData` RGBA del canvas ya reducido, usa libwebp con la
misma calidad conceptual (convertida de 0–1 a 0–100) y no vuelve a decodificar
el original. La salida se valida por MIME y tamaño antes de continuar.

Ambas rutas usan las mismas cinco calidades y hasta cinco reducciones de
dimensiones; el objetivo se intenta primero mediante calidad y después mediante
tamaño. El re-encode elimina los metadatos del original. Sólo se rechaza si
ambos encoders fallan o la salida WebP real no baja del máximo de 2 MiB.

| Preset | Caja máxima | Calidad inicial | Peso objetivo |
| --- | ---: | ---: | ---: |
| Avatar | 512 × 512 | 0,86 | 350 KiB |
| Cabecera de juego | 1920 × 1080 | 0,86 | 1,5 MiB |
| Logo de juego | 1400 × 1400 | 0,92 | 1 MiB |
| Opción de cuestionario | 1024 × 1024 | 0,85 | 700 KiB |

La preview usa un Object URL del WebP ya procesado y lo revoca al cambiarlo o
desmontar el componente. Seleccionar no sube nada. La subida empieza únicamente
al guardar y usa `contentType: image/webp`, `cacheControl: 31536000` y
`upsert: false` directamente contra Supabase con la sesión del navegador; no
hay proxy Next ni `service_role` en cliente.

## Lifecycle y recuperación

Los cuatro editores comparten el mismo ciclo:

1. subir todos los reemplazos con rutas nuevas;
2. persistir paths y URLs en base de datos o API;
3. borrar los objetos administrados sustituidos o retirados.

Si falla una subida múltiple o la persistencia, se borran todos los objetos
nuevos ya subidos. La imagen antigua no se borra antes de confirmar la base de
datos. Si solo falla esa limpieza final, el guardado se conserva y la UI muestra
un aviso no bloqueante. En cuestionarios, la regla «todas las opciones con
imagen o ninguna» contempla conjuntamente URLs legacy, paths actuales,
reemplazos y retiradas pendientes.

## Instalación o despliegue en un entorno nuevo

En un Supabase nuevo, o en uno que todavía no tenga esta migración, se deben
aplicar las migraciones en orden y ejecutar `0024_media_uploads.sql` antes de
desplegar código que consulte los paths administrados. En el entorno remoto
actual `0024` ya está aplicada y no debe volver a ejecutarse como si siguiera
pendiente.

El código anterior puede seguir funcionando tras la migración porque ignora las
columnas nuevas; por eso un rollback web continúa siendo posible. Aplicar la
migración no demuestra por sí solo que la revisión web más reciente esté
desplegada.

Checklist en Supabase:

- bucket `hsl-public-media` público, límite 2 MiB y MIME `image/webp`;
- las cuatro columnas nuevas existen y son nullable;
- usuario normal solo puede gestionar `avatars/<su uid>/...`;
- ese usuario no puede escribir juegos, polls ni otro avatar;
- admin puede gestionar las tres familias administrativas;
- URL pública de un objeto válido responde sin sesión;
- no existe policy de `UPDATE` para este bucket.

Las capturas de submissions no forman parte de esta tarea. Cuando se
implementen deberán usar un bucket privado separado, autorizaciones y URLs
firmadas; no deben reutilizar `hsl-public-media`.

## Anonimización de avatar

`PROFILE-ANONYMIZATION-1` elimina de forma recursiva únicamente los objetos del
prefijo exacto `avatars/<uid>/` en `hsl-public-media` y deja nulo tanto
`avatar_storage_path` como `avatar_url`. Nunca enumera ni borra las familias de
juegos, cabeceras, logos o cuestionarios. La limpieza se reintenta si falla tras
crear el tombstone.

El bucket es público y los objetos usan caché larga; borrar el origen no implica
que una copia ya servida desaparezca inmediatamente de todos los caches. La UI
de la revisión compatible deja de renderizar el avatar por datos, pero no se
afirma una purga instantánea de CDN.
