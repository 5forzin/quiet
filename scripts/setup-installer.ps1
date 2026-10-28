$ErrorActionPreference = 'Stop'
$quietRoot = Split-Path -Parent $PSScriptRoot
$quietTools = Join-Path $quietRoot '.build\tools\inno'
$quietDownload = Join-Path $quietRoot '.build\downloads\innosetup-7.1.0-x64.exe'
if (Test-Path -LiteralPath (Join-Path $quietTools 'ISCC.exe')) { exit 0 }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $quietDownload) | Out-Null
Invoke-WebRequest -Uri 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe' -OutFile $quietDownload
if ((Get-FileHash -LiteralPath $quietDownload -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f') { throw 'Inno Setup checksum mismatch.' }
$quietSignature = Get-AuthenticodeSignature -LiteralPath $quietDownload
if ($quietSignature.Status -ne 'Valid' -or $quietSignature.SignerCertificate.Subject -notmatch 'Pyrsys') { throw 'Inno Setup signature mismatch.' }
$quietProcess = Start-Process -FilePath $quietDownload -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/NOICONS', ('/DIR="' + $quietTools + '"')) -WindowStyle Hidden -Wait -PassThru
if ($quietProcess.ExitCode -ne 0) { throw 'Inno Setup installation failed.' }
