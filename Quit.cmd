@echo off
cd /d "%~dp0"
node scripts\quit.mjs
if errorlevel 1 pause
