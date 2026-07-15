# LOCAL-WEB-RANKING-CAPABILITIES-1

La web es la fuente autoritativa de disponibilidad. `active`, `final_stretch`,
`closed` y `published` son disponibles cuando existen semana, temporada y
juego; draft, futura oculta, scheduled, sin juego o inexistente son unavailable.
No se requieren scores.

`POST /api/launcher/ranking-capabilities` acepta hasta 100 solicitudes y
mantiene identificadores publicos `[A-Za-z0-9_-]`. Antes de consultar
`weeks.id` filtra UUIDs validos para PostgreSQL. Los no UUID se devuelven como
`not-found`, y un batch mixto conserva los resultados validos.

El body incluye `version`, `build`, `environment`, `generatedAt` y `results`.
Errores de configuracion, auth/proyecto, schema o transporte se clasifican en
logs sanitizados de servidor. La respuesta publica solo usa:

- `RANKING_SERVICE_NOT_CONFIGURED`;
- `RANKING_WEEKS_QUERY_FAILED`;
- `RANKING_CONTEXT_QUERY_FAILED`.

Electron usa TTL de 5 min para available, 2 min para unavailable y 20 s para
unknown. Un 503 produce unknown pero confirma que HSL responde. La cache no
habilita Ranking offline ni sobre otro build/origen/generacion.
