# LOCAL-MANUAL-VIEWER-1

`Ver manual` resuelve en este orden:

1. `metadata.manual`;
2. `metadata.manualPath`;
3. `metadata.manualUrl` si es una URL `http(s)` explícita;
4. `manual/manual.html`;
5. `manual/manual.pdf`;
6. `manual/index.html`.

Las rutas locales deben ser relativas, permanecer dentro del pack y terminar en
HTML o PDF. Se rechazan rutas absolutas, `..`, URL y `file://` en campos de
ruta. Electron abre el archivo con `shell.openPath`; no se carga HTML del pack
en un renderer privilegiado. Si falta manual, la GUI muestra un mensaje amable.

