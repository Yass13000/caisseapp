# Script PowerShell pour Chrome Kiosk - Borne Restaurant
# Pour Windows 11
# Version: 1.0.0

param(
    [switch]$InstallAutoStart,
    [switch]$RemoveAutoStart,
    [switch]$Start,
    [string]$Url = ""
)

# Configuration
$AppName = "Borne Chrome Kiosk"
$DefaultUrl = "http://localhost:5173"  # Modifiez selon votre configuration
$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

function Test-ChromeInstalled {
    if (-not (Test-Path $ChromePath)) {
        Write-Host "ERREUR: Chrome n'est pas installé à l'emplacement par défaut." -ForegroundColor Red
        Write-Host "Chemin attendu: $ChromePath" -ForegroundColor Red
        Write-Host ""
        Write-Host "Veuillez installer Google Chrome depuis:" -ForegroundColor Yellow
        Write-Host "https://www.google.com/chrome/" -ForegroundColor Cyan
        return $false
    }
    return $true
}

function Install-AutoStart {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Installation du démarrage automatique" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-ChromeInstalled)) {
        return
    }

    # Demander l'URL si non fournie
    if (-not $Url) {
        Write-Host "URL de l'application:" -ForegroundColor Yellow
        Write-Host "  1. http://localhost:5173  (Développement Vite)" -ForegroundColor White
        Write-Host "  2. http://localhost:3000  (Serveur local après build)" -ForegroundColor White
        Write-Host "  3. https://votre-domaine.com  (Production en ligne)" -ForegroundColor White
        Write-Host ""
        $urlChoice = Read-Host "Entrez le numéro (1-3) ou une URL personnalisée"

        switch ($urlChoice) {
            "1" { $Url = "http://localhost:5173" }
            "2" { $Url = "http://localhost:3000" }
            "3" {
                $Url = Read-Host "Entrez l'URL complète (ex: https://votre-domaine.com)"
            }
            default { $Url = $urlChoice }
        }
    }

    # Arguments Chrome pour le mode kiosk
    $ChromeArgs = @(
        "--kiosk `"$Url`"",
        "--kiosk-printing",
        "--no-first-run",
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        "--noerrdialogs",
        "--disable-translate",
        "--disable-features=TranslateUI",
        "--disable-component-update",
        "--disable-background-mode",
        "--disable-breakpad",
        "--disable-sync",
        "--disable-default-apps",
        "--no-default-browser-check",
        "--disable-prompt-on-repost",
        "--user-data-dir=`"%LOCALAPPDATA%\Google\Chrome\User Data\Kiosk`"",
        "--disable-restore-session-state",
        "--overscroll-history-navigation=0",
        "--disable-pinch",
        "--touch-events=enabled",
        "--force-device-scale-factor=1"
    ) -join " "

    # Créer une tâche planifiée
    $Action = New-ScheduledTaskAction -Execute $ChromePath -Argument $ChromeArgs
    $Trigger = New-ScheduledTaskTrigger -AtLogon
    $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0)

    try {
        Register-ScheduledTask -TaskName $AppName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null

        Write-Host "✓ Démarrage automatique configuré avec succès!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Configuration:" -ForegroundColor Cyan
        Write-Host "  URL: $Url" -ForegroundColor White
        Write-Host "  Démarrage: À la connexion de l'utilisateur $env:USERNAME" -ForegroundColor White
        Write-Host ""
        Write-Host "La borne Chrome Kiosk démarrera automatiquement au prochain login." -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "✗ Erreur lors de la création de la tâche planifiée:" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}

function Remove-AutoStart {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Suppression du démarrage automatique" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    try {
        Unregister-ScheduledTask -TaskName $AppName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "✓ Démarrage automatique supprimé!" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "⚠ Aucune tâche planifiée trouvée ou erreur lors de la suppression." -ForegroundColor Yellow
        Write-Host ""
    }
}

