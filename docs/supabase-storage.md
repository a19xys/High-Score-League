# Supabase Storage for score screenshots

## Bucket

Nombre recomendado:

```text
score-screenshots
```

Preferencia inicial: bucket privado.

## Ruta sugerida

```text
season-{seasonId}/week-{weekId}/player-{playerId}/{timestamp}.png
```

Ejemplo:

```text
season-s1/week-w1/player-p1/2026-05-24T19-30-00.png
```

En produccion se usaran UUID reales. El nombre final puede usar extension
`.webp`, `.jpg` o `.png` segun el resultado de la optimizacion previa.

La fila asociada en `submissions` guarda `screenshot_path`,
`screenshot_mime_type` y `screenshot_size_bytes`.

## Permisos previstos

No se crean politicas de Storage en esta tarea. La idea inicial es:

- Los jugadores autenticados pueden subir capturas propias.
- Cada jugador puede leer sus propias capturas.
- Los admins pueden leer y gestionar todas las capturas.
- Las capturas visibles de submissions publicas o resultados publicados podran
  leerse mediante politicas o URLs firmadas.
- Las capturas ocultas de fin de semana no deben ser publicas antes de publicar
  resultados.
- En semanas `frozen`, la base de datos obliga a que las nuevas submissions se
  creen ocultas.

## Optimizacion futura

Antes de subir una captura, el frontend debera:

- Redimensionar imagenes grandes.
- Convertir a WebP si el navegador lo soporta.
- Usar JPEG o PNG como fallback.
- Mantener legibles la puntuacion y las siglas.
- Evitar archivos de gran tamano.
- Aplicar un tamano maximo recomendado de 1 MB o 2 MB.
- Guardar el MIME final y el tamano optimizado en `submissions`.

No se implementa todavia la subida ni la compresion real.
