@echo off
setlocal
cd /d "%~dp0"
if not exist "agent\.venv\Scripts\python.exe" (
  echo VELA Python muhiti tapilmadi.
  pause
  exit /b 1
)
"agent\.venv\Scripts\python.exe" "agent\local_control.py" stop
endlocal
