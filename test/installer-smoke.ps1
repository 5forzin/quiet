param([string]$Installer)
$ErrorActionPreference = 'Stop'
$quietRoot = Split-Path -Parent $PSScriptRoot
$quietVersion = (Get-Content (Join-Path $quietRoot 'package.json') | ConvertFrom-Json).version
if (-not $Installer) { $Installer = Join-Path $quietRoot ('dist\Quiet-' + $quietVersion + '-windows-x64.exe') }
$quietRegistration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{E3F5F642-A672-460D-9C01-8D0D31AB287E}_is1'
if (Test-Path -LiteralPath $quietRegistration) { throw 'Quiet is already installed for this account. Run this smoke test on a clean account.' }
$quietArea = Join-Path $quietRoot ('.build\install-test-' + [Guid]::NewGuid().ToString('N'))
$quietApp = Join-Path $quietArea 'app'
$quietData = Join-Path $quietArea 'data'
New-Item -ItemType Directory -Path $quietArea | Out-Null
$quietPreviousData = $env:QUIET_DATA_DIR
$env:QUIET_DATA_DIR = $quietData
try {
  $quietArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', ('/DIR="' + $quietApp + '"'), ('/LOG="' + (Join-Path $quietArea 'install.log') + '"'))
  $quietProcess = Start-Process -FilePath $Installer -ArgumentList $quietArgs -WindowStyle Hidden -Wait -PassThru
  if ($quietProcess.ExitCode -ne 0) { throw ('Install failed: ' + $quietProcess.ExitCode) }
  $quietConfig = Join-Path $quietData 'config.json'
  $quietPairing = (Get-FileHash -LiteralPath $quietConfig).Hash
  $quietManifest = Get-Content (Join-Path $quietData 'extension\manifest.json') | ConvertFrom-Json
  if (-not $quietManifest.key -or $quietManifest.version -ne $quietVersion) { throw 'Extension initialization failed.' }
  if (Test-Path -LiteralPath (Join-Path $quietApp '.runtime')) { throw 'User data leaked into the program directory.' }
  New-Item -ItemType Directory -Path (Join-Path $quietData 'agent-profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $quietData 'agent-profile\fixture.txt') -Value 'Synthetic user data'
  $quietProcess = Start-Process -FilePath $Installer -ArgumentList $quietArgs -WindowStyle Hidden -Wait -PassThru
  if ($quietProcess.ExitCode -ne 0) { throw ('Repair failed: ' + $quietProcess.ExitCode) }
  if ((Get-FileHash -LiteralPath $quietConfig).Hash -ne $quietPairing) { throw 'Repair changed local pairing.' }
  $quietUninstaller = Join-Path $quietApp 'unins000.exe'
  $quietProcess = Start-Process -FilePath $quietUninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -WindowStyle Hidden -Wait -PassThru
  if ($quietProcess.ExitCode -ne 0) { throw ('Uninstall failed: ' + $quietProcess.ExitCode) }
  for ($quietAttempt = 0; $quietAttempt -lt 50 -and (Test-Path -LiteralPath (Join-Path $quietApp 'Quiet.exe')); $quietAttempt++) { Start-Sleep -Milliseconds 100 }
  if (Test-Path -LiteralPath (Join-Path $quietApp 'Quiet.exe')) { throw 'Uninstall left program files.' }
  if (Test-Path -LiteralPath $quietRegistration) { throw 'Uninstall left its registry entry.' }
  if ((Get-FileHash -LiteralPath $quietConfig).Hash -ne $quietPairing -or -not (Test-Path -LiteralPath (Join-Path $quietData 'agent-profile\fixture.txt'))) { throw 'Uninstall removed user data.' }
  Write-Output 'Installer smoke test passed: install, repair, uninstall and data preservation.'
} finally { $env:QUIET_DATA_DIR = $quietPreviousData }
