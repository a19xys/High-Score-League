# Autoridad competitiva semanal

La autoridad actual de una semana se deriva de una única semántica compartida por web, launcher API y reconciliación administrativa:

1. `weekly_results` o `weeks.status=published` cierran la competición.
2. Una temporada `completed` cierra; cualquier otra temporada no activa deja la semana inactiva.
3. Con temporada activa, un calendario completo decide `scheduled`, `active`, `final_stretch` o `closed`.
4. `weeks.status` es una proyección persistida del calendario. Un `closed` antiguo no vence a fechas actualmente abiertas; `published` sí es terminal hasta una reapertura reconciliada.

La reapertura soportada se realiza editando el calendario mediante `PATCH /api/admin/weeks/[weekId]`. Ese flujo conserva la semana como `published` mientras existan resultados, llama `reconcileWeek`, retira `weekly_results`, reconcilia visibilidad de submissions y solo entonces sincroniza `weeks.status` a `active` o `frozen`. La antigua escritura directa `/status` responde `410` y no modifica la base.

## Launcher local

La caché durable conserva la última conclusión remota, pero el acceso distingue:

- `fresh-confirmed`: autoridad online actual;
- `refreshing`: revalidación en curso, conservando la presentación estable;
- `stale-error`: última conclusión preservada, pero sin afirmarla como actual;
- `offline-durable`: conocimiento local utilizable según las reglas offline existentes.

Un único scheduler despierta en la próxima caducidad, transición de calendario o retry. Los fallos usan backoff exponencial de 5 segundos a 5 minutos, sin refresh concurrente. Reconexión, refresh manual y preflight pueden forzar revalidación inmediata. El preflight online continúa exigiendo una respuesta concluyente actual antes de lanzar MAME.

## Checklist manual con Space Invaders

La versión web que contiene la autoridad canónica debe estar desplegada antes de probar un launcher nuevo contra producción.

- Abrir el launcher con la semana activa: la card muestra `Activa` y `Jugar` está disponible.
- Cerrar mediante el flujo administrativo canónico: sin reiniciar ni cambiar de pack, el launcher converge a `Cerrada` al caducar/revalidar.
- Extender o reabrir el calendario: comprobar reconciliación, retirada de resultados anteriores y convergencia automática a `Activa`.
- Desconectar Internet: conservar el estado durable y permitir la captura/cola offline conforme al contexto conocido.
- Cambiar la semana remotamente mientras está offline: el launcher no inventa una nueva verdad.
- Reconectar: comprobar refresh inmediato y convergencia al estado remoto.
- Ejecutar `Jugar → MAME bundled → hsl-score → evento local → submission → web`.

Para diagnosticar una discrepancia, revisar `weekCapabilities` en el diagnóstico local: incluye last known state, freshness, autoridad efectiva, último intento/fallo, HTTP status, deployment y próximo retry sin tokens ni datos personales.
