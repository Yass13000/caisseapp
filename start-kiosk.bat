@echo off
:: Script de démarrage de la Borne Kiosk en mode plein écran
:: Pour Windows 11

echo ========================================
echo   Démarrage de la Borne Kiosk
echo ========================================
echo.

:: Vérifier si l'application existe
if not exist "%~dp0release\Borne Kiosk.exe" (
    echo ERREUR: L'application n'a pas été trouvée.
    echo Veuillez d'abord construire l'application avec:
    echo   npm run electron:build:win
    echo.
    pause
    exit /b 1
)

:: Démarrer l'application
echo Démarrage de l'application...
start "" "%~dp0release\Borne Kiosk.exe"

echo.
echo Application démarrée!
echo.
echo Pour quitter l'application, utilisez:
echo   Ctrl + Shift + Alt + Q
echo.
echo Pour ouvrir les DevTools (debug):
echo   Ctrl + Shift + Alt + D
echo.

exit
