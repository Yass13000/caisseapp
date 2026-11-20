; Avant d'installer ou de désinstaller : ferme l'application, y compris ses fenêtres cachées
; (impression en cours, etc.). Sans ça, l'installateur restait bloqué sur « application ouverte ».
!macro customCheckAppRunning
  nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 1500
!macroend
