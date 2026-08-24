# Windows installer experience 1

## Resultado y alcance

`WINDOWS-INSTALLER-EXPERIENCE-1` prepara el Setup Windows de High Score League como instalador NSIS asistido. Es un cambio del source tree y de sus artefactos locales; no afirma que exista todavía una Release pública con este comportamiento.

El flujo de una instalación nueva queda reducido a:

```text
Directory (carpeta configurable)
→ Opciones (acceso directo de escritorio)
→ Install
→ Finish
```

La configuración efectiva conserva `target=nsis`, `perMachine=false`, `allowElevation=false`, el acceso directo de Inicio y `deleteAppDataOnUninstall=false`. `oneClick=false` y `allowToChangeInstallationDirectory=true` habilitan el flujo asistido. Una página `nsDialogs` pequeña permite decidir si se crea el acceso directo del escritorio. No se usa MSI, NSIS Web, un instalador Electron propio ni la opción `script` de electron-builder.

## Current User sin página de modo

Con un assisted installer, electron-builder mostraría normalmente la elección Current User / All Users. El include parcial `build/installer.nsh` usa el hook soportado `customInstallMode` y fija:

```nsis
StrCpy $isForceCurrentInstall "1"
```

La plantilla `multiUserUi.nsh` de electron-builder 26.15.7 consume ese valor, ejecuta `setInstallModePerUser` y aborta la página antes de crear sus controles. Por contrato no se muestra All Users, no aparece el shield de esa opción y el Setup mantiene `RequestExecutionLevel user`. No se escribe ningún registro artificial para conseguirlo.

## Carpeta predeterminada y reinstalaciones

HSL no hardcodea una carpeta. La plantilla `multiUser.nsh` de electron-builder 26.15.7 mantiene esta autoridad:

1. lee `InstallLocation` de la instalación per-user anterior en HKCU;
2. si existe, reutiliza esa ubicación;
3. para una instalación nueva intenta resolver el Known Folder `UserProgramFiles`;
4. si no puede, usa `$LocalAppData\Programs`;
5. añade `${APP_FILENAME}`.

La auditoría de la versión instalada detectó una diferencia relevante: electron-builder deriva `APP_FILENAME` del nombre npm (`hsl-local-app`) en el one-click per-user anterior, pero del nombre de producto (`High Score League`) en assisted. Aceptar ese cambio movería el default de una instalación nueva y haría que `instFilesPre` añadiese una subcarpeta al actualizar instalaciones anteriores. El include reata `APP_FILENAME` a `${APP_PACKAGE_NAME}`, que electron-builder deriva del `package.json`, y conserva así el subdirectorio canónico anterior sin hardcodear una ruta absoluta, escribir el registro ni crear `preInit`.

La página Directory y `instFilesPre` siguen perteneciendo a electron-builder. Si el usuario elige una carpeta padre que todavía no contiene el subdirectorio canónico `hsl-local-app`, la plantilla lo añade una sola vez. HSL no reemplaza esa normalización. El nombre técnico se conserva deliberadamente por compatibilidad; renombrarlo a `High Score League` requeriría una migración de instalación separada, no un efecto lateral de activar assisted.

Al instalar, la plantilla persiste `InstallLocation=$INSTDIR` en la clave canónica. Una actualización posterior recupera ese mismo path. Además, `assistedInstaller.nsh` aplica `skipPageIfUpdated` inmediatamente antes de `MUI_PAGE_DIRECTORY`: el updater puede ejecutar el mismo NSIS en modo silencioso sin volver a preguntar ubicación.

## Deep link, uninstall y datos persistentes

El include continúa registrando `highscoreleague://` bajo HKCU con el comando:

```text
"$INSTDIR\High Score League.exe" "%1"
```

Por tanto el protocolo sigue al ejecutable real aunque la instalación esté en otra unidad. `customUnInstall` elimina `HKCU\Software\Classes\highscoreleague`.

La carpeta configurable contiene únicamente los archivos instalados. Electron `userData`, Biblioteca, packs, scores, sesiones, preferencias, Playtime, caches y diagnósticos conservan sus autoridades actuales. El uninstall mantiene `deleteAppDataOnUninstall=false` y no ofrece una carpeta de datos alternativa.

## Acceso directo de escritorio

El hook soportado `customPageAfterChangeDir` inserta una página estándar entre Directory e Install. Contiene una sola opción:

```text
☑ Crear acceso directo en el escritorio
```

Está marcada por defecto en una instalación interactiva nueva. Al desmarcarla, el include proyecta la elección sobre la misma condición `isNoDesktopShortcut` que electron-builder evalúa antes de `CreateShortCut`; no existe un segundo creador de shortcuts. El parámetro soportado `--no-desktop-shortcut` también mantiene precedencia. La página aborta inmediatamente para `${isUpdated}`, por lo que el updater sigue sin presentar UI adicional.

