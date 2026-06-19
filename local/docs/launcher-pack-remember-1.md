# LOCAL-LAUNCHER-PACK-REMEMBER-1

Persistencia mínima del último pack abierto por la GUI local.

## Archivo

La ruta del último pack válido se guarda en:

```text
userData/packs/recent.json
```

Contenido mínimo:

```json
{
  "lastOpenedPackDir": "C:/Users/u/Downloads/hsl-invaders",
  "updatedAt": "2026-06-19T00:00:00.000Z"
}
```

No se guardan tokens, claves de Supabase ni el contenido de `pack.json`.

## Cuándo se guarda

Solo se escribe cuando `Abrir pack` carga y valida correctamente un pack.

No se sobrescribe si:

- el usuario cancela el diálogo;
- falta `pack.json`;
- el pack es inválido;
- el pack no se puede leer.

## Carga al iniciar

Al arrancar la GUI, el servicio intenta leer `recent.json`. Si
`lastOpenedPackDir` existe y contiene un pack válido, queda activo
automáticamente y aparece el aviso:

```text
Último pack cargado correctamente.
```

Si la carpeta ya no existe o el pack dejó de ser válido, la GUI muestra:

```text
No se pudo cargar el último pack. Puedes abrirlo de nuevo.
```

La app sigue funcionando con el fallback de desarrollo puente.

## Límites

- No hay multi-pack completo.
- No hay lista editable de packs recientes.
- No se borra ni modifica el pack.
- No se borran eventos `pending`.
- No se mueve la cola a userData todavía.
- `sync-plugin` sigue siendo herramienta de desarrollo puente.
