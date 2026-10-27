@echo off
cd /d "%~dp0"
call npm.cmd run preview
if errorlevel 1 pause