## Apariencia NSIS nativa

El primer build oscuro mostró que el checkbox «Ejecutar High Score League» de Finish conservaba texto negro sobre el fondo azul marino. MUI2 3.0.4.1 ya aplica `SetCtlColors` a ese control, pero el checkbox tematizado de Windows no respetó el color de forma fiable. Para no introducir hooks Win32 frágiles, se retiraron `MUI_BGCOLOR`, `MUI_TEXTCOLOR` y `MUI_INSTFILESPAGE_COLORS`.

Header, Directory, opciones, detalles, Finish, checkbox de ejecución, botones y titlebar usan ahora todos los colores nativos de NSIS/Windows. No se leen `AppsUseLightTheme` ni preferencias del launcher, no hay recoloreado runtime, bitmaps nuevos ni script NSIS completo.

## Cobertura automatizada

`test/packaging-foundation.test.js` comprueba la configuración efectiva, el hook Current User, la ausencia de colores personalizados, la página de shortcut marcada por defecto, el registro y retirada del deep link y la ausencia de paths hardcodeados o hacks dinámicos. También fija seams de la plantilla instalada de electron-builder 26.15.7 para:

- `skipPageIfUpdated` delante de Directory;
- normalización mediante `instFilesPre` y `${APP_FILENAME}`;
- lectura previa de `InstallLocation` en HKCU;
- fallback a `UserProgramFiles` / `$LocalAppData\Programs`;
- escritura de `InstallLocation=$INSTDIR`.
- consumo de `isNoDesktopShortcut` antes de crear el acceso directo.

Estas pruebas no pueden demostrar el texto exacto que Windows renderiza dentro del Setup. Ese punto requiere QA humano.

## QA manual pendiente

### Fresh install con ubicación predeterminada

1. Usar una máquina o perfil Windows sin una instalación HSL registrada.
2. Abrir `High Score League Setup <version>.exe` y confirmar que Directory aparece directamente, sin Current User / All Users ni UAC.
3. No cambiar el path y verificar visualmente que coincide con la ubicación propuesta por el instalador anterior.
4. Avanzar a Opciones y confirmar que «Crear acceso directo en el escritorio» está marcada.
5. Instalar y comprobar GUI, icono, versión, shortcuts de escritorio/Inicio y `highscoreleague://`.

### Fresh install con ubicación personalizada

1. Desinstalar la app preservando `userData`.
2. Repetir con una carpeta escribible, por ejemplo `C:\Users\<user>\HSL-Test\hsl-local-app`, o una unidad secundaria; `hsl-local-app` es el subdirectorio canónico heredado.
3. Confirmar que no aparece `hsl-local-app\hsl-local-app` duplicado.
4. Verificar ejecutable, resources, MAME bundled, launcher, uninstaller y que `highscoreleague://` abre ese ejecutable.
5. Repetir con el checkbox de escritorio desmarcado y confirmar que no se crea ese acceso directo, mientras Inicio permanece.
6. No usar una carpeta protegida que requiera administrador como caso normal.

### Upgrade real N → N+1

1. Partir de una Release anterior instalada, idealmente en una carpeta personalizada, con sesión, preferencias, packs y datos representativos.
2. Aceptar la actualización desde el updater.
3. Confirmar que no aparece Directory ni la página de shortcut, no cambia `InstallLocation`, no nace una segunda instalación, no se duplica ningún shortcut y el deep link sigue correcto.
4. Verificar que sesión, Biblioteca, packs, Playtime, colas, MAME mutable y el resto de `userData` permanecen.

### Uninstall y QA visual

1. Desinstalar y confirmar que desaparecen archivos instalados y `HKCU\Software\Classes\highscoreleague`, mientras `userData` permanece.
2. Revisar Windows 10/11 disponible a 100% DPI y, si es posible, 125% o 150%.
3. Confirmar que todas las páginas usan colores nativos legibles y que «Ejecutar High Score League» se ve correctamente.
4. Comprobar el checkbox de escritorio, el textbox de Directory y los botones a cada DPI.

## Riesgos residuales

- La compilación NSIS y las pruebas contractuales no sustituyen la inspección visual del path predeterminado real.
- La garantía de que el updater preserva una ubicación personalizada requiere un E2E físico con dos versiones publicables distintas.
- La cobertura de Windows 10/11, DPI y políticas corporativas/UAC depende del parque de QA disponible.
- El subdirectorio técnico `hsl-local-app` se mantiene para no mover instalaciones existentes; un rename visible futuro necesita una migración explícita y pruebas N → N+1.
