# Script PowerShell pour démarrer la Borne Kiosk au démarrage de Windows
# À exécuter en tant qu'administrateur

param(
    [switch]$InstallAutoStart,
    [switch]$RemoveAutoStart,
    [switch]$Start
)

$AppName = "Borne Kiosk"
$AppPath = Join-Path $PSScriptRoot "release\Borne Kiosk.exe"

function Install-AutoStart {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Installation du démarrage automatique" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # Vérifier si l'application existe
    if (-not (Test-Path $AppPath)) {
        Write-Host "ERREUR: L'application n'a pas été trouvée à:" -ForegroundColor Red
        Write-Host "  $AppPath" -ForegroundColor Red
        Write-Host ""
        Write-Host "Veuillez d'abord construire l'application avec:" -ForegroundColor Yellow
        Write-Host "  npm run electron:build:win" -ForegroundColor Yellow
        return
    }

    # Créer une tâche planifiée pour le démarrage automatique
    $Action = New-ScheduledTaskAction -Execute $AppPath
    $Trigger = New-ScheduledTaskTrigger -AtLogon
    $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $AppName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force

    Write-Host "✓ Démarrage automatique configuré avec succès!" -ForegroundColor Green
    Write-Host "  L'application démarrera automatiquement à la connexion de l'utilisateur." -ForegroundColor Green
    Write-Host ""
}

function Remove-AutoStart {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Suppression du démarrage automatique" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    Unregister-ScheduledTask -TaskName $AppName -Confirm:$false -ErrorAction SilentlyContinue

    Write-Host "✓ Démarrage automatique supprimé!" -ForegroundColor Green
    Write-Host ""
}

function Start-App {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Démarrage de la Borne Kiosk" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # Vérifier si l'application existe
    if (-not (Test-Path $AppPath)) {
        Write-Host "ERREUR: L'application n'a pas été trouvée." -ForegroundColor Red
        Write-Host "Veuillez d'abord construire l'application avec:" -ForegroundColor Yellow
        Write-Host "  npm run electron:build:win" -ForegroundColor Yellow
        return
    }

    Write-Host "Démarrage de l'application..." -ForegroundColor Yellow
    Start-Process $AppPath

    Write-Host ""
    Write-Host "Application démarrée!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Pour quitter l'application, utilisez:" -ForegroundColor Cyan
    Write-Host "  Ctrl + Shift + Alt + Q" -ForegroundColor White
    Write-Host ""
    Write-Host "Pour ouvrir les DevTools (debug):" -ForegroundColor Cyan
    Write-Host "  Ctrl + Shift + Alt + D" -ForegroundColor White
    Write-Host ""
}

function Show-Help {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Script de gestion de la Borne Kiosk" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\start-kiosk.ps1 -InstallAutoStart   # Installer le démarrage automatique"
    Write-Host "  .\start-kiosk.ps1 -RemoveAutoStart    # Supprimer le démarrage automatique"
    Write-Host "  .\start-kiosk.ps1 -Start               # Démarrer l'application maintenant"
    Write-Host ""
}

# Exécuter la fonction appropriée
if ($InstallAutoStart) {
    Install-AutoStart
} elseif ($RemoveAutoStart) {
    Remove-AutoStart
} elseif ($Start) {
    Start-App
} else {
    Show-Help
}
