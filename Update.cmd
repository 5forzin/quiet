@echo off
cd /d "%~dp0"
node scripts\update.mjs
if errorlevel 1 pause
