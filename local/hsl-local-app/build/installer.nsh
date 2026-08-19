!macro customInstall
  WriteRegStr HKCU "Software\Classes\highscoreleague" "" "URL:High Score League Protocol"
  WriteRegStr HKCU "Software\Classes\highscoreleague" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\highscoreleague\DefaultIcon" "" "$INSTDIR\High Score League.exe,0"
  WriteRegStr HKCU "Software\Classes\highscoreleague\shell\open\command" "" '"$INSTDIR\High Score League.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\highscoreleague"
!macroend
