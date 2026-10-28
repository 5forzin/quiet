#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{E3F5F642-A672-460D-9C01-8D0D31AB287E}
AppName=Quiet
AppVersion={#AppVersion}
AppPublisher=5forzin
AppPublisherURL=https://github.com/5forzin/quiet
AppSupportURL=https://github.com/5forzin/quiet/issues
AppUpdatesURL=https://github.com/5forzin/quiet/releases
DefaultDirName={localappdata}\Programs\Quiet
DefaultGroupName=Quiet
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename=Quiet-{#AppVersion}-windows-x64
SetupIconFile={#PayloadDir}\quiet.ico
UninstallDisplayIcon={app}\Quiet.exe
UninstallDisplayName=Quiet
Compression=lzma2
SolidCompression=yes
WizardStyle=modern dark windows11 hidebevels
WizardBackColor=#303231
WizardImageBackColor=#303231
WizardImageFile={#PayloadDir}\wizard.bmp
WizardSmallImageFile={#PayloadDir}\wizard-small.bmp
WizardSizePercent=110
DisableWelcomePage=no
DisableDirPage=auto
DisableReadyPage=yes
DisableFinishedPage=no
CloseApplications=no
RestartApplications=no
SetupLogging=yes
VersionInfoVersion={#AppVersion}.0

[Messages]
WelcomeLabel1=Install Quiet
WelcomeLabel2=Your agent's desktop.%n%nStable {#AppVersion}%nAutomatic updates included.
FinishedHeadingLabel=Quiet is ready
FinishedLabel=Open Quiet to use the mini control.%n%nTo share sessions, load the browser extension in Edge. Your sessions stay on this computer.
ButtonNext=Continue
ButtonInstall=Install Quiet

[Tasks]
Name: desktopicon; Description: "Desktop shortcut"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "wizard.bmp,wizard-small.bmp"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Quiet"; Filename: "{app}\Quiet.exe"; AppUserModelID: "Quiet.Desktop"
Name: "{group}\Browser extension"; Filename: "{app}\Quiet.exe"; Parameters: "--extension"
Name: "{group}\Check for updates"; Filename: "{app}\Quiet.exe"; Parameters: "--update"
Name: "{group}\Uninstall Quiet"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Quiet"; Filename: "{app}\Quiet.exe"; Tasks: desktopicon; AppUserModelID: "Quiet.Desktop"

[Run]
Filename: "{app}\Quiet.exe"; Description: "Open Quiet"; Flags: nowait postinstall skipifsilent
Filename: "{app}\Quiet.exe"; Parameters: "--extension"; Description: "Open extension folder"; Flags: nowait postinstall skipifsilent unchecked

[Code]
function StopQuiet(): Boolean;
var ExitCode: Integer;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\runtime\node.exe')) then
    Result := Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\scripts\prepare-install.mjs') + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopQuiet() then
    Result := 'Close Quiet and connected MCP clients, then try again.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopQuiet();
  if not Result then
    MsgBox('Close Quiet and connected MCP clients, then try again.', mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var ExitCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\scripts\initialize.mjs') + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
      RaiseException('Quiet could not prepare your local settings. Run the installer again.');
  end;
end;

procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel1.Font.Size := 30;
  WizardForm.WelcomeLabel1.Font.Style := [fsBold];
  WizardForm.WelcomeLabel2.Font.Size := 12;
  WizardForm.Font.Name := 'Segoe UI';
  WizardForm.NextButton.Width := ScaleX(112);
  WizardForm.NextButton.Left := WizardForm.CancelButton.Left - ScaleX(124);
  WizardForm.WelcomeLabel1.Font.Color := $00F2F3F2;
  WizardForm.WelcomeLabel2.Font.Color := $00ABAEA9;
end;
