# Assisted installers derive APP_FILENAME from productName, while the previous
# one-click per-user installer derived it from package name. Keep the existing
# canonical folder without hardcoding an absolute path or replacing the template.
!undef APP_FILENAME
!define APP_FILENAME "${APP_PACKAGE_NAME}"

!ifndef BUILD_UNINSTALLER
  Var hslCreateDesktopShortcut
  Var hslDesktopShortcutCheckbox

  !macro _hslIsNoDesktopShortcut _a _b _t _f
    StrCmp "$hslCreateDesktopShortcut" "0" `${_t}`
    ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
    StrCmp "$R9" "true" `${_t}` `${_f}`
  !macroend

  !undef isNoDesktopShortcut
  !define isNoDesktopShortcut `"" hslIsNoDesktopShortcut ""`

  !macro customPageAfterChangeDir
    Page custom hslDesktopShortcutPageCreate hslDesktopShortcutPageLeave
  !macroend

  !macro customHeader
    Function hslDesktopShortcutPageCreate
      ${If} ${isUpdated}
        Abort
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "Opciones de instalación" "Elige los accesos directos que quieres crear."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == "error"
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0u 12u 100% 14u "Crear acceso directo en el escritorio"
      Pop $hslDesktopShortcutCheckbox
      StrCpy $hslCreateDesktopShortcut "1"

      ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
      ${If} $R9 == "true"
        StrCpy $hslCreateDesktopShortcut "0"
      ${Else}
        ${NSD_Check} $hslDesktopShortcutCheckbox
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function hslDesktopShortcutPageLeave
      ${NSD_GetState} $hslDesktopShortcutCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $hslCreateDesktopShortcut "1"
      ${Else}
        StrCpy $hslCreateDesktopShortcut "0"
      ${EndIf}
    FunctionEnd
  !macroend
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\highscoreleague" "" "URL:High Score League Protocol"
  WriteRegStr HKCU "Software\Classes\highscoreleague" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\highscoreleague\DefaultIcon" "" "$INSTDIR\High Score League.exe,0"
  WriteRegStr HKCU "Software\Classes\highscoreleague\shell\open\command" "" '"$INSTDIR\High Score League.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\highscoreleague"
!macroend
