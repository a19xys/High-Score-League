# LOCAL-LAUNCHER-UX-REVAMP-1

## Implementado

La GUI se reorganizó como launcher de jugador:

- cabecera HSL compacta con cuenta, tema y estado `Conectado`, `Sin Internet` o
  `Reconectando`;
- biblioteca y detalle del juego como primera capa;
- `Jugar` como acción principal;
- `Practicar`, `Ver manual` y `Ver ranking` como acciones secundarias;
- actividad local resumida;
- cuenta y cambio de cuenta conservados;
- runtime, directorio, readiness, diagnose, logs y `sync-plugin` bajo
  `Opciones avanzadas`.

No se eliminó ninguna función existente. No se muestran tokens ni el contenido
completo de `session.json`.

## Prueba

```powershell
npm.cmd --prefix local/hsl-local-app test
npm.cmd --prefix local/hsl-local-app run gui
```

