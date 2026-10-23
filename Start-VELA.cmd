@echo off
"%~dp0agent\.venv\Scripts\python.exe" -X utf8 -u "%~dp0agent\main.py" --config "%USERPROFILE%\Downloads\vela-connection.json"
pause
