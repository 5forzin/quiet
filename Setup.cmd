@echo off
cd /d "%~dp0"
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 exit /b 1
call npm.cmd run setup
if errorlevel 1 exit /b 1
call npm.cmd run start:background
pause
