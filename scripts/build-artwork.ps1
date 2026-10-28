param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$quietRoot = Split-Path -Parent $PSScriptRoot
$quietLogo = [Drawing.Image]::FromFile((Join-Path $quietRoot 'assets\quiet-icon.png'))
$quietSurface = [Drawing.Color]::FromArgb(48, 50, 49)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$quietFrames = @()
foreach ($quietSize in @(16, 32, 48, 128, 256)) {
  $quietBitmap = New-Object Drawing.Bitmap($quietSize, $quietSize)
  $quietGraphics = [Drawing.Graphics]::FromImage($quietBitmap)
  $quietGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $quietGraphics.DrawImage($quietLogo, 0, 0, $quietSize, $quietSize)
  $quietPng = New-Object IO.MemoryStream
  $quietBitmap.Save($quietPng, [Drawing.Imaging.ImageFormat]::Png)
  $quietBytes = $quietPng.ToArray()
  [IO.File]::WriteAllBytes((Join-Path $Destination ('icon-' + $quietSize + '.png')), $quietBytes)
  $quietFrames += ,@($quietSize, $quietBytes)
  $quietPng.Dispose(); $quietGraphics.Dispose(); $quietBitmap.Dispose()
}
$quietStream = [IO.File]::Create((Join-Path $Destination 'quiet.ico'))
$quietWriter = New-Object IO.BinaryWriter($quietStream)
$quietWriter.Write([uint16]0); $quietWriter.Write([uint16]1); $quietWriter.Write([uint16]$quietFrames.Count)
$quietOffset = 6 + 16 * $quietFrames.Count
foreach ($quietFrame in $quietFrames) {
  $quietDimension = if ($quietFrame[0] -eq 256) { 0 } else { $quietFrame[0] }
  $quietWriter.Write([byte]$quietDimension); $quietWriter.Write([byte]$quietDimension)
  $quietWriter.Write([byte]0); $quietWriter.Write([byte]0)
  $quietWriter.Write([uint16]1); $quietWriter.Write([uint16]32)
  $quietWriter.Write([uint32]$quietFrame[1].Length); $quietWriter.Write([uint32]$quietOffset)
  $quietOffset += $quietFrame[1].Length
}
foreach ($quietFrame in $quietFrames) { $quietWriter.Write([byte[]]$quietFrame[1]) }
$quietWriter.Dispose()
foreach ($quietSpec in @(@(192, 386, 'wizard.bmp'), @(64, 64, 'wizard-small.bmp'))) {
  $quietBitmap = New-Object Drawing.Bitmap($quietSpec[0], $quietSpec[1])
  $quietGraphics = [Drawing.Graphics]::FromImage($quietBitmap)
  $quietGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $quietGraphics.Clear($quietSurface)
  if ($quietSpec[0] -gt 64) {
    $quietGraphics.DrawImage($quietLogo, 32, 46, 128, 128)
    $quietTitle = New-Object Drawing.Font('Segoe UI Semibold', 25, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $quietCaption = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $quietInk = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(242,243,242))
    $quietMuted = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(169,174,171))
    $quietAccent = New-Object Drawing.Pen([Drawing.Color]::FromArgb(133,201,164), 2)
    $quietGraphics.DrawString('Quiet', $quietTitle, $quietInk, 32, 180)
    $quietGraphics.DrawLine($quietAccent, 32, 316, 64, 316)
    $quietGraphics.DrawString('WINDOWS', $quietCaption, $quietMuted, 32, 332)
    $quietTitle.Dispose(); $quietCaption.Dispose(); $quietInk.Dispose(); $quietMuted.Dispose(); $quietAccent.Dispose()
  }
  else { $quietGraphics.DrawImage($quietLogo, 6, 6, 52, 52) }
  $quietBitmap.Save((Join-Path $Destination $quietSpec[2]), [Drawing.Imaging.ImageFormat]::Bmp)
  $quietGraphics.Dispose(); $quietBitmap.Dispose()
}
$quietLogo.Dispose()
