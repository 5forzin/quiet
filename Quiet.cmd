@echo off
cd /d "%~dp0"
node scripts\launch.mjs quiet
if errorlevel 1 pause
