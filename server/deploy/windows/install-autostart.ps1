# Richtet "Xenios" als geplante Aufgabe ein: Start beim Hochfahren, Neustart bei Absturz.
# Aufruf (als Administrator):  powershell -ExecutionPolicy Bypass -File server\deploy\windows\install-autostart.ps1
# Entfernen:                   Unregister-ScheduledTask -TaskName "Xenios" -Confirm:$false

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js nicht gefunden. Bitte zuerst installieren: winget install OpenJS.NodeJS.LTS' }
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'data') | Out-Null

$cmd = "/c `"`"$node`" src\index.js >> data\server.log 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'Xenios' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'Xenios'

# HTTPS-Port im Heimnetz freigeben (nur privates Netzwerkprofil)
$port = 8443
$cfgFile = Join-Path $repo 'config.json'
if (Test-Path $cfgFile) { $p = (Get-Content $cfgFile -Raw | ConvertFrom-Json).https.port; if ($p) { $port = $p } }
if (-not (Get-NetFirewallRule -DisplayName 'Xenios HTTPS' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Xenios HTTPS' -Direction Inbound -Protocol TCP -LocalPort $port -Profile Private -Action Allow | Out-Null
}

Write-Host "OK: Aufgabe 'Xenios' läuft. Log: $repo\data\server.log" -ForegroundColor Green
Write-Host "Erster Start: https://<IP-dieses-PCs>:$port im Browser öffnen. Den Einrichtungscode zeigt data\server.log."
