# Launcher API

La API semantica del launcher confirma salud de HSL y disponibilidad de
rankings. No sustituye las APIs autenticadas de membership o submissions.

## GET /api/launcher/health

Respuesta correcta:

```text
204 No Content
Cache-Control: no-store, max-age=0
```

No requiere autenticacion, no consulta datos y no devuelve body. El launcher
solo acepta el `204` desde el mismo origen configurado. Otros metodos no estan
exportados y Next responde con metodo no permitido.

## POST /api/launcher/ranking-capabilities

Contrato versionado:

```json
{
  "version": 1,
  "requests": [
    { "requestKey": "library-0", "weekId": "week-id" }
  ]
}
```

Respuesta:

```json
{
  "version": 1,
  "generatedAt": "2026-07-15T12:00:00.000Z",
  "results": [
    {
      "requestKey": "library-0",
      "status": "available",
      "url": "https://highscoreleague.example/weeks/week-id",
      "reason": "public-week"
    }
  ]
}
```

Los resultados de servidor son `available` o `unavailable`. Razones actuales:
`public-week`, `not-found` y `not-public`.

Reglas de entrada:

- version exacta `1`;
- maximo 100 solicitudes;
- payload maximo 32 KiB;
- `requestKey` y `weekId` de 1 a 128 caracteres `[A-Za-z0-9_-]`;
- `requestKey` unico dentro del batch;
- un mismo `weekId` puede repetirse con distintas claves;
- no se aceptan URLs, filtros, tablas ni SQL.

El endpoint agrupa las consultas y selecciona columnas minimas. Usa el cliente
admin exclusivamente en servidor porque las politicas RLS actuales requieren
sesion para leer temporadas y semanas. El uso de service role queda encapsulado
en esta ruta: la respuesta solo revela si una semana es publica y su URL
canonica, nunca perfiles, puntuaciones, membership ni datos privados.

La logica de publicacion vive en `lib/launcher-ranking-capabilities.ts` y se
reutiliza desde `lib/data/week-detail.ts`, evitando dos definiciones distintas
de ranking disponible. Una tabla publica sin puntuaciones cuenta como
disponible.

Errores de infraestructura o consulta devuelven `503`; Electron los conserva
como estado operativo `unknown`, no como ausencia concluyente del ranking.

