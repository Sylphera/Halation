; "Open with > Halation" in the context menu of images and audio files.
; It only adds the option: it never changes the default program of any file type.
; And Halation's package identity (windows/identity): registered here, so Windows counts WebView2's processes as
; Halation's (Task Manager). Unsigned, for this user; what PowerShell answers is kept in identity.log.

!macro SYL_PROGID PROGID DESC
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro SYL_OPENWITH EXT PROGID
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro SYL_UNOPENWITH EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

!macro SYL_FOREACH_TYPE MACRO
  !insertmacro ${MACRO} "png" "Halation.Image"
  !insertmacro ${MACRO} "jpg" "Halation.Image"
  !insertmacro ${MACRO} "jpeg" "Halation.Image"
  !insertmacro ${MACRO} "webp" "Halation.Image"
  !insertmacro ${MACRO} "bmp" "Halation.Image"
  !insertmacro ${MACRO} "gif" "Halation.Image"
  !insertmacro ${MACRO} "avif" "Halation.Image"
  !insertmacro ${MACRO} "mp3" "Halation.Audio"
  !insertmacro ${MACRO} "wav" "Halation.Audio"
  !insertmacro ${MACRO} "flac" "Halation.Audio"
  !insertmacro ${MACRO} "m4a" "Halation.Audio"
  !insertmacro ${MACRO} "aac" "Halation.Audio"
  !insertmacro ${MACRO} "ogg" "Halation.Audio"
  !insertmacro ${MACRO} "opus" "Halation.Audio"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro SYL_PROGID "Halation.Image" "Halation image"
  !insertmacro SYL_PROGID "Halation.Audio" "Halation audio"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro SYL_FOREACH_TYPE SYL_OPENWITH
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& { try { Get-AppxPackage -Name Halation.App | Remove-AppxPackage -ErrorAction SilentlyContinue; Add-AppxPackage -Path '$INSTDIR\Halation.msix' -ExternalLocation '$INSTDIR' -AllowUnsigned -ErrorAction Stop; 'registered' } catch { $$_.Exception.Message } } *> '$INSTDIR\identity.log'"`
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-AppxPackage -Name Halation.App | Remove-AppxPackage"`
  Pop $0
  Delete "$INSTDIR\identity.log"
  !insertmacro SYL_FOREACH_TYPE SYL_UNOPENWITH
  DeleteRegKey SHCTX "Software\Classes\Halation.Image"
  DeleteRegKey SHCTX "Software\Classes\Halation.Audio"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
