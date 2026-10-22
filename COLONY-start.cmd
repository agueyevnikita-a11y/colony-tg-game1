@echo off
cd /d "%~dp0"
if exist ".local-tools\node-v22.23.3-win-x64\node.exe" (
  ".local-tools\node-v22.23.3-win-x64\node.exe" scripts\local-dev.mjs start
) else (
  node scripts\local-dev.mjs start
)
if errorlevel 1 goto done
start "" "http://127.0.0.1:3015"
:done
pause