function Start-ChromeKiosk {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Démarrage de Chrome Kiosk" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-ChromeInstalled)) {
        return
    }

    # Utiliser l'URL fournie ou la valeur par défaut
    $TargetUrl = if ($Url) { $Url } else { $DefaultUrl }

    Write-Host "Configuration:" -ForegroundColor Yellow
    Write-Host "  URL: $TargetUrl" -ForegroundColor White
    Write-Host "  Chrome: $ChromePath" -ForegroundColor White
    Write-Host ""

    # Fermer toutes les instances Chrome
    Write-Host "Fermeture des instances Chrome existantes..." -ForegroundColor Yellow
    Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # Démarrer Chrome en mode kiosk
    Write-Host "Démarrage de Chrome en mode Kiosk..." -ForegroundColor Green
    Write-Host ""

    $ChromeArgs = @(
        "--kiosk", "`"$TargetUrl`"",
        "--kiosk-printing",
        "--no-first-run",
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        "--noerrdialogs",
        "--disable-translate",
        "--disable-features=TranslateUI",
        "--disable-component-update",
        "--disable-background-mode",
        "--disable-breakpad",
        "--disable-sync",
        "--disable-default-apps",
        "--no-default-browser-check",
        "--disable-prompt-on-repost",
        "--user-data-dir=$env:LOCALAPPDATA\Google\Chrome\User Data\Kiosk",
        "--disable-restore-session-state",
        "--overscroll-history-navigation=0",
        "--disable-pinch",
        "--touch-events=enabled",
        "--force-device-scale-factor=1"
    )

    Start-Process -FilePath $ChromePath -ArgumentList $ChromeArgs

    Write-Host "✓ Chrome Kiosk démarré!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Pour quitter le mode Kiosk:" -ForegroundColor Cyan
    Write-Host "  Alt + F4" -ForegroundColor White
    Write-Host ""
    Write-Host "Pour redémarrer:" -ForegroundColor Cyan
    Write-Host "  .\start-chrome-kiosk.ps1 -Start" -ForegroundColor White
    Write-Host "  ou" -ForegroundColor White
    Write-Host "  .\start-chrome-kiosk.ps1 -Start -Url 'http://votre-url.com'" -ForegroundColor White
    Write-Host ""
}

function Show-Help {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Chrome Kiosk - Gestion de la Borne" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Démarrer la borne:" -ForegroundColor Cyan
    Write-Host "    .\start-chrome-kiosk.ps1 -Start" -ForegroundColor White
    Write-Host "    .\start-chrome-kiosk.ps1 -Start -Url 'http://localhost:3000'" -ForegroundColor White
    Write-Host ""
    Write-Host "  Installer le démarrage automatique:" -ForegroundColor Cyan
    Write-Host "    .\start-chrome-kiosk.ps1 -InstallAutoStart" -ForegroundColor White
    Write-Host "    .\start-chrome-kiosk.ps1 -InstallAutoStart -Url 'http://localhost:3000'" -ForegroundColor White
    Write-Host ""
    Write-Host "  Supprimer le démarrage automatique:" -ForegroundColor Cyan
    Write-Host "    .\start-chrome-kiosk.ps1 -RemoveAutoStart" -ForegroundColor White
    Write-Host ""
    Write-Host "Paramètres:" -ForegroundColor Yellow
    Write-Host "  -Start              Démarrer Chrome Kiosk maintenant" -ForegroundColor White
    Write-Host "  -InstallAutoStart   Installer le démarrage automatique" -ForegroundColor White
    Write-Host "  -RemoveAutoStart    Supprimer le démarrage automatique" -ForegroundColor White
    Write-Host "  -Url <url>          URL de l'application (optionnel)" -ForegroundColor White
    Write-Host ""
    Write-Host "Exemples d'URL:" -ForegroundColor Yellow
    Write-Host "  http://localhost:5173         Développement (Vite)" -ForegroundColor White
    Write-Host "  http://localhost:3000         Serveur local (après build)" -ForegroundColor White
    Write-Host "  https://votre-domaine.com     Production en ligne" -ForegroundColor White
    Write-Host ""
}

# Exécuter la fonction appropriée
if ($InstallAutoStart) {
    Install-AutoStart
} elseif ($RemoveAutoStart) {
    Remove-AutoStart
} elseif ($Start) {
    Start-ChromeKiosk
} else {
    Show-Help
}
