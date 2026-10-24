; Gitrochi was installed as "Branchwork" up to 0.3.5. After installing Gitrochi, remove that install
; (files, Start menu and desktop shortcuts, uninstall entry, WebView data) so only one copy remains.
; Settings in %APPDATA%\Branchwork are moved by the app itself on first launch (helper.rs data_dir).
!macro NSIS_HOOK_POSTINSTALL
  ; A quoted executable and quoted URL preserve argument boundaries, including encoded paths.
  WriteRegStr SHCTX "Software\Classes\gitrochi" "" "URL:Gitrochi Protocol"
  WriteRegStr SHCTX "Software\Classes\gitrochi" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\gitrochi\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  ReadRegStr $R0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Branchwork" "UninstallString"
  ReadRegStr $R1 SHCTX "${MANUKEY}\Branchwork" ""
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    ExecWait '$R0 /S _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Branchwork"
  DeleteRegKey SHCTX "${MANUKEY}\Branchwork"
  RMDir /r "$LOCALAPPDATA\io.github.chomnseong.branchwork"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $R0 SHCTX "Software\Classes\gitrochi\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegKey SHCTX "Software\Classes\gitrochi"
  ${EndIf}
!macroend
