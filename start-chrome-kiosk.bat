@echo off
:: Script de démarrage Chrome Kiosk - Borne Restaurant
:: Pour Windows 11
:: Version: 1.0.0

echo ========================================
echo   Demarrage Borne en mode Chrome Kiosk
echo ========================================
echo.

:: Configuration - MODIFIEZ CES VALEURS
:: =====================================

:: URL de votre application
:: Option 1: Application hébergée en ligne
set APP_URL=http://localhost:5173

:: Option 2: Si vous utilisez un serveur local (après npm run build)
:: set APP_URL=http://localhost:3000

:: Option 3: Si vous avez déployé sur un serveur
:: set APP_URL=https://votre-domaine.com

:: Chemin vers Chrome (ne modifiez que si Chrome est installé ailleurs)
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

:: Vérifier si Chrome est installé
if not exist "%CHROME_PATH%" (
    echo ERREUR: Chrome n'est pas installe a l'emplacement par defaut.
    echo Chemin attendu: %CHROME_PATH%
    echo.
    echo Verifiez l'installation de Chrome ou modifiez CHROME_PATH dans ce script.
    pause
    exit /b 1
)

echo Configuration:
echo   URL: %APP_URL%
echo   Chrome: %CHROME_PATH%
echo.

:: Tuer toutes les instances de Chrome existantes
echo Fermeture des instances Chrome existantes...
taskkill /F /IM chrome.exe 2>nul
timeout /t 2 /nobreak >nul

:: Nettoyer le profil Chrome Kiosk (optionnel, décommentez si nécessaire)
:: rd /s /q "%LOCALAPPDATA%\Google\Chrome\User Data\Kiosk" 2>nul

echo Demarrage de Chrome en mode Kiosk...
echo.

:: Démarrer Chrome en mode Kiosk avec toutes les optimisations
start "" "%CHROME_PATH%" ^
  --kiosk "%APP_URL%" ^
  --kiosk-printing ^
  --no-first-run ^
  --disable-session-crashed-bubble ^
  --disable-infobars ^
  --noerrdialogs ^
  --disable-translate ^
  --disable-features=TranslateUI ^
  --disable-component-update ^
  --disable-background-mode ^
  --disable-breakpad ^
  --disable-sync ^
  --disable-default-apps ^
  --no-default-browser-check ^
  --disable-prompt-on-repost ^
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data\Kiosk" ^
  --disable-restore-session-state ^
  --disable-features=Translate ^
  --overscroll-history-navigation=0 ^
  --disable-pinch ^
  --touch-events=enabled ^
  --force-device-scale-factor=1

echo.
echo Chrome Kiosk demarre!
echo.
echo Pour quitter le mode Kiosk:
echo   Alt + F4
echo.
echo Pour revenir a ce script:
echo   Fermez Chrome et relancez ce fichier
echo.

:: Attendre quelques secondes puis fermer cette fenêtre
timeout /t 3 /nobreak >nul
exit
