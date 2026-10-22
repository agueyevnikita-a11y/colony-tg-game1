@echo off
cd /d "%~dp0"
if exist ".local-tools\node-v22.23.3-win-x64\node.exe" (
  ".local-tools\node-v22.23.3-win-x64\node.exe" scripts\local-dev.mjs stop
) else (
  node scripts\local-dev.mjs stop
)
pause
